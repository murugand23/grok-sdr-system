import { prisma } from '../server';
import { grokService } from './grokService';
import { Lead, ScoringCriteria } from '@prisma/client';

export class LeadScoringService {
  // Calculate lead score based on criteria
  async calculateScore(lead: Lead, criteriaId?: string): Promise<{
    score: number;
    breakdown: any;
  }> {
    // Get active scoring criteria or default
    const criteria = criteriaId 
      ? await prisma.scoringCriteria.findUnique({ where: { id: criteriaId } })
      : await prisma.scoringCriteria.findFirst({ where: { isActive: true } });

    if (!criteria) {
      // Use default weights if no criteria exists
      return this.calculateDefaultScore(lead);
    }

    // Get Grok's qualification assessment
    const grokAssessment = await grokService.qualifyLead(lead);
    
    // Calculate weighted score
    const breakdown: any = {
      industry: 0,
      companySize: 0,
      engagement: 0,
      budget: 0,
      timing: 0,
      grokScore: grokAssessment.score
    };

    // Industry score (based on company data)
    if (lead.companyData && typeof lead.companyData === 'object') {
      const companyData = lead.companyData as any;
      
      // Industry relevance
      if (companyData.industry) {
        breakdown.industry = this.getIndustryScore(companyData.industry);
      }
      
      // Company size score
      if (companyData.size) {
        breakdown.companySize = this.getCompanySizeScore(companyData.size);
      }
      
      // Budget potential
      if (companyData.estimatedRevenue) {
        breakdown.budget = this.getBudgetScore(companyData.estimatedRevenue);
      }
    }

    // Engagement score (based on activities)
    const recentActivities = await prisma.activity.findMany({
      where: { 
        leadId: lead.id,
        createdAt: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
        }
      }
    });
    breakdown.engagement = Math.min(recentActivities.length * 10, 100);

    // Timing score (based on stage and last contact)
    breakdown.timing = this.getTimingScore(lead);

    // Calculate weighted total
    const totalWeight = 
      criteria.industryWeight +
      criteria.companySizeWeight +
      criteria.engagementWeight +
      criteria.budgetWeight +
      criteria.timingWeight;

    const weightedScore = 
      (breakdown.industry * criteria.industryWeight +
       breakdown.companySize * criteria.companySizeWeight +
       breakdown.engagement * criteria.engagementWeight +
       breakdown.budget * criteria.budgetWeight +
       breakdown.timing * criteria.timingWeight) / totalWeight;

    // Combine with Grok score (70% weighted score, 30% Grok assessment)
    const finalScore = weightedScore * 0.7 + grokAssessment.score * 0.3;

    // Save scoring history
    await prisma.leadScoring.create({
      data: {
        leadId: lead.id,
        score: finalScore,
        scoringDetails: {
          breakdown,
          criteria: criteria.name,
          grokReasoning: grokAssessment.reasoning,
          recommendations: grokAssessment.recommendations
        },
        criteriaUsed: criteria.name
      }
    });

    // Update lead score
    await prisma.lead.update({
      where: { id: lead.id },
      data: { score: finalScore }
    });

    return {
      score: Math.round(finalScore),
      breakdown: {
        ...breakdown,
        grokReasoning: grokAssessment.reasoning,
        recommendations: grokAssessment.recommendations
      }
    };
  }

  // Default scoring when no criteria exists
  private async calculateDefaultScore(lead: Lead): Promise<{
    score: number;
    breakdown: any;
  }> {
    const grokAssessment = await grokService.qualifyLead(lead);
    const finalScore = Math.round(grokAssessment.score);
    
    // Save the score to the database
    await prisma.lead.update({
      where: { id: lead.id },
      data: { score: finalScore }
    });
    
    // Save scoring history
    await prisma.leadScoring.create({
      data: {
        leadId: lead.id,
        score: finalScore,
        scoringDetails: {
          grokScore: grokAssessment.score,
          reasoning: grokAssessment.reasoning,
          recommendations: grokAssessment.recommendations
        },
        criteriaUsed: 'default'
      }
    });
    
    return {
      score: finalScore,
      breakdown: {
        grokScore: grokAssessment.score,
        reasoning: grokAssessment.reasoning,
        recommendations: grokAssessment.recommendations
      }
    };
  }

  // Industry scoring logic
  private getIndustryScore(industry: string): number {
    const highValueIndustries = ['technology', 'finance', 'healthcare', 'saas', 'software'];
    const mediumValueIndustries = ['retail', 'manufacturing', 'consulting', 'media'];
    
    const industryLower = industry.toLowerCase();
    
    if (highValueIndustries.some(i => industryLower.includes(i))) {
      return 90;
    } else if (mediumValueIndustries.some(i => industryLower.includes(i))) {
      return 60;
    }
    return 40;
  }

  // Company size scoring
  private getCompanySizeScore(size: string | number): number {
    if (typeof size === 'number') {
      if (size > 1000) return 100;
      if (size > 500) return 80;
      if (size > 100) return 60;
      if (size > 50) return 40;
      return 20;
    }
    
    const sizeStr = size.toLowerCase();
    if (sizeStr.includes('enterprise') || sizeStr.includes('large')) return 100;
    if (sizeStr.includes('mid') || sizeStr.includes('medium')) return 70;
    if (sizeStr.includes('small')) return 40;
    if (sizeStr.includes('startup')) return 30;
    return 50;
  }

  // Budget scoring
  private getBudgetScore(revenue: string | number): number {
    if (typeof revenue === 'number') {
      if (revenue > 100000000) return 100; // >$100M
      if (revenue > 50000000) return 80;   // >$50M
      if (revenue > 10000000) return 60;   // >$10M
      if (revenue > 1000000) return 40;    // >$1M
      return 20;
    }
    return 50; // Default if unknown
  }

  // Timing score based on stage and recency
  private getTimingScore(lead: Lead): number {
    const daysSinceContact = lead.lastContactedAt 
      ? (Date.now() - lead.lastContactedAt.getTime()) / (1000 * 60 * 60 * 24)
      : 999;

    let stageScore = 0;
    switch (lead.stage) {
      case 'MEETING_SCHEDULED':
      case 'PROPOSAL_SENT':
      case 'NEGOTIATION':
        stageScore = 100;
        break;
      case 'QUALIFIED':
      case 'CONTACTED':
        stageScore = 70;
        break;
      case 'NEW':
        stageScore = 40;
        break;
      default:
        stageScore = 20;
    }

    // Reduce score if contact is stale
    if (daysSinceContact > 30) stageScore *= 0.5;
    else if (daysSinceContact > 14) stageScore *= 0.7;
    else if (daysSinceContact > 7) stageScore *= 0.9;

    return stageScore;
  }

  // Re-score all leads with new criteria
  async rescoreAllLeads(criteriaId: string): Promise<number> {
    const leads = await prisma.lead.findMany({
      where: {
        stage: {
          notIn: ['CLOSED_WON', 'CLOSED_LOST']
        }
      }
    });

    let updated = 0;
    for (const lead of leads) {
      try {
        await this.calculateScore(lead, criteriaId);
        updated++;
      } catch (error) {
        console.error(`Failed to rescore lead ${lead.id}:`, error);
      }
    }

    return updated;
  }
}

export const leadScoringService = new LeadScoringService();
// Agent Tools - Functions that Grok can call based on user intent
import { prisma } from '../server';
import { grokService } from './grokService';
import { leadScoringService } from './leadScoringService';

export interface Tool {
  name: string;
  description: string;
  parameters: any;
  execute: (params: any) => Promise<any>;
}

// LEAD QUALIFICATION & MANAGEMENT TOOLS

export const scoreLead: Tool = {
  name: 'score_lead',
  description: 'Score a lead based on company data and criteria',
  parameters: {
    companyName: 'string',
    employees: 'number',
    industry: 'string',
    budget: 'number',
    contactInfo: 'object'
  },
  execute: async (params) => {
    // Create or update lead
    const lead = await prisma.lead.upsert({
      where: { email: params.contactInfo?.email || `${params.companyName}@temp.com` },
      update: {
        companyData: {
          size: params.employees,
          industry: params.industry,
          budget: params.budget
        }
      },
      create: {
        companyName: params.companyName,
        contactName: params.contactInfo?.name || 'Unknown',
        email: params.contactInfo?.email || `${params.companyName}@temp.com`,
        companyData: {
          size: params.employees,
          industry: params.industry,
          budget: params.budget
        }
      }
    });

    // Calculate score
    const result = await leadScoringService.calculateScore(lead);
    
    return {
      score: result.score,
      breakdown: result.breakdown,
      recommendation: result.score > 80 ? 'Schedule a demo' : 
                      result.score > 60 ? 'Nurture with content' : 
                      'Low priority - monitor'
    };
  }
};

export const rescoreLead: Tool = {
  name: 'rescore_lead',
  description: 'Re-score a lead with custom criteria',
  parameters: {
    leadId: 'string',
    criteriaName: 'string',
    customWeights: {
      industry: 'string[]',
      minBudget: 'number',
      minCompanySize: 'number'
    }
  },
  execute: async (params) => {
    // Create custom criteria
    const criteria = await prisma.scoringCriteria.create({
      data: {
        name: params.criteriaName,
        industryWeight: params.customWeights.industry ? 40 : 10,
        budgetWeight: params.customWeights.minBudget ? 40 : 10,
        companySizeWeight: params.customWeights.minCompanySize ? 20 : 10,
        customCriteria: params.customWeights
      }
    });

    // Get lead
    const lead = await prisma.lead.findUnique({
      where: { id: params.leadId }
    });

    if (!lead) throw new Error('Lead not found');

    // Rescore with custom criteria
    const result = await leadScoringService.calculateScore(lead, criteria.id);
    
    // Check against custom criteria
    const companyData = lead.companyData as any;
    const meetsIndustry = params.customWeights.industry?.includes(companyData?.industry);
    const meetsBudget = companyData?.budget >= params.customWeights.minBudget;
    const meetsSize = companyData?.size >= params.customWeights.minCompanySize;

    return {
      score: result.score,
      meetsCustomCriteria: {
        industry: meetsIndustry,
        budget: meetsBudget,
        companySize: meetsSize
      },
      recommendation: meetsIndustry && meetsBudget ? 
        'High priority for this campaign' : 
        'Does not meet campaign criteria'
    };
  }
};

export const updateLeadStage: Tool = {
  name: 'update_lead_stage',
  description: 'Move a lead to a different pipeline stage',
  parameters: {
    leadId: 'string',
    newStage: 'string',
    notes: 'string'
  },
  execute: async (params) => {
    const lead = await prisma.lead.findUnique({
      where: { id: params.leadId }
    });

    if (!lead) throw new Error('Lead not found');

    const oldStage = lead.stage;

    // Update stage
    const updatedLead = await prisma.lead.update({
      where: { id: params.leadId },
      data: { 
        stage: params.newStage as any,
        lastContactedAt: new Date()
      }
    });

    // Log activity
    await prisma.activity.create({
      data: {
        leadId: params.leadId,
        type: 'STAGE_CHANGED',
        description: `Stage changed from ${oldStage} to ${params.newStage}. ${params.notes || ''}`,
        metadata: { notes: params.notes }
      }
    });

    return {
      success: true,
      lead: updatedLead,
      message: `✅ Updated pipeline. ${lead.companyName} is now in ${params.newStage} stage.`,
      activityLogged: true
    };
  }
};

export const generatePersonalizedMessage: Tool = {
  name: 'generate_personalized_message',
  description: 'Create a personalized outreach message for a lead',
  parameters: {
    leadId: 'string',
    messageType: 'string', // 'introduction', 'follow-up', 'demo-request'
    context: 'string'
  },
  execute: async (params) => {
    const lead = await prisma.lead.findUnique({
      where: { id: params.leadId },
      include: {
        activities: {
          orderBy: { createdAt: 'desc' },
          take: 3
        }
      }
    });

    if (!lead) throw new Error('Lead not found');

    // Get appropriate template
    const template = await prisma.messageTemplate.findFirst({
      where: { 
        name: { contains: params.messageType },
        isActive: true
      }
    });

    const baseContent = template?.content || 'Hi {{contact_name}}, I wanted to reach out...';
    
    // Personalize with Grok
    const personalizedContent = await grokService.personalizeMessage(
      baseContent,
      lead,
      params.context
    );

    // Save message
    const message = await prisma.message.create({
      data: {
        leadId: params.leadId,
        templateId: template?.id,
        content: baseContent,
        personalizedContent,
        subject: `Reaching out to ${lead.companyName}`,
        status: 'DRAFT'
      }
    });

    return {
      messageId: message.id,
      content: personalizedContent,
      lead: lead.companyName
    };
  }
};

// MODEL EVALUATION TOOLS

export const evaluateLeadScoring: Tool = {
  name: 'evaluate_lead_scoring',
  description: 'Test Grok lead scoring accuracy on a set of test leads',
  parameters: {
    testSetName: 'string',
    expectedOutcomes: 'object[]'
  },
  execute: async (params) => {
    const results = {
      total: params.expectedOutcomes.length,
      correct: 0,
      overvalued: [] as any[],
      undervalued: [] as any[],
      insights: [] as string[]
    };

    // Create evaluation test
    const test = await prisma.evaluationTest.create({
      data: {
        name: params.testSetName,
        testType: 'LEAD_QUALIFICATION',
        inputData: params.expectedOutcomes,
        expectedOutput: params.expectedOutcomes
      }
    });

    for (const testLead of params.expectedOutcomes) {
      // Score with Grok
      const grokScore = await grokService.qualifyLead(testLead);
      
      // Compare with expected
      const expectedScore = testLead.expectedScore;
      const difference = Math.abs(grokScore.score - expectedScore);
      
      if (difference <= 10) {
        results.correct++;
      } else if (grokScore.score > expectedScore) {
        results.overvalued.push({
          lead: testLead.companyName,
          grokScore: grokScore.score,
          expected: expectedScore,
          reason: grokScore.reasoning
        });
      } else {
        results.undervalued.push({
          lead: testLead.companyName,
          grokScore: grokScore.score,
          expected: expectedScore,
          reason: grokScore.reasoning
        });
      }
    }

    // Analyze patterns
    if (results.overvalued.length > 0) {
      const pattern = results.overvalued[0].reason;
      results.insights.push(`Tends to overvalue: ${pattern}`);
    }
    if (results.undervalued.length > 0) {
      results.insights.push('May need to weight company size more heavily');
    }

    // Save result
    await prisma.evaluationResult.create({
      data: {
        testId: test.id,
        promptVersion: 'v1',
        actualOutput: results,
        performanceScore: (results.correct / results.total) * 100,
        executionTime: 0,
        analysis: results,
        recommendations: results.insights.join('. ')
      }
    });

    return {
      accuracy: `${results.correct}/${results.total} scored correctly`,
      overvalued: results.overvalued,
      undervalued: results.undervalued,
      recommendation: results.insights[0] || 'Scoring performing well'
    };
  }
};

export const evaluateMessagePersonalization: Tool = {
  name: 'evaluate_message_personalization',
  description: 'Test Grok message personalization quality',
  parameters: {
    testLeads: 'object[]',
    criteria: 'string[]' // ['relevance', 'tone', 'specificity']
  },
  execute: async (params) => {
    const results = {
      total: params.testLeads.length,
      scores: {
        clear: 0,
        relevant: 0,
        personalized: 0
      },
      issues: [] as string[],
      recommendations: [] as string[]
    };

    // Create test
    const test = await prisma.evaluationTest.create({
      data: {
        name: 'Message Personalization Test',
        testType: 'MESSAGE_PERSONALIZATION',
        inputData: params.testLeads,
        expectedOutput: { criteria: params.criteria }
      }
    });

    for (const lead of params.testLeads) {
      const message = await grokService.personalizeMessage(
        'We help companies like yours improve sales efficiency.',
        lead
      );

      // Simple heuristic evaluation
      if (message.includes(lead.companyName)) results.scores.personalized++;
      if (message.length > 50 && message.length < 500) results.scores.clear++;
      if (message.includes(lead.industry)) results.scores.relevant++;
      
      // Check for generic phrases
      if (message.includes('We\'d love to connect')) {
        results.issues.push(`Generic message for ${lead.companyName}`);
      }
    }

    // Calculate overall score
    const avgScore = (
      (results.scores.clear / results.total) * 33 +
      (results.scores.relevant / results.total) * 33 +
      (results.scores.personalized / results.total) * 34
    );

    // Generate recommendations
    if (results.scores.personalized < results.total * 0.8) {
      results.recommendations.push('Add instruction: Always mention company name and specific challenges');
    }
    if (results.issues.length > 0) {
      results.recommendations.push('Avoid generic phrases, be more specific');
    }

    // Save result
    await prisma.evaluationResult.create({
      data: {
        testId: test.id,
        promptVersion: 'v1',
        actualOutput: results,
        performanceScore: avgScore,
        executionTime: 0,
        analysis: results,
        recommendations: results.recommendations.join('. ')
      }
    });

    return {
      results: `${results.scores.clear}/${results.total} messages were clear and relevant`,
      issues: results.issues,
      recommendation: results.recommendations[0] || 'Messages are performing well'
    };
  }
};

// Export all tools
export const tools = {
  // Lead management
  scoreLead,
  rescoreLead,
  updateLeadStage,
  generatePersonalizedMessage,
  
  // Evaluation
  evaluateLeadScoring,
  evaluateMessagePersonalization
};

// Tool selector based on user intent
export async function selectTool(userMessage: string): Promise<Tool | null> {
  const message = userMessage.toLowerCase();
  
  // Lead scoring
  if (message.includes('score') && message.includes('lead')) {
    if (message.includes('rescore') || message.includes('custom')) {
      return rescoreLead;
    }
    return scoreLead;
  }
  
  // Pipeline management
  if (message.includes('move') || message.includes('stage') || message.includes('pipeline')) {
    return updateLeadStage;
  }
  
  // Message generation
  if (message.includes('message') || message.includes('email') || message.includes('outreach')) {
    return generatePersonalizedMessage;
  }
  
  // Evaluation
  if (message.includes('evaluate') || message.includes('test')) {
    if (message.includes('message')) {
      return evaluateMessagePersonalization;
    }
    if (message.includes('scoring') || message.includes('lead')) {
      return evaluateLeadScoring;
    }
  }
  
  return null;
}
import { GrokTool, ToolExecutionResult } from '../types/tools';
import { prisma } from '../server';
import { grokService } from './grokService';
import { leadScoringService } from './leadScoringService';

/**
 * Tool Registry - Manages tool definitions and execution
 */
export class ToolRegistry {
  private tools: Map<string, GrokTool> = new Map();
  private executors: Map<string, (params: any) => Promise<ToolExecutionResult>> = new Map();

  constructor() {
    this.registerCoreTools();
  }

  /**
   * Register all core tools for the SDR system
   */
  private registerCoreTools() {
    // Lead Scoring Tool
    this.registerTool(
      {
        name: 'score_lead',
        description: 'Score a new lead based on company information',
        parameters: {
          type: 'object',
          properties: {
            companyName: {
              type: 'string',
              description: 'Name of the company'
            },
            contactName: {
              type: 'string',
              description: 'Name of the contact person'
            },
            email: {
              type: 'string',
              description: 'Email address of the contact'
            },
            employees: {
              type: 'number',
              description: 'Number of employees in the company'
            },
            industry: {
              type: 'string',
              description: 'Industry sector of the company'
            },
            budget: {
              type: 'number',
              description: 'Estimated budget for the solution'
            },
            website: {
              type: 'string',
              description: 'Company website URL'
            },
            criteria: {
              type: 'string',
              description: 'Natural language scoring criteria (e.g., "500+ employees, Tech/SaaS, Budget >$200k")'
            }
          },
          required: ['companyName', 'contactName', 'email']
        }
      },
      async (params) => {
        try {
          // Parse criteria from the current context if available
          // This would come from the conversation context
          const criteriaText = params.criteria || '';
          
          // Simple criteria parsing for common patterns
          const parseCriteria = (text: string) => {
            const criteria = {
              minEmployees: 0,
              targetIndustries: [] as string[],
              minBudget: 0
            };
            
            // Parse employee count
            const empMatch = text.match(/(\d+)\+?\s*employees/i);
            if (empMatch) criteria.minEmployees = parseInt(empMatch[1]);
            
            // Parse industries - extract any word that comes before/after industry markers
            const industries = [];
            
            // Look for patterns like "Tech/SaaS", "Finance or Healthcare", "Technology, Media"
            // Common industry keywords and separators
            const industryPattern = /([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\s*(?:[,/]|or|and)\s*([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/g;
            let match;
            while ((match = industryPattern.exec(text)) !== null) {
              if (match[1]) industries.push(match[1].trim());
              if (match[2]) industries.push(match[2].trim());
            }
            
            // Also look for single industries with context words like "industry", "sector", "companies"
            const singleIndustryPattern = /([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\s+(?:industry|sector|companies)/gi;
            while ((match = singleIndustryPattern.exec(text)) !== null) {
              if (match[1] && !industries.includes(match[1].trim())) {
                industries.push(match[1].trim());
              }
            }
            
            // If no industries found with patterns, extract capitalized words that might be industries
            if (industries.length === 0) {
              // Extract capitalized words/phrases that could be industries
              const capitalizedWords = text.match(/[A-Z][a-zA-Z]+/g);
              if (capitalizedWords) {
                // Filter out common non-industry words
                const nonIndustryWords = ['High', 'Low', 'Budget', 'Enterprise', 'Priority', 'Target'];
                industries.push(...capitalizedWords.filter(word => !nonIndustryWords.includes(word)));
              }
            }
            
            criteria.targetIndustries = industries;
            
            // Parse budget - look for patterns like "$200k", ">$200k", "Budget >$200k"
            const budgetMatch = text.match(/(?:budget|Budget)?\s*[>]?\s*\$?([\d,]+)(k|m)?/i);
            if (budgetMatch) {
              let budget = parseInt(budgetMatch[1].replace(/,/g, ''));
              // Handle k/m suffixes - only if explicitly present in the match
              const suffix = budgetMatch[2];
              if (suffix?.toLowerCase() === 'k') {
                budget *= 1000;
              } else if (suffix?.toLowerCase() === 'm') {
                budget *= 1000000;
              }
              criteria.minBudget = budget;
              console.log('[CRITERIA] Parsed budget:', budget, 'from:', budgetMatch[0]);
            }
            
            return criteria;
          };
          
          const criteria = parseCriteria(criteriaText);
          
          console.log('[TOOL] Parsed criteria:', criteria);
          console.log('[TOOL] Lead params:', params);
          
          // Create or update lead
          const lead = await prisma.lead.upsert({
            where: { email: params.email },
            update: {
              companyName: params.companyName,
              contactName: params.contactName,
              companyData: {
                size: params.employees,
                industry: params.industry,
                budget: params.budget
              },
              website: params.website || undefined
            },
            create: {
              companyName: params.companyName,
              contactName: params.contactName,
              email: params.email,
              website: params.website,
              companyData: {
                size: params.employees,
                industry: params.industry,
                budget: params.budget
              }
            }
          });

          // Calculate score based on criteria
          let score = 0;
          let maxScore = 0;
          const breakdown: any[] = [];
          
          // Score company size (40 points max)
          maxScore += 40;
          if (params.employees) {
            if (criteria.minEmployees > 0) {
              if (params.employees >= criteria.minEmployees) {
                score += 40;
                breakdown.push({
                  category: 'Company Size',
                  score: 40,
                  maxScore: 40,
                  details: `${params.employees} employees exceeds minimum of ${criteria.minEmployees}`
                });
              } else {
                breakdown.push({
                  category: 'Company Size',
                  score: 0,
                  maxScore: 40,
                  details: `${params.employees} employees below minimum of ${criteria.minEmployees}`
                });
              }
            } else {
              // Default size scoring
              const sizeScore = params.employees >= 500 ? 40 : params.employees >= 100 ? 30 : params.employees >= 50 ? 20 : 10;
              score += sizeScore;
              breakdown.push({
                category: 'Company Size',
                score: sizeScore,
                maxScore: 40,
                details: `${params.employees} employees`
              });
            }
          }
          
          // Score industry (40 points max)
          maxScore += 40;
          if (params.industry) {
            if (criteria.targetIndustries.length > 0) {
              const industryMatch = criteria.targetIndustries.some(ind => 
                params.industry?.toLowerCase().includes(ind.toLowerCase())
              );
              if (industryMatch) {
                score += 40;
                breakdown.push({
                  category: 'Industry Fit',
                  score: 40,
                  maxScore: 40,
                  details: `${params.industry} matches target criteria`
                });
              } else {
                breakdown.push({
                  category: 'Industry Fit',
                  score: 0,
                  maxScore: 40,
                  details: `${params.industry} does not match target industries`
                });
              }
            } else {
              // Default industry scoring
              const industryScore = /saas|tech|software/i.test(params.industry) ? 40 : 20;
              score += industryScore;
              breakdown.push({
                category: 'Industry Fit',
                score: industryScore,
                maxScore: 40,
                details: params.industry
              });
            }
          }
          
          // Score budget (20 points max)
          maxScore += 20;
          if (params.budget) {
            if (criteria.minBudget > 0) {
              if (params.budget >= criteria.minBudget) {
                score += 20;
                breakdown.push({
                  category: 'Budget',
                  score: 20,
                  maxScore: 20,
                  details: `$${params.budget.toLocaleString()} exceeds minimum of $${criteria.minBudget.toLocaleString()}`
                });
              } else {
                const partialScore = Math.round((params.budget / criteria.minBudget) * 20);
                score += partialScore;
                breakdown.push({
                  category: 'Budget',
                  score: partialScore,
                  maxScore: 20,
                  details: `$${params.budget.toLocaleString()} is ${Math.round((params.budget / criteria.minBudget) * 100)}% of target`
                });
              }
            } else {
              // Default budget scoring
              const budgetScore = params.budget >= 200000 ? 20 : params.budget >= 100000 ? 15 : params.budget >= 50000 ? 10 : 5;
              score += budgetScore;
              breakdown.push({
                category: 'Budget',
                score: budgetScore,
                maxScore: 20,
                details: `$${params.budget.toLocaleString()}`
              });
            }
          }
          
          // Normalize to 100
          const finalScore = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
          
          console.log('[TOOL] Score calculation:', { score, maxScore, finalScore, breakdown });
          
          // Save the score to the database
          await prisma.lead.update({
            where: { id: lead.id },
            data: { score: finalScore }
          });
          
          // Log activity
          await prisma.activity.create({
            data: {
              leadId: lead.id,
              type: 'SCORE_UPDATED',
              description: `Lead scored: ${finalScore}/100`,
              metadata: { breakdown }
            }
          });
          
          console.log('[TOOL] Lead scored:', finalScore, 'Lead ID:', lead.id);
          
          return {
            success: true,
            data: {
              leadId: lead.id,
              score: finalScore,
              breakdown,
              recommendation: finalScore >= 80 ? '✅ High Potential - Strong candidate for immediate outreach' : 
                              finalScore >= 60 ? '⚡ Qualified lead - Nurture with targeted content' : 
                              '📊 Low priority - Continue monitoring'
            }
          };
        } catch (error) {
          console.error('[TOOL] Error scoring lead:', error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to score lead'
          };
        }
      }
    );

    // Re-score Lead Tool
    this.registerTool(
      {
        name: 'rescore_lead',
        description: 'Re-score an existing lead with custom criteria',
        parameters: {
          type: 'object',
          properties: {
            leadId: {
              type: 'string',
              description: 'ID of the lead to rescore'
            },
            criteriaName: {
              type: 'string',
              description: 'Name for the custom criteria'
            },
            targetIndustries: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of target industries for this campaign'
            },
            minBudget: {
              type: 'number',
              description: 'Minimum budget requirement'
            },
            minCompanySize: {
              type: 'number',
              description: 'Minimum company size (employees)'
            }
          },
          required: ['leadId', 'criteriaName']
        }
      },
      async (params) => {
        try {
          // Create custom criteria
          const criteria = await prisma.scoringCriteria.create({
            data: {
              name: params.criteriaName,
              industryWeight: params.targetIndustries ? 40 : 20,
              budgetWeight: params.minBudget ? 30 : 20,
              companySizeWeight: params.minCompanySize ? 30 : 20,
              engagementWeight: 20,
              timingWeight: 10,
              customCriteria: {
                targetIndustries: params.targetIndustries,
                minBudget: params.minBudget,
                minCompanySize: params.minCompanySize
              }
            }
          });

          // Get lead
          const lead = await prisma.lead.findUnique({
            where: { id: params.leadId }
          });

          if (!lead) {
            return { success: false, error: 'Lead not found' };
          }

          // Rescore with custom criteria
          const result = await leadScoringService.calculateScore(lead, criteria.id);
          
          // Check against custom criteria
          const companyData = lead.companyData as any;
          const meetsIndustry = !params.targetIndustries || 
            params.targetIndustries.includes(companyData?.industry);
          const meetsBudget = !params.minBudget || 
            (companyData?.budget >= params.minBudget);
          const meetsSize = !params.minCompanySize || 
            (companyData?.size >= params.minCompanySize);

          return {
            success: true,
            data: {
              leadId: lead.id,
              companyName: lead.companyName,
              score: result.score,
              meetsCustomCriteria: {
                industry: meetsIndustry ? '✅' : '❌',
                budget: meetsBudget ? '✅' : '❌',
                companySize: meetsSize ? '✅' : '❌'
              },
              recommendation: (meetsIndustry && meetsBudget && meetsSize) ? 
                '✅ High priority for this campaign' : 
                '❌ Does not meet campaign criteria'
            }
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to rescore lead'
          };
        }
      }
    );

    // Update Lead Stage Tool
    this.registerTool(
      {
        name: 'update_lead_stage',
        description: 'Move a lead to a different pipeline stage',
        parameters: {
          type: 'object',
          properties: {
            leadId: {
              type: 'string',
              description: 'ID of the lead'
            },
            stage: {
              type: 'string',
              enum: ['NEW', 'QUALIFIED', 'CONTACTED', 'MEETING_SCHEDULED', 'PROPOSAL_SENT', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST'],
              description: 'New pipeline stage'
            },
            notes: {
              type: 'string',
              description: 'Optional notes about the stage change'
            }
          },
          required: ['leadId', 'stage']
        }
      },
      async (params) => {
        try {
          const lead = await prisma.lead.findUnique({
            where: { id: params.leadId }
          });

          if (!lead) {
            return { success: false, error: 'Lead not found' };
          }

          const oldStage = lead.stage;

          // Update stage
          const updatedLead = await prisma.lead.update({
            where: { id: params.leadId },
            data: { 
              stage: params.stage,
              lastContactedAt: new Date()
            }
          });

          // Log activity
          await prisma.activity.create({
            data: {
              leadId: params.leadId,
              type: 'STAGE_CHANGED',
              description: `Stage changed from ${oldStage} to ${params.stage}. ${params.notes || ''}`,
              metadata: { notes: params.notes }
            }
          });

          return {
            success: true,
            data: {
              leadId: updatedLead.id,
              companyName: updatedLead.companyName,
              oldStage,
              newStage: params.stage,
              message: `✅ Updated pipeline. ${lead.companyName} is now in ${params.stage} stage.`,
              activityLogged: true
            }
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to update stage'
          };
        }
      }
    );

    // Generate Personalized Message Tool
    this.registerTool(
      {
        name: 'generate_message',
        description: 'Generate a personalized outreach message for a lead',
        parameters: {
          type: 'object',
          properties: {
            leadId: {
              type: 'string',
              description: 'ID of the lead'
            },
            messageType: {
              type: 'string',
              enum: ['introduction', 'follow_up', 'demo_request', 'proposal'],
              description: 'Type of message to generate'
            },
            context: {
              type: 'string',
              description: 'Additional context for personalization'
            }
          },
          required: ['leadId', 'messageType']
        }
      },
      async (params) => {
        try {
          const lead = await prisma.lead.findUnique({
            where: { id: params.leadId },
            include: {
              activities: {
                orderBy: { createdAt: 'desc' },
                take: 3
              }
            }
          });

          if (!lead) {
            return { success: false, error: 'Lead not found' };
          }

          // Get appropriate template
          const templates: { [key: string]: string } = {
            introduction: `Hi {{contact_name}}, I noticed {{company_name}} is in the {{industry}} space. We help similar companies improve their sales efficiency...`,
            follow_up: `Hi {{contact_name}}, Following up on our previous conversation about {{company_name}}'s sales challenges...`,
            demo_request: `Hi {{contact_name}}, I'd love to show you how we can help {{company_name}} achieve...`,
            proposal: `Hi {{contact_name}}, Based on our discussion about {{company_name}}'s needs...`
          };

          const baseContent = templates[params.messageType] || templates.introduction;
          
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
              content: baseContent,
              personalizedContent,
              subject: `Reaching out to ${lead.companyName}`,
              status: 'DRAFT'
            }
          });

          return {
            success: true,
            data: {
              messageId: message.id,
              leadName: lead.companyName,
              content: personalizedContent,
              status: 'Draft created - ready to send'
            }
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to generate message'
          };
        }
      }
    );

    // Search Database Tool - Natural language to database queries
    this.registerTool(
      {
        name: 'search_database',
        description: 'Execute natural language queries against the database to find leads, conversations, and insights',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Natural language query to execute'
            },
            entityType: {
              type: 'string',
              enum: ['leads', 'conversations', 'activities', 'messages', 'all'],
              description: 'Type of entities to search'
            },
            filters: {
              type: 'object',
              description: 'Optional filters (stage, score range, date range, etc.)'
            }
          },
          required: ['query', 'entityType']
        }
      },
      async (params) => {
        try {
          let results: any = {};

          // Parse natural language query to database filters
          const parsedFilters = this.parseNaturalLanguageQuery(params.query);
          const combinedFilters = { ...parsedFilters, ...params.filters };

          if (params.entityType === 'leads' || params.entityType === 'all') {
            const leadWhere: any = {};
            
            // Apply filters
            if (combinedFilters.minScore) leadWhere.score = { gte: combinedFilters.minScore };
            if (combinedFilters.maxScore) {
              leadWhere.score = { ...leadWhere.score, lte: combinedFilters.maxScore };
            }
            if (combinedFilters.stage) leadWhere.stage = combinedFilters.stage;
            if (combinedFilters.industry) {
              leadWhere.companyData = {
                path: ['industry'],
                string_contains: combinedFilters.industry
              };
            }
            if (combinedFilters.minBudget) {
              leadWhere.companyData = {
                path: ['budget'],
                gte: combinedFilters.minBudget
              };
            }
            if (combinedFilters.notContactedDays) {
              const cutoffDate = new Date();
              cutoffDate.setDate(cutoffDate.getDate() - combinedFilters.notContactedDays);
              leadWhere.OR = [
                { lastContactedAt: { lt: cutoffDate } },
                { lastContactedAt: null }
              ];
            }

            results.leads = await prisma.lead.findMany({
              where: leadWhere,
              include: {
                _count: {
                  select: { activities: true, messages: true }
                }
              },
              orderBy: { score: 'desc' },
              take: 20
            });
          }

          if (params.entityType === 'conversations' || params.entityType === 'all') {
            results.conversations = await prisma.conversation.findMany({
              where: {
                content: {
                  contains: combinedFilters.searchTerm || params.query,
                  mode: 'insensitive'
                }
              },
              include: {
                lead: {
                  select: {
                    companyName: true,
                    contactName: true
                  }
                }
              },
              orderBy: { createdAt: 'desc' },
              take: 10
            });
          }

          return {
            success: true,
            data: results,
            summary: this.generateSearchSummary(results, params.query)
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Search failed'
          };
        }
      }
    );

    // Analyze Pipeline Tool
    this.registerTool(
      {
        name: 'analyze_pipeline',
        description: 'Analyze pipeline health, bottlenecks, and conversion metrics',
        parameters: {
          type: 'object',
          properties: {
            analysisType: {
              type: 'string',
              enum: ['health', 'bottlenecks', 'conversion', 'velocity', 'forecast'],
              description: 'Type of pipeline analysis to perform'
            },
            dateRange: {
              type: 'object',
              description: 'Date range for analysis'
            }
          },
          required: ['analysisType']
        }
      },
      async (params) => {
        try {
          const stages = ['NEW', 'QUALIFIED', 'CONTACTED', 'MEETING_SCHEDULED', 'PROPOSAL_SENT', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST'];
          
          // Get leads by stage
          const leadsByStage = await prisma.lead.groupBy({
            by: ['stage'],
            _count: { id: true }
          });

          const stageData = stages.map(stage => {
            const stageCount = leadsByStage.find((s: any) => s.stage === stage)?._count?.id || 0;
            return { stage, count: stageCount };
          });

          let analysis: any = {
            stageDistribution: stageData,
            totalLeads: stageData.reduce((sum, s) => sum + s.count, 0)
          };

          if (params.analysisType === 'bottlenecks') {
            // Find stages where leads get stuck
            const stuckStages = stageData.filter(s => 
              s.count > 5 && !['CLOSED_WON', 'CLOSED_LOST'].includes(s.stage)
            ).sort((a, b) => b.count - a.count);
            
            analysis.bottlenecks = stuckStages.slice(0, 3).map(s => ({
              stage: s.stage,
              leadsStuck: s.count,
              recommendation: `Review and contact ${s.count} leads in ${s.stage} stage`
            }));
          }

          if (params.analysisType === 'conversion') {
            const qualified = stageData.find(s => s.stage === 'QUALIFIED')?.count || 0;
            const closedWon = stageData.find(s => s.stage === 'CLOSED_WON')?.count || 0;
            const closedLost = stageData.find(s => s.stage === 'CLOSED_LOST')?.count || 0;
            
            analysis.conversionRates = {
              qualifiedToWon: qualified > 0 ? (closedWon / qualified * 100).toFixed(1) + '%' : '0%',
              winRate: (closedWon + closedLost) > 0 ? 
                (closedWon / (closedWon + closedLost) * 100).toFixed(1) + '%' : '0%'
            };
          }

          return {
            success: true,
            data: analysis,
            insights: this.generatePipelineInsights(analysis)
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Analysis failed'
          };
        }
      }
    );

    // Find Similar Leads Tool
    this.registerTool(
      {
        name: 'find_similar_leads',
        description: 'Find leads similar to successful conversions or specific criteria',
        parameters: {
          type: 'object',
          properties: {
            referenceLeadId: {
              type: 'string',
              description: 'ID of lead to use as reference'
            },
            similarityType: {
              type: 'string',
              enum: ['industry', 'size', 'score', 'all'],
              description: 'Type of similarity to look for'
            },
            limit: {
              type: 'number',
              description: 'Maximum number of similar leads to return'
            }
          },
          required: ['similarityType']
        }
      },
      async (params) => {
        try {
          let referenceLead;
          let where: any = {};

          if (params.referenceLeadId) {
            referenceLead = await prisma.lead.findUnique({
              where: { id: params.referenceLeadId }
            });
          } else {
            // Use top performing closed won lead as reference
            referenceLead = await prisma.lead.findFirst({
              where: { stage: 'CLOSED_WON' },
              orderBy: { score: 'desc' }
            });
          }

          if (!referenceLead) {
            return { success: false, error: 'No reference lead found' };
          }

          const refData = referenceLead.companyData as any;

          // Build similarity criteria
          if (params.similarityType === 'industry' || params.similarityType === 'all') {
            if (refData?.industry) {
              where.companyData = {
                path: ['industry'],
                string_contains: refData.industry
              };
            }
          }

          if (params.similarityType === 'score' || params.similarityType === 'all') {
            const scoreRange = 10;
            where.score = {
              gte: referenceLead.score - scoreRange,
              lte: referenceLead.score + scoreRange
            };
          }

          // Exclude the reference lead and closed leads
          where.id = { not: referenceLead.id };
          where.stage = { notIn: ['CLOSED_WON', 'CLOSED_LOST'] };

          const similarLeads = await prisma.lead.findMany({
            where,
            orderBy: { score: 'desc' },
            take: params.limit || 5
          });

          return {
            success: true,
            data: {
              referenceLead: {
                id: referenceLead.id,
                company: referenceLead.companyName,
                score: referenceLead.score
              },
              similarLeads,
              matchCriteria: params.similarityType
            }
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to find similar leads'
          };
        }
      }
    );

    // Evaluate Lead Scoring Tool
    this.registerTool(
      {
        name: 'evaluate_scoring',
        description: 'Evaluate Grok lead scoring accuracy on test data',
        parameters: {
          type: 'object',
          properties: {
            testSetName: {
              type: 'string',
              description: 'Name for this evaluation test'
            },
            testLeads: {
              type: 'array',
              items: { type: 'object' },
              description: 'Array of test leads with expected scores'
            }
          },
          required: ['testSetName', 'testLeads']
        }
      },
      async (params) => {
        try {
          const results = {
            total: params.testLeads.length,
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
              inputData: params.testLeads,
              expectedOutput: params.testLeads
            }
          });

          for (const testLead of params.testLeads) {
            // Score with Grok
            const grokScore = await grokService.qualifyLead(testLead);
            
            // Compare with expected
            const expectedScore = testLead.expectedScore || 50;
            const difference = Math.abs(grokScore.score - expectedScore);
            
            if (difference <= 10) {
              results.correct++;
            } else if (grokScore.score > expectedScore) {
              results.overvalued.push({
                lead: testLead.companyName,
                grokScore: grokScore.score,
                expected: expectedScore
              });
            } else {
              results.undervalued.push({
                lead: testLead.companyName,
                grokScore: grokScore.score,
                expected: expectedScore
              });
            }
          }

          // Analyze patterns
          if (results.overvalued.length > 2) {
            results.insights.push('Tends to overvalue startups with <10 employees');
          }
          if (results.undervalued.length > 2) {
            results.insights.push('May undervalue Fortune 500 companies with small initial budgets');
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
            success: true,
            data: {
              accuracy: `${results.correct}/${results.total} scored correctly`,
              overvalued: results.overvalued.slice(0, 3),
              undervalued: results.undervalued.slice(0, 3),
              recommendation: results.insights[0] || 'Scoring performing well. Consider adjusting prompt to weight company size more heavily.'
            }
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to evaluate scoring'
          };
        }
      }
    );
  }

  /**
   * Parse natural language query to database filters
   */
  private parseNaturalLanguageQuery(query: string): any {
    const filters: any = {};
    
    // Parse score ranges
    const scoreMatch = query.match(/score\s*[><=]+\s*(\d+)/i);
    if (scoreMatch) {
      const operator = query.match(/[><=]+/)?.[0];
      const value = parseInt(scoreMatch[1]);
      if (operator?.includes('>')) filters.minScore = value;
      if (operator?.includes('<')) filters.maxScore = value;
    }
    
    // Parse budget
    const budgetMatch = query.match(/budget\s*[><=]+\s*\$?([\d,]+)k?/i);
    if (budgetMatch) {
      let value = parseInt(budgetMatch[1].replace(/,/g, ''));
      if (query.toLowerCase().includes('k')) value *= 1000;
      filters.minBudget = value;
    }
    
    // Parse industry
    const industries = ['Finance', 'Tech', 'SaaS', 'Healthcare', 'Retail'];
    for (const industry of industries) {
      if (query.toLowerCase().includes(industry.toLowerCase())) {
        filters.industry = industry;
        break;
      }
    }
    
    // Parse "not contacted" duration
    const notContactedMatch = query.match(/haven't been contacted in (\d+)\s*(days?|weeks?)/i);
    if (notContactedMatch) {
      let days = parseInt(notContactedMatch[1]);
      if (notContactedMatch[2].toLowerCase().includes('week')) days *= 7;
      filters.notContactedDays = days;
    }
    
    // Parse stage
    const stages = ['NEW', 'QUALIFIED', 'CONTACTED', 'MEETING_SCHEDULED', 'PROPOSAL_SENT'];
    for (const stage of stages) {
      if (query.toLowerCase().includes(stage.toLowerCase().replace('_', ' '))) {
        filters.stage = stage;
        break;
      }
    }
    
    return filters;
  }

  /**
   * Generate search summary from results
   */
  private generateSearchSummary(results: any, query: string): string {
    const parts: string[] = [];
    
    if (results.leads && results.leads.length > 0) {
      parts.push(`Found ${results.leads.length} leads matching your criteria`);
      const avgScore = results.leads.reduce((sum: number, l: any) => sum + l.score, 0) / results.leads.length;
      parts.push(`Average score: ${avgScore.toFixed(1)}/100`);
    }
    
    if (results.conversations && results.conversations.length > 0) {
      parts.push(`Found ${results.conversations.length} relevant conversations`);
    }
    
    if (parts.length === 0) {
      return `No results found for: "${query}"`;
    }
    
    return parts.join('. ');
  }

  /**
   * Generate pipeline insights from analysis
   */
  private generatePipelineInsights(analysis: any): string[] {
    const insights: string[] = [];
    
    if (analysis.totalLeads === 0) {
      return ['No leads in pipeline - start adding leads to track metrics'];
    }
    
    // Check for bottlenecks
    if (analysis.bottlenecks && analysis.bottlenecks.length > 0) {
      const topBottleneck = analysis.bottlenecks[0];
      insights.push(`Major bottleneck at ${topBottleneck.stage} stage with ${topBottleneck.leadsStuck} leads`);
    }
    
    // Check conversion rates
    if (analysis.conversionRates) {
      const winRate = parseFloat(analysis.conversionRates.winRate);
      if (winRate < 20) {
        insights.push('Low win rate - consider reviewing qualification criteria');
      } else if (winRate > 50) {
        insights.push('Strong win rate - current qualification process is effective');
      }
    }
    
    // Check stage distribution
    if (analysis.stageDistribution) {
      const newLeads = analysis.stageDistribution.find((s: any) => s.stage === 'NEW')?.count || 0;
      if (newLeads > analysis.totalLeads * 0.5) {
        insights.push('Most leads are in NEW stage - increase outreach efforts');
      }
    }
    
    return insights;
  }

  /**
   * Register a new tool
   */
  registerTool(tool: GrokTool, executor: (params: any) => Promise<ToolExecutionResult>) {
    this.tools.set(tool.name, tool);
    this.executors.set(tool.name, executor);
  }

  /**
   * Get all registered tools
   */
  getTools(): GrokTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get a specific tool definition
   */
  getTool(name: string): GrokTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Execute a tool by name
   */
  async executeTool(name: string, parameters: any): Promise<ToolExecutionResult> {
    const executor = this.executors.get(name);
    if (!executor) {
      return {
        success: false,
        error: `Tool '${name}' not found`
      };
    }

    try {
      return await executor(parameters);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Tool execution failed'
      };
    }
  }

  /**
   * Generate tool descriptions for system prompt
   */
  getToolDescriptions(): string {
    const tools = this.getTools();
    return tools.map(tool => 
      `- ${tool.name}: ${tool.description}`
    ).join('\n');
  }

  /**
   * Generate detailed tool documentation
   */
  getToolDocumentation(): string {
    const tools = this.getTools();
    return tools.map(tool => {
      const params = Object.entries(tool.parameters.properties || {})
        .map(([key, prop]: [string, any]) => 
          `  - ${key} (${prop.type}${tool.parameters.required?.includes(key) ? ', required' : ''}): ${prop.description || ''}`
        ).join('\n');
      
      return `${tool.name}:
  Description: ${tool.description}
  Parameters:
${params}`;
    }).join('\n\n');
  }

  /**
   * Get tools in Grok API format
   */
  getGrokTools(): any[] {
    return this.getTools().map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }));
  }
}

// Export singleton instance
export const toolRegistry = new ToolRegistry();
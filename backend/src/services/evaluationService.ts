import { prisma } from '../server';
import { grokService } from './grokService';
import { toolRegistry } from './toolRegistry';

interface EvaluationDataset {
  name: string;
  category: 'enterprise' | 'smb' | 'startup' | 'mixed';
  leads: {
    companyName: string;
    employees: number;
    industry: string;
    budget: number;
    expectedScore: number;
    scoringRationale: string;
  }[];
}

interface PromptVersion {
  version: string;
  systemPrompt: string;
  scoringPrompt?: string;
  messagePrompt?: string;
  createdAt: Date;
  metrics?: {
    accuracy: number;
    consistency: number;
    averageDeviation: number;
  };
}

export class EvaluationService {
  private promptVersions: Map<string, PromptVersion> = new Map();
  private currentVersion = 'v1.0';

  constructor() {
    this.initializePromptVersions();
  }

  private initializePromptVersions() {
    // V1.0 - Current production prompt
    this.promptVersions.set('v1.0', {
      version: 'v1.0',
      systemPrompt: `You are an expert AI Sales Development Representative assistant specializing in lead qualification and scoring.`,
      createdAt: new Date('2024-01-01')
    });

    // V1.1 - Enhanced with better industry understanding
    this.promptVersions.set('v1.1', {
      version: 'v1.1',
      systemPrompt: `You are an expert AI Sales Development Representative assistant specializing in lead qualification and scoring.
Focus on identifying high-value signals: company growth trajectory, technology adoption indicators, and budget allocation patterns.`,
      createdAt: new Date('2024-01-15')
    });

    // V1.2 - Improved scoring consistency
    this.promptVersions.set('v1.2', {
      version: 'v1.2',
      systemPrompt: `You are an expert AI Sales Development Representative assistant specializing in lead qualification and scoring.
Apply consistent scoring weights: Company Size (40%), Industry Fit (40%), Budget/Intent (20%).
Prioritize actionable insights over generic assessments.`,
      createdAt: new Date('2024-02-01')
    });
  }

  // Create comprehensive evaluation datasets
  getEvaluationDatasets(): EvaluationDataset[] {
    return [
      {
        name: 'Enterprise Dataset',
        category: 'enterprise',
        leads: [
          {
            companyName: 'Global Finance Corp',
            employees: 5000,
            industry: 'Finance',
            budget: 2000000,
            expectedScore: 95,
            scoringRationale: 'Large enterprise, high budget, target industry'
          },
          {
            companyName: 'Tech Innovations Inc',
            employees: 3000,
            industry: 'Technology',
            budget: 1500000,
            expectedScore: 90,
            scoringRationale: 'Large tech company with substantial budget'
          },
          {
            companyName: 'Healthcare Systems',
            employees: 8000,
            industry: 'Healthcare',
            budget: 500000,
            expectedScore: 75,
            scoringRationale: 'Large but budget below threshold for size'
          }
        ]
      },
      {
        name: 'SMB Dataset',
        category: 'smb',
        leads: [
          {
            companyName: 'Growing SaaS Co',
            employees: 150,
            industry: 'SaaS',
            budget: 200000,
            expectedScore: 70,
            scoringRationale: 'Good industry fit, meets budget threshold'
          },
          {
            companyName: 'Regional Retailer',
            employees: 300,
            industry: 'Retail',
            budget: 100000,
            expectedScore: 50,
            scoringRationale: 'Medium size, non-target industry, low budget'
          },
          {
            companyName: 'Consulting Firm',
            employees: 75,
            industry: 'Consulting',
            budget: 150000,
            expectedScore: 55,
            scoringRationale: 'Small size, moderate budget'
          }
        ]
      },
      {
        name: 'Startup Dataset',
        category: 'startup',
        leads: [
          {
            companyName: 'AI Startup',
            employees: 10,
            industry: 'Technology',
            budget: 50000,
            expectedScore: 35,
            scoringRationale: 'Very small, limited budget despite good industry'
          },
          {
            companyName: 'FinTech Seed',
            employees: 5,
            industry: 'Finance',
            budget: 25000,
            expectedScore: 25,
            scoringRationale: 'Too small, minimal budget'
          },
          {
            companyName: 'Funded Startup',
            employees: 30,
            industry: 'SaaS',
            budget: 300000,
            expectedScore: 65,
            scoringRationale: 'Small but well-funded, good industry fit'
          }
        ]
      }
    ];
  }

  // Run comprehensive evaluation across all datasets
  async runComprehensiveEvaluation(promptVersion?: string): Promise<any> {
    const version = promptVersion || this.currentVersion;
    const datasets = this.getEvaluationDatasets();
    const results = {
      version,
      timestamp: new Date(),
      overallAccuracy: 0,
      datasetResults: [] as any[],
      insights: [] as string[],
      recommendations: [] as string[]
    };

    for (const dataset of datasets) {
      const datasetResult = await this.evaluateDataset(dataset, version);
      results.datasetResults.push(datasetResult);
    }

    // Calculate overall accuracy
    const totalLeads = results.datasetResults.reduce((sum, r) => sum + r.totalLeads, 0);
    const totalCorrect = results.datasetResults.reduce((sum, r) => sum + r.correctPredictions, 0);
    results.overallAccuracy = (totalCorrect / totalLeads) * 100;

    // Generate insights
    results.insights = this.generateInsights(results.datasetResults);
    results.recommendations = this.generateRecommendations(results);

    // Save evaluation test
    await this.saveEvaluationTest(results);

    return results;
  }

  // Evaluate a specific dataset
  private async evaluateDataset(dataset: EvaluationDataset, promptVersion: string): Promise<any> {
    const results = {
      datasetName: dataset.name,
      category: dataset.category,
      totalLeads: dataset.leads.length,
      correctPredictions: 0,
      averageDeviation: 0,
      overvalued: [] as any[],
      undervalued: [] as any[],
      accurate: [] as any[]
    };

    let totalDeviation = 0;

    for (const lead of dataset.leads) {
      // Score with Grok
      const grokScore = await grokService.qualifyLead(lead);
      const deviation = Math.abs(grokScore.score - lead.expectedScore);
      totalDeviation += deviation;

      const result = {
        lead: lead.companyName,
        expected: lead.expectedScore,
        actual: grokScore.score,
        deviation,
        reasoning: grokScore.reasoning
      };

      // Categorize result
      if (deviation <= 10) {
        results.correctPredictions++;
        results.accurate.push(result);
      } else if (grokScore.score > lead.expectedScore) {
        results.overvalued.push(result);
      } else {
        results.undervalued.push(result);
      }
    }

    results.averageDeviation = totalDeviation / dataset.leads.length;
    return results;
  }

  // Generate insights from evaluation results
  private generateInsights(datasetResults: any[]): string[] {
    const insights: string[] = [];

    // Check for category-specific patterns
    for (const result of datasetResults) {
      if (result.category === 'enterprise' && result.averageDeviation > 15) {
        insights.push(`Model struggles with enterprise scoring (avg deviation: ${result.averageDeviation.toFixed(1)})`);
      }
      if (result.category === 'startup' && result.overvalued.length > result.undervalued.length) {
        insights.push('Model tends to overvalue startups - consider adjusting size weight');
      }
      if (result.category === 'smb' && result.correctPredictions / result.totalLeads < 0.6) {
        insights.push('SMB scoring accuracy below 60% - needs calibration');
      }
    }

    // Check for consistent over/undervaluation
    const totalOvervalued = datasetResults.reduce((sum, r) => sum + r.overvalued.length, 0);
    const totalUndervalued = datasetResults.reduce((sum, r) => sum + r.undervalued.length, 0);
    
    if (totalOvervalued > totalUndervalued * 1.5) {
      insights.push('Systematic overvaluation detected across datasets');
    } else if (totalUndervalued > totalOvervalued * 1.5) {
      insights.push('Systematic undervaluation detected across datasets');
    }

    return insights;
  }

  // Generate recommendations based on evaluation
  private generateRecommendations(results: any): string[] {
    const recommendations: string[] = [];

    if (results.overallAccuracy < 70) {
      recommendations.push('Consider adjusting scoring weights or criteria thresholds');
    }

    // Check specific problem areas
    for (const datasetResult of results.datasetResults) {
      if (datasetResult.averageDeviation > 20) {
        recommendations.push(`Review ${datasetResult.category} scoring logic - high deviation detected`);
      }
    }

    // Suggest prompt improvements
    if (results.overallAccuracy < 80) {
      recommendations.push('Test alternative prompt versions for improved accuracy');
      recommendations.push('Consider adding more context about industry-specific scoring');
    }

    return recommendations;
  }

  // Save evaluation test to database
  private async saveEvaluationTest(results: any): Promise<void> {
    try {
      const test = await prisma.evaluationTest.create({
        data: {
          name: `Comprehensive Evaluation - ${results.version}`,
          testType: 'LEAD_QUALIFICATION',
          inputData: results.datasetResults,
          expectedOutput: results.datasetResults.map((d: any) => ({
            dataset: d.datasetName,
            expectedAccuracy: 80
          }))
        }
      });

      await prisma.evaluationResult.create({
        data: {
          testId: test.id,
          promptVersion: results.version,
          actualOutput: results,
          performanceScore: results.overallAccuracy,
          executionTime: 0,
          analysis: {
            insights: results.insights,
            recommendations: results.recommendations
          },
          recommendations: results.recommendations.join('. ')
        }
      });
    } catch (error) {
      console.error('Error saving evaluation test:', error);
    }
  }

  // A/B test different prompt versions
  async runABTest(versionA: string, versionB: string): Promise<any> {
    const resultsA = await this.runComprehensiveEvaluation(versionA);
    const resultsB = await this.runComprehensiveEvaluation(versionB);

    return {
      comparison: {
        [versionA]: {
          accuracy: resultsA.overallAccuracy,
          insights: resultsA.insights
        },
        [versionB]: {
          accuracy: resultsB.overallAccuracy,
          insights: resultsB.insights
        }
      },
      winner: resultsA.overallAccuracy > resultsB.overallAccuracy ? versionA : versionB,
      improvement: Math.abs(resultsA.overallAccuracy - resultsB.overallAccuracy)
    };
  }

  // Test edge cases
  async testEdgeCases(): Promise<any> {
    const edgeCases = [
      {
        name: 'Missing Budget',
        lead: { companyName: 'No Budget Corp', employees: 500, industry: 'Tech' }
      },
      {
        name: 'Unknown Industry',
        lead: { companyName: 'Mystery Inc', employees: 100, industry: 'Unknown', budget: 100000 }
      },
      {
        name: 'Extreme Values',
        lead: { companyName: 'Mega Corp', employees: 100000, industry: 'Finance', budget: 10000000 }
      },
      {
        name: 'Zero Employees',
        lead: { companyName: 'Ghost Co', employees: 0, industry: 'SaaS', budget: 50000 }
      }
    ];

    const results = [];
    for (const testCase of edgeCases) {
      try {
        const score = await grokService.qualifyLead(testCase.lead);
        results.push({
          case: testCase.name,
          success: true,
          score: score.score,
          handling: 'Handled gracefully'
        });
      } catch (error) {
        results.push({
          case: testCase.name,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          handling: 'Failed - needs error handling improvement'
        });
      }
    }

    return results;
  }
}

export const evaluationService = new EvaluationService();
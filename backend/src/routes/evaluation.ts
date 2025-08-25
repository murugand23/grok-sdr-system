import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../server';
import { toolRegistry } from '../services/toolRegistry';
import { evaluationService } from '../services/evaluationService';
import { grokService } from '../services/grokService';

const router = Router();

// Validation schemas
const RunEvaluationSchema = z.object({
  testType: z.enum(['LEAD_QUALIFICATION', 'MESSAGE_PERSONALIZATION']),
  testData: z.array(z.any())
});

// GET /api/evaluation/tests - Get all evaluation tests
router.get('/tests', async (req, res) => {
  try {
    const tests = await prisma.evaluationTest.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { results: true }
        }
      }
    });
    
    res.json(tests);
  } catch (error) {
    console.error('Error fetching tests:', error);
    res.status(500).json({ error: 'Failed to fetch tests' });
  }
});

// POST /api/evaluation/run-with-metrics - Run evaluation with custom prompt and metrics
router.post('/run-with-metrics', async (req, res) => {
  try {
    const { testType, prompt, testCases, metrics, version } = req.body;
    
    if (!prompt || !testCases || testCases.length === 0) {
      return res.status(400).json({ error: 'Prompt and test cases are required' });
    }
    
    const results = {
      total: testCases.length,
      passed: 0,
      failed: 0,
      accuracy: 0,
      avgDeviation: 0,
      testResults: [] as any[],
      failures: [] as any[]
    };
    
    let totalDeviation = 0;
    
    for (const testCase of testCases) {
      let testResult: any = {
        testCase,
        passed: false
      };
      
      try {
        if (testType === 'LEAD_QUALIFICATION') {
          // Score the lead using the custom prompt
          const scoreResponse = await grokService.qualifyLead({
            ...testCase,
            customPrompt: prompt
          });
          
          testResult.actualScore = scoreResponse.score;
          testResult.expectedScore = testCase.expectedScore || 50;
          testResult.deviation = Math.abs(testResult.actualScore - testResult.expectedScore);
          testResult.reasoning = scoreResponse.reasoning || '';
          testResult.recommendations = scoreResponse.recommendations || [];
          
          // Extract breakdown from response if available
          const breakdown = (scoreResponse as any).breakdown;
          console.log('[EVALUATION] Score response:', scoreResponse);
          console.log('[EVALUATION] Breakdown:', breakdown);
          
          // Handle different breakdown formats - dynamically adapt to user's prompt structure
          if (breakdown) {
            console.log('[EVALUATION] Raw breakdown object:', JSON.stringify(breakdown, null, 2));
            
            // Initialize empty breakdown to be populated dynamically
            testResult.breakdown = {};
            
            // Process all keys from the breakdown object
            for (const [key, value] of Object.entries(breakdown)) {
              // Store the value as-is, preserving whatever format the model returns
              if (typeof value === 'number') {
                // If it's just a number, show it as-is
                testResult.breakdown[key] = value;
              } else if (typeof value === 'string') {
                // If it's a string (like "40/40"), keep it
                testResult.breakdown[key] = value;
              } else if (typeof value === 'object' && value !== null) {
                // If it's an object with more detail, stringify it nicely
                testResult.breakdown[key] = JSON.stringify(value);
              } else {
                testResult.breakdown[key] = String(value);
              }
            }
            
            console.log('[EVALUATION] Processed breakdown:', testResult.breakdown);
          } else {
            testResult.breakdown = {
              size: 'N/A',
              industry: 'N/A',
              intent: 'N/A'
            };
          }
          
          totalDeviation += testResult.deviation;
          
          // Check if within tolerance
          const tolerance = metrics?.scoreAccuracy?.tolerance || 10;
          testResult.passed = testResult.deviation <= tolerance;
          
          if (!testResult.passed) {
            testResult.failureReason = `Score deviation ${testResult.deviation} exceeds tolerance ${tolerance}`;
            
            // Check for specific failure patterns
            if (testCase.notes?.toLowerCase().includes('no budget') && 
                breakdown?.intent > 5) {
              results.failures.push({
                type: 'intent_scoring',
                testCase: testCase.name,
                details: 'Intent score too high for "no budget" mention'
              });
            }
            
            if (testResult.deviation > 20) {
              results.failures.push({
                type: 'score_deviation',
                testCase: testCase.name,
                details: `Large deviation: ${testResult.deviation}`
              });
            }
          }
        } else if (testType === 'MESSAGE_PERSONALIZATION') {
          // Generate message and evaluate
          const messageResponse = await grokService.personalizeMessage(
            prompt,
            testCase,
            testCase.linkedin
          );
          
          testResult.generatedMessage = messageResponse;
          
          // Evaluate tone (simple keyword check)
          const professionalKeywords = ['regards', 'best', 'sincerely', 'thank you'];
          const hasProfessionalTone = professionalKeywords.some(kw => 
            messageResponse.toLowerCase().includes(kw)
          );
          testResult.toneScore = hasProfessionalTone ? 95 : 70;
          
          // Count personalization details
          const personalDetails = ['name', 'company', 'industry', 'linkedin'];
          testResult.personalizationCount = personalDetails.filter(detail => 
            messageResponse.toLowerCase().includes(testCase[detail]?.toLowerCase() || '')
          ).length;
          
          // Check relevance
          const relevanceKeywords = metrics?.relevance?.keywords || ['AI', 'automation'];
          const relevantCount = relevanceKeywords.filter((kw: string) => 
            messageResponse.toLowerCase().includes(kw.toLowerCase())
          ).length;
          testResult.relevanceScore = (relevantCount / relevanceKeywords.length) * 100;
          
          // Determine pass/fail
          testResult.passed = 
            testResult.toneScore >= (metrics?.tone?.threshold || 90) &&
            testResult.personalizationCount >= (metrics?.personalization?.minDetails || 2) &&
            testResult.relevanceScore >= 50;
            
          if (!testResult.passed) {
            if (testResult.personalizationCount < 2) {
              results.failures.push({
                type: 'personalization',
                testCase: testCase.name,
                details: `Only ${testResult.personalizationCount} personalized details`
              });
            }
          }
        }
        
        if (testResult.passed) {
          results.passed++;
        } else {
          results.failed++;
        }
      } catch (error) {
        console.error('Test case error:', error);
        testResult.error = error instanceof Error ? error.message : 'Unknown error';
        testResult.passed = false;
        results.failed++;
      }
      
      results.testResults.push(testResult);
    }
    
    // Calculate summary metrics
    results.accuracy = Math.round((results.passed / results.total) * 100);
    results.avgDeviation = testType === 'LEAD_QUALIFICATION' 
      ? totalDeviation / results.total 
      : 0;
    
    // Save to database
    try {
      const test = await prisma.evaluationTest.create({
        data: {
          name: `${testType} Evaluation - ${version}`,
          testType: testType === 'LEAD_QUALIFICATION' ? 'LEAD_QUALIFICATION' : 'MESSAGE_PERSONALIZATION',
          inputData: { prompt, testCases, metrics },
          expectedOutput: testCases
        }
      });
      
      await prisma.evaluationResult.create({
        data: {
          testId: test.id,
          promptVersion: version,
          actualOutput: results,
          performanceScore: results.accuracy,
          executionTime: 0,
          analysis: results,
          recommendations: results.failures.length > 0 
            ? 'Review failure patterns and adjust prompt accordingly'
            : 'Prompt performing well'
        }
      });
    } catch (dbError) {
      console.error('Database save error:', dbError);
    }
    
    res.json(results);
  } catch (error) {
    console.error('Evaluation error:', error);
    res.status(500).json({ error: 'Failed to run evaluation' });
  }
});

// POST /api/evaluation/run - Run an evaluation
router.post('/run', async (req, res) => {
  try {
    const { testType, testData } = RunEvaluationSchema.parse(req.body);
    
    let result: any;
    
    if (testType === 'LEAD_QUALIFICATION') {
      // Run lead scoring evaluation
      result = await toolRegistry.executeTool('evaluate_scoring', {
        testSetName: `Evaluation ${new Date().toISOString()}`,
        testLeads: testData
      });
    } else {
      // Run message personalization evaluation
      result = await toolRegistry.executeTool('evaluate_messaging', {
        testLeads: testData,
        criteria: ['relevance', 'personalization', 'clarity']
      });
    }
    
    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid data', details: error.errors });
    }
    console.error('Error running evaluation:', error);
    res.status(500).json({ error: 'Failed to run evaluation' });
  }
});

// GET /api/evaluation/results/:testId - Get results for a test
router.get('/results/:testId', async (req, res) => {
  try {
    const results = await prisma.evaluationResult.findMany({
      where: { testId: req.params.testId },
      orderBy: { createdAt: 'desc' }
    });
    
    res.json(results);
  } catch (error) {
    console.error('Error fetching results:', error);
    res.status(500).json({ error: 'Failed to fetch results' });
  }
});

// POST /api/evaluation/comprehensive - Run comprehensive evaluation
router.post('/comprehensive', async (req, res) => {
  try {
    const { promptVersion } = req.body;
    const results = await evaluationService.runComprehensiveEvaluation(promptVersion);
    res.json(results);
  } catch (error) {
    console.error('Error running comprehensive evaluation:', error);
    res.status(500).json({ error: 'Failed to run evaluation' });
  }
});

// POST /api/evaluation/ab-test - Run A/B test between prompt versions
router.post('/ab-test', async (req, res) => {
  try {
    const { versionA, versionB } = req.body;
    if (!versionA || !versionB) {
      return res.status(400).json({ error: 'Both versionA and versionB are required' });
    }
    const results = await evaluationService.runABTest(versionA, versionB);
    res.json(results);
  } catch (error) {
    console.error('Error running A/B test:', error);
    res.status(500).json({ error: 'Failed to run A/B test' });
  }
});

// GET /api/evaluation/edge-cases - Test edge cases
router.get('/edge-cases', async (req, res) => {
  try {
    const results = await evaluationService.testEdgeCases();
    res.json(results);
  } catch (error) {
    console.error('Error testing edge cases:', error);
    res.status(500).json({ error: 'Failed to test edge cases' });
  }
});

// GET /api/evaluation/datasets - Get available evaluation datasets
router.get('/datasets', async (req, res) => {
  try {
    const datasets = evaluationService.getEvaluationDatasets();
    res.json(datasets);
  } catch (error) {
    console.error('Error fetching datasets:', error);
    res.status(500).json({ error: 'Failed to fetch datasets' });
  }
});

// GET /api/evaluation/analytics - Get evaluation analytics
router.get('/analytics', async (req, res) => {
  try {
    const recentResults = await prisma.evaluationResult.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        test: true
      }
    });
    
    const avgScore = recentResults.length > 0
      ? recentResults.reduce((sum, r) => sum + r.performanceScore, 0) / recentResults.length
      : 0;
    
    const byType: any = {};
    for (const result of recentResults) {
      const type = result.test.testType;
      if (!byType[type]) {
        byType[type] = { count: 0, totalScore: 0 };
      }
      byType[type].count++;
      byType[type].totalScore += result.performanceScore;
    }
    
    for (const type in byType) {
      byType[type].avgScore = byType[type].totalScore / byType[type].count;
    }
    
    res.json({
      totalTests: recentResults.length,
      averageScore: avgScore,
      byTestType: byType,
      recentTests: recentResults.slice(0, 5).map(r => ({
        id: r.id,
        testName: r.test.name,
        score: r.performanceScore,
        createdAt: r.createdAt
      }))
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

export default router;
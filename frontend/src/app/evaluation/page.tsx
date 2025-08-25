'use client';

import React, { useState, useEffect } from 'react';
import axios from 'axios';

interface TestCase {
  id?: string;
  name: string;
  company?: string;
  size?: number;
  employees?: number;
  industry: string;
  notes?: string;
  budget?: number;
  linkedin?: string;
  expectedScore?: number;
  expectedIntent?: string;
}

interface EvaluationMetrics {
  tone?: { target: string; threshold: number };
  personalization?: { minDetails: number; requiredFields: string[] };
  relevance?: { keywords: string[] };
  scoreAccuracy?: { tolerance: number };
  intentAccuracy?: { mapping: Record<string, number> };
}

interface PromptVersion {
  id: string;
  version: string;
  prompt: string;
  createdAt: string;
  metrics?: any;
}

export default function EvaluationPage() {
  const [testType, setTestType] = useState('LEAD_QUALIFICATION');
  const [currentPrompt, setCurrentPrompt] = useState('');
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [metrics, setMetrics] = useState<EvaluationMetrics>({});
  const [results, setResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [promptVersions, setPromptVersions] = useState<PromptVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<string>('current');
  const [showRecommendations, setShowRecommendations] = useState(false);
  const [failureAnalysis, setFailureAnalysis] = useState<any>(null);

  // Default prompts for different test types
  const defaultPrompts = {
    LEAD_QUALIFICATION: `Given lead data (company size, industry, notes), score the lead from 0-100 based on these EXACT point values:

Company Size (40 points max):
- >500 employees = 40 points
- 100-500 employees = 30 points  
- 50-100 employees = 20 points
- <50 employees = 10 points

Industry (40 points max):
- Tech/SaaS/Finance = 40 points
- All other industries = 20 points

Intent (20 points max):
- Mentions budget/ROI/dollar amounts = 20 points
- Expressed interest/looking into/exploring = 10 points
- No budget mentioned/no interest shown = 0 points

IMPORTANT: The final score is the DIRECT SUM of these points. Do NOT apply any additional weighting or multiplication. 
Example: 40 (size) + 40 (industry) + 20 (intent) = 100 total score

Provide the total score and detailed breakdown showing points for each category.`,
    MESSAGE_PERSONALIZATION: `Generate a personalized cold email for the lead. Requirements:
- Professional tone
- Include at least 2 personalized details (name, company, industry, LinkedIn post, etc.)
- Mention relevant value proposition
- Keep under 100 words
- Include clear call-to-action`
  };

  // Sample test data for different test types
  const sampleTestData = {
    LEAD_QUALIFICATION: [
      {
        name: "Jordan Smith",
        company: "TechCorp",
        employees: 1000,
        industry: "SaaS",
        notes: "Expressed strong interest in AI tools, has budget allocated",
        budget: 200000,
        expectedScore: 100
      },
      {
        name: "Sam Lee",
        company: "RetailInc",
        employees: 30,
        industry: "Retail",
        notes: "No budget mentioned",
        expectedScore: 30
      },
      {
        name: "Alex Chen",
        company: "FinanceGlobal",
        employees: 5000,
        industry: "Finance",
        notes: "Interested but no timeline",
        expectedScore: 90
      }
    ],
    MESSAGE_PERSONALIZATION: [
      {
        name: "Jordan Smith",
        company: "TechCorp",
        industry: "SaaS",
        linkedin: "Posted about AI efficiency and automation needs",
        notes: "Looking to scale sales team"
      },
      {
        name: "Maria Garcia",
        company: "HealthTech",
        industry: "Healthcare",
        linkedin: "Shared article on digital transformation",
        notes: "Recently raised Series B funding"
      }
    ]
  };


  // Default metrics for different test types
  const defaultMetrics = {
    LEAD_QUALIFICATION: {
      scoreAccuracy: { tolerance: 10 },
      intentAccuracy: {
        mapping: {
          "budget": 20,
          "interest": 10,
          "no budget": 0,
          "no mention": 0
        }
      }
    },
    MESSAGE_PERSONALIZATION: {
      tone: { target: "professional", threshold: 90 },
      personalization: { 
        minDetails: 2, 
        requiredFields: ["name", "company", "industry", "linkedin"]
      },
      relevance: { 
        keywords: ["AI", "automation", "efficiency", "sales"]
      }
    }
  };

  useEffect(() => {
    // Load default prompt and test data when test type changes
    setCurrentPrompt(defaultPrompts[testType as keyof typeof defaultPrompts]);
    setTestCases(sampleTestData[testType as keyof typeof sampleTestData]);
    setMetrics(defaultMetrics[testType as keyof typeof defaultMetrics]);
    setResults(null);
    setFailureAnalysis(null);
  }, [testType]);

  const handleAddTestCase = () => {
    const newTestCase = testType === 'LEAD_QUALIFICATION' 
      ? { name: "", company: "", employees: 0, industry: "", notes: "", expectedScore: 50 }
      : { name: "", company: "", industry: "", linkedin: "", notes: "" };
    setTestCases([...testCases, newTestCase]);
  };

  const handleUpdateTestCase = (index: number, field: string, value: any) => {
    const updated = [...testCases];
    updated[index] = { ...updated[index], [field]: value };
    setTestCases(updated);
  };

  const handleRemoveTestCase = (index: number) => {
    setTestCases(testCases.filter((_, i) => i !== index));
  };

  const runEvaluation = async () => {
    if (!currentPrompt.trim() || testCases.length === 0) {
      alert('Please provide a prompt and at least one test case');
      return;
    }

    setLoading(true);
    setResults(null);
    setFailureAnalysis(null);

    try {
      const response = await axios.post('/api/evaluation/run-with-metrics', {
        testType,
        prompt: currentPrompt,
        testCases,
        metrics,
        version: selectedVersion === 'current' ? `v${Date.now()}` : selectedVersion
      });
      
      setResults(response.data);
      
      // Analyze failures if any
      if (response.data.failed > 0 && response.data.testResults) {
        analyzeFailures(response.data.failures || [], response.data.testResults);
      }
    } catch (error: any) {
      console.error('Evaluation error:', error);
      setResults({
        success: false,
        error: error.response?.data?.error || 'Failed to run evaluation'
      });
    } finally {
      setLoading(false);
    }
  };

  const analyzeFailures = (_failures: any[], testResults: any[]) => {
    const recommendations: string[] = [];
    const failedTests = testResults.filter((r: any) => !r.passed);
    
    // Analyze specific failure patterns from test results
    failedTests.forEach((test: any) => {
      const deviation = test.deviation || 0;
      const expectedScore = test.expectedScore || 0;
      const actualScore = test.actualScore || 0;
      
      // Specific recommendations based on deviation patterns
      if (deviation > 30) {
        recommendations.push(`Large deviation for "${test.testCase.name}": Expected ${expectedScore}, got ${actualScore}. Consider adjusting the scoring criteria for ${test.testCase.industry || 'this industry'}.`);
      } else if (deviation > 15) {
        recommendations.push(`Moderate deviation for "${test.testCase.name}". The model may need more specific guidance for ${test.testCase.employees || 'company size'} employees.`);
      }
      
      // Check breakdown for specific issues
      if (test.breakdown) {
        Object.entries(test.breakdown).forEach(([category, value]) => {
          const strValue = String(value);
          if (strValue === '0' || strValue === 'N/A') {
            recommendations.push(`${category} scoring failed for "${test.testCase.name}". Ensure the prompt has clear rules for this category.`);
          }
        });
      }
      
      // Check for specific test case patterns
      if (test.testCase.notes?.toLowerCase().includes('no budget') && actualScore > expectedScore) {
        recommendations.push(`"${test.testCase.name}" mentions 'no budget' but scored higher than expected. Add explicit rule: "no budget mentioned" = 0 points for intent/budget category.`);
      }
      
      if (test.testCase.notes?.toLowerCase().includes('interested') && actualScore < expectedScore) {
        recommendations.push(`"${test.testCase.name}" shows interest but scored lower than expected. Clarify how to score expressions of interest.`);
      }
    });
    
    // If no specific recommendations, provide general guidance
    if (recommendations.length === 0 && failedTests.length > 0) {
      recommendations.push('Review the scoring criteria to ensure they align with expected outcomes.');
      recommendations.push('Consider adding more specific examples in the prompt.');
    }
    
    // Remove duplicates and limit to top 5 most relevant
    const uniqueRecommendations = Array.from(new Set(recommendations)).slice(0, 5);
    
    setFailureAnalysis({ recommendations: uniqueRecommendations });
    setShowRecommendations(true);
  };

  const savePromptVersion = () => {
    const newVersion: PromptVersion = {
      id: `v${Date.now()}`,
      version: `v${promptVersions.length + 1}.${Date.now() % 100}`,
      prompt: currentPrompt,
      createdAt: new Date().toISOString(),
      metrics: results
    };
    setPromptVersions([...promptVersions, newVersion]);
    alert(`Saved as ${newVersion.version}`);
  };


  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">🧪 Model Evaluation Framework</h2>
        <p className="text-gray-600">
          Test and refine prompts for lead scoring and message personalization with detailed metrics.
        </p>
      </div>

      {/* Test Configuration */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="text-lg font-semibold mb-4">Test Configuration</h3>
        
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Test Type
            </label>
            <select
              value={testType}
              onChange={(e) => setTestType(e.target.value)}
              className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="LEAD_QUALIFICATION">Lead Qualification</option>
              <option value="MESSAGE_PERSONALIZATION">Message Personalization</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Prompt Version
            </label>
            <select
              value={selectedVersion}
              onChange={(e) => setSelectedVersion(e.target.value)}
              className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="current">Current (Unsaved)</option>
              {promptVersions.map(v => (
                <option key={v.id} value={v.id}>{v.version}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Prompt Editor */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Prompt Template
          </label>
          <textarea
            value={currentPrompt}
            onChange={(e) => setCurrentPrompt(e.target.value)}
            rows={8}
            className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
            placeholder="Enter your prompt template..."
          />
          <button
            onClick={savePromptVersion}
            className="mt-2 text-sm text-blue-600 hover:text-blue-800"
          >
            💾 Save Version
          </button>
        </div>


        {/* Test Cases */}
        <div className="mb-6">
          <div className="flex justify-between items-center mb-2">
            <h4 className="text-sm font-medium text-gray-700">Test Cases</h4>
            <button
              onClick={handleAddTestCase}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              + Add Test Case
            </button>
          </div>
          
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {testCases.map((testCase, index) => (
              <div key={index} className="border rounded-lg p-3 bg-gray-50">
                <div className="grid grid-cols-3 gap-2 mb-2">
                  <div>
                    <label className="text-xs text-gray-500">Contact Name</label>
                    <input
                      type="text"
                      value={testCase.name}
                      onChange={(e) => handleUpdateTestCase(index, 'name', e.target.value)}
                      placeholder="e.g., Jordan Smith"
                      className="w-full px-2 py-1 border rounded text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Company Name</label>
                    <input
                      type="text"
                      value={testCase.company}
                      onChange={(e) => handleUpdateTestCase(index, 'company', e.target.value)}
                      placeholder="e.g., TechCorp"
                      className="w-full px-2 py-1 border rounded text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Industry/Sector</label>
                    <input
                      type="text"
                      value={testCase.industry}
                      onChange={(e) => handleUpdateTestCase(index, 'industry', e.target.value)}
                      placeholder="e.g., SaaS, Finance"
                      className="w-full px-2 py-1 border rounded text-sm"
                    />
                  </div>
                </div>
                
                {testType === 'LEAD_QUALIFICATION' ? (
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    <div>
                      <label className="text-xs text-gray-500">Number of Employees</label>
                      <input
                        type="number"
                        value={testCase.employees || ''}
                        onChange={(e) => handleUpdateTestCase(index, 'employees', parseInt(e.target.value))}
                        placeholder="e.g., 1000"
                        className="w-full px-2 py-1 border rounded text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">Expected Score (0-100)</label>
                      <input
                        type="number"
                        value={testCase.expectedScore || ''}
                        onChange={(e) => handleUpdateTestCase(index, 'expectedScore', parseInt(e.target.value))}
                        placeholder="e.g., 85"
                        className="w-full px-2 py-1 border rounded text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">&nbsp;</label>
                      <button
                        onClick={() => handleRemoveTestCase(index)}
                        className="w-full px-2 py-1 text-red-600 hover:text-red-800 text-sm border border-red-300 rounded hover:bg-red-50"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mb-2">
                    <label className="text-xs text-gray-500">LinkedIn Context / Social Media Activity</label>
                    <input
                      type="text"
                      value={testCase.linkedin || ''}
                      onChange={(e) => handleUpdateTestCase(index, 'linkedin', e.target.value)}
                      placeholder="e.g., Posted about AI efficiency and automation needs"
                      className="w-full px-2 py-1 border rounded text-sm mb-2"
                    />
                    <button
                      onClick={() => handleRemoveTestCase(index)}
                      className="w-full px-2 py-1 text-red-600 hover:text-red-800 text-sm border border-red-300 rounded hover:bg-red-50"
                    >
                      Remove Test Case
                    </button>
                  </div>
                )}
                
                <div>
                  <label className="text-xs text-gray-500">Notes / Intent Signals (Important for scoring)</label>
                  <textarea
                    value={testCase.notes || ''}
                    onChange={(e) => handleUpdateTestCase(index, 'notes', e.target.value)}
                    placeholder="e.g., 'Expressed strong interest in AI tools, has budget allocated' or 'No budget mentioned'"
                    className="w-full px-2 py-1 border rounded text-sm"
                    rows={2}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Run Button */}
        <button
          onClick={runEvaluation}
          disabled={loading || testCases.length === 0}
          className="w-full py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
        >
          {loading ? '⏳ Running Evaluation...' : '🚀 Run Evaluation'}
        </button>
      </div>

      {/* Results */}
      {results && (
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h3 className="text-xl font-bold text-gray-900 mb-4">📊 Evaluation Results</h3>
          
          {results.success === false ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-red-800">Error: {results.error}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Summary Stats */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-green-50 rounded-lg p-4">
                  <p className="text-sm text-gray-600">Passed</p>
                  <p className="text-2xl font-bold text-green-600">
                    {results.passed || 0}/{results.total || 0}
                  </p>
                </div>
                <div className="bg-yellow-50 rounded-lg p-4">
                  <p className="text-sm text-gray-600">Accuracy</p>
                  <p className="text-2xl font-bold text-yellow-600">
                    {results.accuracy || 0}%
                  </p>
                </div>
                <div className="bg-blue-50 rounded-lg p-4">
                  <p className="text-sm text-gray-600">Avg Deviation</p>
                  <p className="text-2xl font-bold text-blue-600">
                    {results.avgDeviation?.toFixed(1) || 0}
                  </p>
                </div>
              </div>

              {/* Individual Test Results */}
              <div className="space-y-3">
                <h4 className="font-semibold">Test Case Results:</h4>
                {results.testResults?.map((result: any, idx: number) => (
                  <div key={idx} className={`border rounded-lg p-4 ${
                    result.passed ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
                  }`}>
                    <div className="flex justify-between items-start mb-2">
                      <h5 className="font-medium">
                        {result.testCase.name} - {result.testCase.company}
                      </h5>
                      <span className={`px-2 py-1 rounded text-xs font-semibold ${
                        result.passed ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                      }`}>
                        {result.passed ? 'PASS' : 'FAIL'}
                      </span>
                    </div>
                    
                    {testType === 'LEAD_QUALIFICATION' ? (
                      <div>
                        <p className="text-sm mb-1">
                          Score: {result.actualScore}/100 (Expected: {result.expectedScore}/100)
                        </p>
                        <p className="text-sm mb-2">Deviation: {result.deviation}</p>
                        <div className="text-xs bg-white rounded p-2 mb-2">
                          <p className="font-semibold mb-1">Score Breakdown:</p>
                          {result.breakdown && Object.keys(result.breakdown).length > 0 ? (
                            Object.entries(result.breakdown).map(([category, value]) => (
                              <p key={category}>
                                • {category}: {
                                  typeof value === 'object' && value !== null && 'points' in value
                                    ? `${(value as any).points || 0} points`
                                    : String(value)
                                }
                              </p>
                            ))
                          ) : (
                            <p className="text-gray-500">No breakdown available</p>
                          )}
                        </div>
                        
                        {/* Qualitative Analysis */}
                        {result.reasoning && (
                          <div className="text-xs bg-blue-50 rounded p-2 mb-2">
                            <p className="font-semibold mb-1">Grok's Analysis:</p>
                            <p className="text-gray-700">{result.reasoning}</p>
                          </div>
                        )}
                        
                        {/* Recommendations */}
                        {result.recommendations && result.recommendations.length > 0 && (
                          <div className="text-xs bg-yellow-50 rounded p-2 mb-2">
                            <p className="font-semibold mb-1">Recommendations:</p>
                            <ul className="list-disc list-inside text-gray-700">
                              {result.recommendations.map((rec: string, idx: number) => (
                                <li key={idx}>{rec}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        
                        {!result.passed && (
                          <p className="text-xs text-red-600 mt-2">
                            ⚠ {result.failureReason}
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="text-sm">
                        <p>✓ Tone: {result.toneScore}% match</p>
                        <p>✓ Personalization: {result.personalizationCount} details</p>
                        <p>✓ Relevance: {result.relevanceScore}%</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Failure Analysis & Recommendations */}
              {showRecommendations && failureAnalysis && failureAnalysis.recommendations.length > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <h4 className="font-semibold text-yellow-900 mb-3">
                    💡 Recommendations to Improve Scoring Accuracy
                  </h4>
                  
                  <ul className="space-y-2">
                    {failureAnalysis.recommendations.map((rec: string, idx: number) => (
                      <li key={idx} className="text-sm text-yellow-800">
                        <span className="font-medium">→</span> {rec}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
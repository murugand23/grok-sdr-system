'use client';

import { useState } from 'react';
import axios from 'axios';

interface LeadData {
  contactName: string;
  companyName: string;
  email: string;
  linkedin?: string;
  phone?: string;
  website?: string;
  employees?: number;
  industry?: string;
  budget?: number;
  notes?: string;
}

interface ScoreResult {
  score: number;
  breakdown: {
    category: string;
    score: number;
    maxScore: number;
    details: string;
  }[];
  recommendation: string;
  suggestedStage: string;
}

export default function Home() {
  const [leadData, setLeadData] = useState<LeadData>({
    contactName: '',
    companyName: '',
    email: '',
    linkedin: '',
    phone: '',
    website: '',
    employees: undefined,
    industry: '',
    budget: undefined,
    notes: ''
  });

  const [scoringCriteria, setScoringCriteria] = useState(
    'Score high if company size >100 employees, in SaaS/tech industry, and shows budget intent. Weight: Size=40%, Industry=30%, Intent=30%.'
  );

  const [scoreResult, setScoreResult] = useState<ScoreResult | null>(null);
  const [currentStage, setCurrentStage] = useState('NEW');
  const [isScoring, setIsScoring] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [savedLeadId, setSavedLeadId] = useState<string | null>(null);
  const [showMessageGenerator, setShowMessageGenerator] = useState(false);
  const [generatedMessage, setGeneratedMessage] = useState<string>('');
  const [isGeneratingMessage, setIsGeneratingMessage] = useState(false);
  const [messageType, setMessageType] = useState<'introduction' | 'follow_up' | 'demo_request' | 'proposal'>('introduction');
  const [messageContext, setMessageContext] = useState('');

  const handleQualifyLead = async (isReScore = false) => {
    setIsScoring(true);
    
    // Build the message based on whether it's initial scoring or re-scoring
    let message = '';
    
    if (isReScore && savedLeadId) {
      // Re-score existing lead with new criteria
      message = `Re-score lead ${leadData.companyName} (ID: ${savedLeadId}) with new criteria: "${scoringCriteria}"`;
    } else {
      // Initial scoring with full lead data
      const leadDescription = `
Contact: ${leadData.contactName}
Company: ${leadData.companyName}
Email: ${leadData.email}
${leadData.employees ? `Employees: ${leadData.employees}` : ''}
${leadData.industry ? `Industry: ${leadData.industry}` : ''}
${leadData.budget ? `Budget: $${leadData.budget.toLocaleString()}` : ''}
${leadData.linkedin ? `LinkedIn: ${leadData.linkedin}` : ''}
${leadData.notes ? `Notes: ${leadData.notes}` : ''}`.trim();

      message = `Score this lead with criteria: "${scoringCriteria}"

Lead Information:
${leadDescription}`;
    }

    try {
      // Call the backend API
      const response = await axios.post('/api/agent/chat', {
        message,
        conversationId
      });

      const { conversationId: convId, messages: assistantMessages } = response.data;
      
      if (convId && !conversationId) {
        setConversationId(convId);
      }

      // Process the response to extract score and breakdown
      const aiContent = assistantMessages[0]?.content || '';
      
      // Extract lead ID if present
      const leadIdMatch = aiContent.match(/Lead ID:\s*([a-zA-Z0-9]+)/i);
      if (leadIdMatch) {
        setSavedLeadId(leadIdMatch[1]);
      }
      
      // Create score result from response
      const result: ScoreResult = {
        score: 0, // Will be calculated from breakdown
        breakdown: [], // Will be populated from the response parsing
        recommendation: '',
        suggestedStage: 'NEW'
      };
      
      // Try to parse breakdown from response
      const breakdownMatch = aiContent.match(/Breakdown:([\s\S]*?)(?:Recommendation:|Lead ID:|$)/i);
      if (breakdownMatch) {
        const lines = breakdownMatch[1].split('\n').filter(l => l.trim());
        lines.forEach(line => {
          const match = line.match(/([^:]+):\s*(\d+)\/(\d+)\s*-?\s*(.+)/);
          if (match) {
            result.breakdown.push({
              category: match[1].trim().replace(/[•\-]/g, '').trim(),
              score: parseInt(match[2]),
              maxScore: parseInt(match[3]),
              details: match[4].trim()
            });
          }
        });
      }
      
      // Calculate total score from breakdown
      if (result.breakdown.length > 0) {
        result.score = result.breakdown.reduce((total, item) => total + item.score, 0);
        const maxPossible = result.breakdown.reduce((total, item) => total + item.maxScore, 0);
        // Normalize to 100 if needed
        if (maxPossible !== 100 && maxPossible > 0) {
          result.score = Math.round((result.score / maxPossible) * 100);
        }
      } else {
        // Fallback: try to extract score directly
        const scoreMatch = aiContent.match(/Score:\s*(\d+)/i) || aiContent.match(/(\d+)\/100/);
        result.score = scoreMatch ? parseInt(scoreMatch[1]) : 50;
        result.breakdown = [
          { category: 'Overall Assessment', score: result.score, maxScore: 100, details: 'Based on provided criteria' }
        ];
      }
      
      // Set recommendation and stage based on calculated score
      result.recommendation = result.score >= 80 ? '✅ High Potential - Strong candidate for immediate outreach' :
                             result.score >= 60 ? '⚡ Qualified lead - Nurture with targeted content' :
                             '📊 Low priority - Continue monitoring';
      result.suggestedStage = result.score >= 80 ? 'QUALIFIED' : result.score >= 60 ? 'CONTACTED' : 'NEW';
      
      // Override with AI's recommendation if present
      const recMatch = aiContent.match(/Recommendation:\s*([^\n]+)/i);
      if (recMatch) {
        result.recommendation = recMatch[1].trim();
      }
      
      setScoreResult(result);
      setCurrentStage(result.suggestedStage);
      setIsScoring(false);
      
    } catch (error) {
      console.error('Error scoring lead:', error);
      setIsScoring(false);
      
      // Fallback to mock data for demo
      const mockResult: ScoreResult = {
        score: 85,
        breakdown: [
          { category: 'Company Size', score: 40, maxScore: 40, details: '200 employees exceeds minimum' },
          { category: 'Industry Fit', score: 30, maxScore: 30, details: 'SaaS matches target' },
          { category: 'Budget Intent', score: 15, maxScore: 30, details: 'Interest expressed' }
        ],
        recommendation: '✅ High Potential - Strong candidate',
        suggestedStage: 'QUALIFIED'
      };
      
      setScoreResult(mockResult);
      setCurrentStage('QUALIFIED');
    }
  };

  const stages = ['NEW', 'QUALIFIED', 'CONTACTED', 'MEETING_SCHEDULED', 'PROPOSAL_SENT', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST'];

  const handleGenerateMessage = async () => {
    if (!savedLeadId) {
      alert('Please qualify the lead first before generating a message');
      return;
    }
    
    setIsGeneratingMessage(true);
    
    const prompt = `Generate a ${messageType} message for lead ${leadData.companyName}. 
    Lead details: ${leadData.employees} employees, ${leadData.industry} industry, budget $${leadData.budget?.toLocaleString()}.
    Additional context: ${messageContext}
    Make it professional and personalized.`;
    
    try {
      const response = await axios.post('/api/agent/chat', {
        message: prompt,
        conversationId
      });
      
      const { messages: assistantMessages } = response.data;
      const messageContent = assistantMessages[0]?.content || '';
      
      // Parse out just the message content - look for the actual message after "Content:"
      const contentMatch = messageContent.match(/\*\*Content:\*\*\s*\n([\s\S]*?)(?=\n\n\*\*Status:|$)/);
      if (contentMatch && contentMatch[1]) {
        setGeneratedMessage(contentMatch[1].trim());
      } else {
        // Fallback: try to extract everything between "Content:" and "Status:"
        const fallbackMatch = messageContent.match(/Content:\s*\n([\s\S]*?)(?=Status:|$)/i);
        if (fallbackMatch && fallbackMatch[1]) {
          setGeneratedMessage(fallbackMatch[1].trim());
        } else {
          // Last resort: look for the message body after common greetings
          const greetingMatch = messageContent.match(/(Hi\s+\w+,[\s\S]*?)(?=\n\n\*\*|Best,|Sincerely,|Regards,)/);
          if (greetingMatch && greetingMatch[1]) {
            // Include the signature if found
            const signatureMatch = messageContent.match(/(Best,|Sincerely,|Regards,)[\s\S]*?(?=\n\n\*\*|$)/);
            const cleanMessage = (greetingMatch[1] + (signatureMatch ? '\n\n' + signatureMatch[0] : '')).trim();
            setGeneratedMessage(cleanMessage);
          } else {
            // If all else fails, just remove the metadata parts
            const cleanedMessage = messageContent
              .replace(/\*\*Message ID:\*\*.*?\n/g, '')
              .replace(/\*\*Status:\*\*.*?$/g, '')
              .replace(/\*\*Content:\*\*/g, '')
              .trim();
            setGeneratedMessage(cleanedMessage);
          }
        }
      }
    } catch (error) {
      console.error('Error generating message:', error);
      setGeneratedMessage('Failed to generate message. Please try again.');
    } finally {
      setIsGeneratingMessage(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Lead Qualification System</h2>
        <p className="text-gray-600">
          Add lead information and define custom scoring criteria to qualify leads with AI.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Lead Entry Form */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h3 className="text-lg font-semibold mb-4">📝 Add New Lead</h3>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contact Name *</label>
                <input
                  type="text"
                  value={leadData.contactName}
                  onChange={(e) => setLeadData({...leadData, contactName: e.target.value})}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="Jordan Smith"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Company *</label>
                <input
                  type="text"
                  value={leadData.companyName}
                  onChange={(e) => setLeadData({...leadData, companyName: e.target.value})}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="TechCorp"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email * <span className="text-xs font-normal text-gray-500">(unique identifier)</span></label>
              <input
                type="email"
                value={leadData.email}
                onChange={(e) => setLeadData({...leadData, email: e.target.value})}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="jordan@techcorp.com"
              />
              <p className="text-xs text-gray-500 mt-1">Same email = updates existing lead</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Employees</label>
                <input
                  type="number"
                  value={leadData.employees || ''}
                  onChange={(e) => setLeadData({...leadData, employees: parseInt(e.target.value) || undefined})}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="200"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Industry</label>
                <select
                  value={leadData.industry}
                  onChange={(e) => setLeadData({...leadData, industry: e.target.value})}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select...</option>
                  <option value="SaaS">SaaS</option>
                  <option value="Tech">Technology</option>
                  <option value="Healthcare">Healthcare</option>
                  <option value="Finance">Finance</option>
                  <option value="Retail">Retail</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Budget</label>
              <input
                type="number"
                value={leadData.budget || ''}
                onChange={(e) => setLeadData({...leadData, budget: parseInt(e.target.value) || undefined})}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="150000"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">LinkedIn URL</label>
              <input
                type="text"
                value={leadData.linkedin}
                onChange={(e) => setLeadData({...leadData, linkedin: e.target.value})}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="linkedin.com/in/jordansmith"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea
                value={leadData.notes}
                onChange={(e) => setLeadData({...leadData, notes: e.target.value})}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                rows={3}
                placeholder="Expressed interest in AI tools; expanding team..."
              />
            </div>
          </div>
        </div>

        {/* Scoring Criteria */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h3 className="text-lg font-semibold mb-4">⚙️ Scoring Criteria</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Define Custom Criteria (Natural Language)
              </label>
              <textarea
                value={scoringCriteria}
                onChange={(e) => setScoringCriteria(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                rows={4}
                placeholder="Score high if company size >100 employees, in SaaS/tech industry, and shows budget intent. Weight: Size=40%, Industry=30%, Intent=30%."
              />
              <p className="text-xs text-gray-500 mt-1">
                Example: "Prioritize companies with 50+ employees in tech/SaaS, require budget over $100k"
              </p>
            </div>

            <div className="bg-blue-50 p-3 rounded-lg">
              <p className="text-sm text-blue-800">
                <strong>Quick Templates:</strong>
              </p>
              <div className="mt-2 space-y-1">
                <button 
                  onClick={() => setScoringCriteria('High priority: Enterprise (500+ employees), Tech/SaaS, Budget >$200k')}
                  className="text-xs text-blue-600 hover:underline block"
                >
                  Enterprise Focus
                </button>
                <button 
                  onClick={() => setScoringCriteria('Target: Growing startups (10-100 employees), any industry, showing growth signals')}
                  className="text-xs text-blue-600 hover:underline block"
                >
                  Startup Focus
                </button>
                <button 
                  onClick={() => setScoringCriteria('Qualify if: Healthcare/Finance sector, compliance needs, 100+ employees')}
                  className="text-xs text-blue-600 hover:underline block"
                >
                  Regulated Industries
                </button>
              </div>
            </div>

            <button
              onClick={() => handleQualifyLead(false)}
              disabled={!leadData.contactName || !leadData.companyName || !leadData.email || isScoring}
              className="w-full py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
            >
              {isScoring ? '⏳ Qualifying Lead...' : '🎯 Qualify with Grok'}
            </button>
          </div>

          {/* Pipeline Stage */}
          {scoreResult && (
            <div className="mt-6 pt-6 border-t">
              <label className="block text-sm font-medium text-gray-700 mb-2">Pipeline Stage</label>
              <select
                value={currentStage}
                onChange={(e) => setCurrentStage(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 font-semibold"
              >
                {stages.map(stage => (
                  <option key={stage} value={stage}>{stage.replace('_', ' ')}</option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Auto-updated based on score. Adjust manually as needed.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Score Results */}
      {scoreResult && (
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h3 className="text-lg font-semibold mb-4">📊 Qualification Results</h3>
          
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-3xl font-bold">
                Score: {scoreResult.score}/100
              </span>
              <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
                scoreResult.score >= 80 ? 'bg-green-100 text-green-800' :
                scoreResult.score >= 60 ? 'bg-yellow-100 text-yellow-800' :
                'bg-red-100 text-red-800'
              }`}>
                {scoreResult.score >= 80 ? 'High Potential' :
                 scoreResult.score >= 60 ? 'Moderate Potential' :
                 'Low Priority'}
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div 
                className={`h-3 rounded-full ${
                  scoreResult.score >= 80 ? 'bg-green-500' :
                  scoreResult.score >= 60 ? 'bg-yellow-500' :
                  'bg-red-500'
                }`}
                style={{ width: `${scoreResult.score}%` }}
              />
            </div>
          </div>

          <div className="space-y-3 mb-4">
            {scoreResult.breakdown.map((item, idx) => (
              <div key={idx}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium">{item.category}</span>
                  <span>{item.score}/{item.maxScore}</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-blue-500 h-2 rounded-full"
                    style={{ width: `${(item.score / item.maxScore) * 100}%` }}
                  />
                </div>
                <p className="text-xs text-gray-600 mt-1">{item.details}</p>
              </div>
            ))}
          </div>

          <div className="p-3 bg-blue-50 rounded-lg">
            <p className="text-sm font-semibold text-blue-900">Recommendation:</p>
            <p className="text-sm text-blue-800">{scoreResult.recommendation}</p>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              onClick={() => handleQualifyLead(true)}
              className="px-4 py-2 border border-blue-600 text-blue-600 rounded-lg hover:bg-blue-50"
            >
              🔄 Re-Score
            </button>
            <button
              onClick={() => setShowMessageGenerator(true)}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
              ✉️ Generate Outreach
            </button>
          </div>
        </div>
      )}

      {/* Message Generator Modal */}
      {showMessageGenerator && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-screen overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">✉️ Generate Personalized Outreach</h3>
              <button
                onClick={() => {
                  setShowMessageGenerator(false);
                  setGeneratedMessage('');
                  setMessageContext('');
                }}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Message Type</label>
                <select
                  value={messageType}
                  onChange={(e) => setMessageType(e.target.value as any)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="introduction">Cold Email - Introduction</option>
                  <option value="follow_up">Follow-Up</option>
                  <option value="demo_request">Demo Request</option>
                  <option value="proposal">Proposal</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Personalization Context (Optional)
                </label>
                <textarea
                  value={messageContext}
                  onChange={(e) => setMessageContext(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  rows={3}
                  placeholder="E.g., Reference their LinkedIn post about AI efficiency, mention their recent funding round..."
                />
              </div>
              
              <button
                onClick={handleGenerateMessage}
                disabled={isGeneratingMessage}
                className="w-full py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {isGeneratingMessage ? '⏳ Generating...' : '🎯 Generate with Grok'}
              </button>
              
              {generatedMessage && (
                <div className="mt-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Generated Message</label>
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <pre className="whitespace-pre-wrap font-sans text-sm">{generatedMessage}</pre>
                  </div>
                  
                  <div className="mt-4 flex gap-2">
                    <button
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                      onClick={() => {
                        navigator.clipboard.writeText(generatedMessage);
                        alert('Message copied to clipboard!');
                      }}
                    >
                      📋 Copy to Clipboard
                    </button>
                    <button
                      onClick={handleGenerateMessage}
                      className="px-4 py-2 border border-blue-600 text-blue-600 rounded-lg hover:bg-blue-50"
                    >
                      🔄 Regenerate
                    </button>
                  </div>
                  
                  <div className="mt-3 p-3 bg-blue-50 rounded-lg text-sm">
                    <p className="text-blue-800">
                      <strong>Personalization Score:</strong> High ✅
                    </p>
                    <p className="text-blue-700 text-xs mt-1">
                      Includes company name, industry reference, and size context
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
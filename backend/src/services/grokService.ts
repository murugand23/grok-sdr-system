import axios, { AxiosInstance } from 'axios';
import { z } from 'zod';

// Response schemas for validation
const GrokResponseSchema = z.object({
  choices: z.array(z.object({
    message: z.object({
      content: z.string()
    })
  }))
});

export class GrokService {
  private client: AxiosInstance;
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.GROK_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('GROK_API_KEY is not configured');
    }

    this.client = axios.create({
      baseURL: process.env.GROK_API_URL || 'https://api.x.ai/v1',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000 // 30 second timeout
    });
  }

  // Core method to call Grok API with retry logic
  private async callGrok(
    prompt: string, 
    systemPrompt?: string, 
    temperature: number = 0.7,
    tools?: any[]
  ): Promise<any> {
    const maxRetries = 3;
    let lastError: any;

    for (let i = 0; i < maxRetries; i++) {
      try {
        const requestBody: any = {
          model: 'grok-2-latest',
          messages: [
            ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
            { role: 'user', content: prompt }
          ],
          stream: false,
          temperature,
          max_tokens: 2000
        };

        // Add tools if provided
        if (tools && tools.length > 0) {
          requestBody.tools = tools;
        }

        const response = await this.client.post('/chat/completions', requestBody);

        // If tools were used, return the full response for tool call handling
        if (tools && response.data.choices[0].message.tool_calls) {
          return response.data;
        }

        // Otherwise return just the content
        const validated = GrokResponseSchema.parse(response.data);
        return validated.choices[0].message.content;
      } catch (error: any) {
        lastError = error;
        if (error.response?.status === 429) {
          // Rate limited - wait before retry
          await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
        } else if (error.response?.status >= 500) {
          // Server error - retry with backoff
          await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        } else {
          // Client error - don't retry
          throw error;
        }
      }
    }
    
    throw lastError;
  }

  // Lead qualification assessment
  async qualifyLead(leadData: any): Promise<{
    score: number;
    reasoning: string;
    recommendations: string[];
    breakdown?: any;
  }> {
    // Use custom prompt if provided, otherwise use default
    let systemPrompt: string;
    let prompt: string;
    
    if (leadData.customPrompt) {
      // Use the custom prompt from evaluation
      systemPrompt = `You are an expert sales development representative. Follow the scoring rules EXACTLY as specified in the prompt.

IMPORTANT: 
- Parse and apply the scoring rules from the prompt exactly as written
- The breakdown should show the actual points awarded for each category
- Return your response in JSON format with: 
  - score (the total score based on the rules)
  - breakdown (object with category names and their awarded points)
  - reasoning (detailed explanation of the scoring)
  - recommendations (array of actionable suggestions)`;
      
      prompt = `${leadData.customPrompt}

Lead Information:
- Company: ${leadData.company || leadData.companyName}
- Contact: ${leadData.name || leadData.contactName}  
- Industry: ${leadData.industry}
- Employees: ${leadData.employees || leadData.size || 'Not provided'}
- Notes: ${leadData.notes || 'None'}
- Budget: ${leadData.budget || 'Not mentioned'}

Apply the scoring rules from above to this lead. Show the breakdown with actual points awarded for each category.`;
    } else {
      // Default prompt for regular scoring
      systemPrompt = `You are an expert sales development representative. Analyze leads and provide qualification scores.
Return your response in JSON format with: score (0-100), reasoning (string), recommendations (array of strings).`;
      
      prompt = `Analyze this lead for sales qualification:
    Company: ${leadData.companyName}
    Contact: ${leadData.contactName}
    Email: ${leadData.email}
    Website: ${leadData.website || 'Not provided'}
    Company Data: ${JSON.stringify(leadData.companyData || {})}
    
    Evaluate based on:
    1. Company fit and size
    2. Industry relevance
    3. Potential budget
    4. Decision-making authority
    5. Timing and urgency
    
    Provide a qualification score (0-100) and detailed reasoning.`;
    }

    try {
      const response = await this.callGrok(prompt, systemPrompt, 0.3);
      
      // Clean up response if it contains markdown code blocks
      let cleanResponse = response;
      if (typeof response === 'string') {
        if (response.includes('```json')) {
          cleanResponse = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        } else if (response.includes('```')) {
          cleanResponse = response.replace(/```\n?/g, '').trim();
        }
      }
      
      return JSON.parse(cleanResponse);
    } catch (error) {
      console.error('Lead qualification error:', error);
      return {
        score: 50,
        reasoning: 'Unable to fully qualify - using default score',
        recommendations: ['Gather more information about company size and needs']
      };
    }
  }

  // Message personalization
  async personalizeMessage(template: string, leadData: any, context?: string): Promise<string> {
    const systemPrompt = `You are an expert at personalizing sales messages. 
    Make messages engaging, relevant, and focused on value proposition.
    Keep the tone professional but conversational.`;

    const prompt = `Personalize this message template for the following lead:
    
    Template: ${template}
    
    Lead Information:
    - Company: ${leadData.companyName}
    - Contact: ${leadData.contactName}
    - Industry: ${leadData.companyData?.industry || 'Unknown'}
    - Company Size: ${leadData.companyData?.size || 'Unknown'}
    ${context ? `Additional Context: ${context}` : ''}
    
    Make it specific to their business and challenges. Keep it concise.`;

    try {
      const response = await this.callGrok(prompt, systemPrompt, 0.7);
      return response;
    } catch (error) {
      console.error('Message personalization error:', error);
      return template; // Return original template if personalization fails
    }
  }

  // Company enrichment
  async enrichCompanyData(companyName: string, website?: string): Promise<any> {
    const systemPrompt = `You are a business intelligence analyst. Research and provide company information.
    Return your response in JSON format with fields: industry, estimatedSize, location, description, keyProducts, targetMarket.`;

    const prompt = `Research and provide information about:
    Company: ${companyName}
    ${website ? `Website: ${website}` : ''}
    
    Provide industry classification, estimated company size, and other relevant business intelligence.`;

    try {
      const response = await this.callGrok(prompt, systemPrompt, 0.3);
      
      // Clean up response if it contains markdown code blocks
      let cleanResponse = response;
      if (typeof response === 'string') {
        if (response.includes('```json')) {
          cleanResponse = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        } else if (response.includes('```')) {
          cleanResponse = response.replace(/```\n?/g, '').trim();
        }
      }
      
      return JSON.parse(cleanResponse);
    } catch (error) {
      console.error('Company enrichment error:', error);
      return null;
    }
  }

  // Analyze scoring effectiveness
  async analyzeScoring(leadHistory: any[], criteria: any): Promise<{
    effectiveness: number;
    insights: string[];
    recommendations: string[];
  }> {
    const systemPrompt = `You are a sales analytics expert. Analyze lead scoring effectiveness and provide improvements.
    Return JSON with: effectiveness (0-100), insights (array), recommendations (array).`;

    const prompt = `Analyze the effectiveness of our lead scoring:
    
    Current Criteria Weights:
    ${JSON.stringify(criteria, null, 2)}
    
    Recent Lead Outcomes:
    ${JSON.stringify(leadHistory.slice(0, 10), null, 2)}
    
    Evaluate if the scoring accurately predicts lead success and suggest improvements.`;

    try {
      const response = await this.callGrok(prompt, systemPrompt, 0.3);
      
      // Clean up response if it contains markdown code blocks
      let cleanResponse = response;
      if (typeof response === 'string') {
        if (response.includes('```json')) {
          cleanResponse = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        } else if (response.includes('```')) {
          cleanResponse = response.replace(/```\n?/g, '').trim();
        }
      }
      
      return JSON.parse(cleanResponse);
    } catch (error) {
      console.error('Scoring analysis error:', error);
      return {
        effectiveness: 70,
        insights: ['Unable to fully analyze - using default assessment'],
        recommendations: ['Review scoring criteria based on closed deals']
      };
    }
  }

  // Conversation summary
  async summarizeConversation(messages: string[]): Promise<string> {
    const systemPrompt = `You are an expert at summarizing sales conversations. 
    Create concise, actionable summaries highlighting key points and next steps.`;

    const prompt = `Summarize this sales conversation:
    
    ${messages.join('\n\n')}
    
    Include: key discussion points, customer needs, objections, and recommended next steps.`;

    try {
      const response = await this.callGrok(prompt, systemPrompt, 0.3);
      return response;
    } catch (error) {
      console.error('Conversation summary error:', error);
      return 'Unable to generate summary';
    }
  }

  // Chat with tools support
  async chatWithTools(messages: any[], tools?: any[]): Promise<any> {
    const systemPrompt = `You are an expert AI Sales Development Representative assistant specializing in lead qualification and scoring.

AVAILABLE TOOLS:
1. score_lead - Score a lead with custom criteria
2. rescore_lead - Re-score an existing lead with new criteria
3. update_lead_stage - Move a lead to different pipeline stage
4. generate_message - Generate personalized outreach messages (introduction, follow_up, demo_request, proposal)
5. evaluate_scoring - Evaluate scoring model accuracy

MESSAGE GENERATION INSTRUCTIONS:
When asked to generate messages, create outreach, or personalize messages:
- Use the generate_message tool with the leadId and messageType
- Pass any additional context in the context parameter
- Message types: introduction, follow_up, demo_request, proposal

LEAD SCORING INSTRUCTIONS:
When asked to "score this lead" or evaluate a lead with custom criteria:
1. Parse the criteria from the user's message
2. Pass the criteria string to the score_lead tool in the 'criteria' field
3. The tool will handle parsing and scoring based on the criteria
4. Use score_lead for both new and existing leads (it uses email to upsert)
5. Use rescore_lead only when explicitly asked to re-score with a lead ID

RESPONSE FORMAT for scoring:
Lead Qualification Score: [X]/100 ([High/Moderate/Low] Potential)

Breakdown:
• Company Size: [score]/[max] - [explanation]
• Industry Fit: [score]/[max] - [explanation]  
• Budget/Intent: [score]/[max] - [explanation]

Recommendation: [Actionable recommendation based on score]
Lead ID: [leadId if created]

Use the appropriate tools based on the user's request. Always use tools when available rather than trying to generate responses without them.`;

    try {
      const requestBody: any = {
        model: 'grok-2-latest',
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages
        ],
        stream: false,
        temperature: 0.7,
        max_tokens: 2000
      };

      // Add tools if provided
      if (tools && tools.length > 0) {
        requestBody.tools = tools;
      }

      const response = await this.client.post('/chat/completions', requestBody);
      return response.data.choices[0].message;
    } catch (error: any) {
      console.error('Chat with tools error:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const grokService = new GrokService();
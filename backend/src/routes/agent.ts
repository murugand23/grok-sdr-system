import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../server';
import { grokService } from '../services/grokService';
import { toolRegistry } from '../services/toolRegistry';
import { conversationService } from '../services/conversationService';

const router = Router();

// Validation schema for chat request
const ChatRequestSchema = z.object({
  message: z.string(),
  conversationId: z.string().nullable().optional(),
  leadId: z.string().nullable().optional()
});

/**
 * POST /api/agent/chat - Main chat endpoint with tool execution
 */
router.post('/chat', async (req: Request, res: Response) => {
  console.log('[AGENT CHAT] Request received:', req.body);
  
  try {
    const { message, conversationId, leadId } = ChatRequestSchema.parse(req.body);
    console.log('[AGENT CHAT] Parsed request - message:', message, 'conversationId:', conversationId, 'leadId:', leadId);
    
    // Get conversation history if continuing
    let messages: any[] = [];
    if (conversationId && conversationId !== null) {
      console.log('[AGENT CHAT] Getting conversation history for:', conversationId);
      messages = await conversationService.getConversationHistory(conversationId);
      console.log('[AGENT CHAT] Retrieved', messages.length, 'historical messages');
    }
    
    // Add new user message
    messages.push({ role: 'user', content: message });
    console.log('[AGENT CHAT] Total messages:', messages.length);
    
    // Get available tools in Grok format
    const tools = toolRegistry.getGrokTools();
    console.log('[AGENT CHAT] Available tools:', tools.length);
    
    // Call Grok with tools
    console.log('[AGENT CHAT] Calling Grok with messages:', JSON.stringify(messages));
    let response = await grokService.chatWithTools(messages, tools);
    console.log('[AGENT CHAT] Grok response:', JSON.stringify(response));
    
    // Check if response contains non-standard function call format
    if (!response.tool_calls && response.content && response.content.includes('<function_call>')) {
      console.log('[AGENT CHAT] Detected non-standard function call format, parsing...');
      try {
        // Extract JSON from function_call tags
        const match = response.content.match(/<function_call>([\s\S]*?)<\/function_call>/);
        if (match) {
          const functionCallJson = JSON.parse(match[1]);
          
          // Convert to standard tool call format
          response.tool_calls = [{
            id: `call_${Date.now()}`,
            function: {
              name: functionCallJson.action === 'generate_message' ? 'generate_message' : functionCallJson.action,
              arguments: JSON.stringify(functionCallJson['action input'] || functionCallJson.action_input || {})
            },
            type: 'function'
          }];
          response.content = 'I\'ll generate that message for you.';
        }
      } catch (e) {
        console.error('[AGENT CHAT] Failed to parse non-standard function call:', e);
      }
    }
    
    // Handle tool calls if present
    while (response.tool_calls && response.tool_calls.length > 0) {
      // Add assistant message with tool calls
      messages.push({
        role: 'assistant',
        content: response.content,
        tool_calls: response.tool_calls
      });
      
      // Execute each tool call
      for (const toolCall of response.tool_calls) {
        const toolName = toolCall.function.name;
        const toolArgs = JSON.parse(toolCall.function.arguments);
        
        // Execute tool
        const toolResult = await toolRegistry.executeTool(toolName, toolArgs);
        
        // Add tool result to conversation
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult)
        });
      }
      
      // Get next response from Grok with tool results
      response = await grokService.chatWithTools(messages, tools);
    }
    
    // Add final assistant response
    messages.push({
      role: 'assistant',
      content: response.content
    });
    
    // Save conversation
    const savedConversation = await conversationService.saveConversation(
      leadId && leadId !== null ? leadId : null,
      messages
    );
    
    // Return response (structured for future streaming support)
    // Only return the last assistant message (the new response)
    const lastAssistantMessage = messages.filter(m => m.role === 'assistant').pop();
    res.json({
      conversationId: savedConversation.id,
      messages: lastAssistantMessage ? [{
        role: lastAssistantMessage.role,
        content: lastAssistantMessage.content,
        tool_calls: lastAssistantMessage.tool_calls
      }] : []
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('[AGENT CHAT] Validation error:', error.errors);
      return res.status(400).json({ error: 'Invalid request', details: error.errors });
    }
    console.error('[AGENT CHAT] Error:', error);
    console.error('[AGENT CHAT] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    console.error('[AGENT CHAT] Error message:', error instanceof Error ? error.message : String(error));
    res.status(500).json({ error: 'Failed to process chat' });
  }
});

/**
 * GET /api/agent/conversations/:id - Get conversation history
 */
router.get('/conversations/:id', async (req: Request, res: Response) => {
  try {
    const messages = await conversationService.getConversationHistory(req.params.id);
    res.json({ messages });
  } catch (error) {
    console.error('Error fetching conversation:', error);
    res.status(500).json({ error: 'Failed to fetch conversation' });
  }
});

/**
 * GET /api/agent/lead/:leadId/conversations - Get conversations for a lead
 */
router.get('/lead/:leadId/conversations', async (req: Request, res: Response) => {
  try {
    const conversations = await conversationService.getLeadConversations(req.params.leadId);
    res.json({ conversations });
  } catch (error) {
    console.error('Error fetching lead conversations:', error);
    res.status(500).json({ error: 'Failed to fetch lead conversations' });
  }
});

/**
 * POST /api/agent/search - Search agent for natural language queries
 */
router.post('/search', async (req: Request, res: Response) => {
  try {
    const { query, conversationId } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }
    
    // Build messages for search context
    const messages = [{
      role: 'user' as const,
      content: query
    }];
    
    // Get search-specific tools
    const searchTools = toolRegistry.getGrokTools().filter(t => 
      ['search_database', 'analyze_pipeline', 'find_similar_leads'].includes(t.function.name)
    );
    
    // Enhanced system prompt for search
    const searchSystemPrompt = `You are an intelligent search assistant for an SDR system.
You can search leads, conversations, and provide pipeline insights using natural language queries.

AVAILABLE TOOLS:
- search_database: Find leads, conversations based on criteria
- analyze_pipeline: Analyze pipeline health and metrics
- find_similar_leads: Find leads similar to successful conversions

When responding to search queries:
1. Use the appropriate tools to gather data
2. Format results clearly and concisely
3. Provide actionable insights when relevant
4. If no results found, suggest alternative queries`;
    
    // Call Grok with search context
    const response = await grokService.chatWithTools(
      [{ role: 'system', content: searchSystemPrompt }, ...messages],
      searchTools
    );
    
    // Handle tool calls
    let results: any = {};
    let message = response.content;
    
    if (response.tool_calls && response.tool_calls.length > 0) {
      for (const toolCall of response.tool_calls) {
        const toolName = toolCall.function.name;
        const toolArgs = JSON.parse(toolCall.function.arguments);
        
        const toolResult = await toolRegistry.executeTool(toolName, toolArgs);
        if (toolResult.success) {
          results = { ...results, ...toolResult.data };
        }
      }
    }
    
    // Save search conversation if needed
    let newConversationId = conversationId;
    if (!conversationId) {
      const savedConv = await conversationService.saveConversation(null, messages);
      newConversationId = savedConv.id;
    }
    
    res.json({
      results,
      message,
      newConversationId
    });
  } catch (error) {
    console.error('[SEARCH AGENT] Error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

/**
 * GET /api/agent/tools - Get available tools
 */
router.get('/tools', async (req: Request, res: Response) => {
  try {
    const tools = toolRegistry.getTools();
    res.json({
      tools: tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }))
    });
  } catch (error) {
    console.error('Error fetching tools:', error);
    res.status(500).json({ error: 'Failed to fetch tools' });
  }
});

export default router;
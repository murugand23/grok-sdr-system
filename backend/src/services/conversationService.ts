import { prisma } from '../server';
import { grokService } from './grokService';

export class ConversationService {
  /**
   * Save a conversation with a lead
   */
  async saveConversation(
    leadId: string | null,
    messages: any[],
    summary?: string
  ): Promise<any> {
    try {
      // Generate summary if not provided
      if (!summary && messages.length > 0) {
        const messageTexts = messages.map(m => 
          `${m.role}: ${m.content || JSON.stringify(m.tool_calls || m)}`
        );
        summary = await grokService.summarizeConversation(messageTexts);
      }

      // Extract metadata for search
      const metadata = {
        timestamp: new Date(),
        messageCount: messages.length,
        hasToolCalls: messages.some(m => m.tool_calls),
        lastUserMessage: messages.filter(m => m.role === 'user').pop()?.content
      };

      // Create conversation record
      const conversation = await prisma.conversation.create({
        data: {
          leadId: leadId || undefined,
          content: JSON.stringify(messages),
          summary,
          metadata
        }
      });

      return conversation;
    } catch (error) {
      console.error('Error saving conversation:', error);
      throw error;
    }
  }

  /**
   * Get conversation history
   */
  async getConversationHistory(conversationId: string): Promise<any[]> {
    try {
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId }
      });

      if (!conversation) {
        return [];
      }

      return JSON.parse(conversation.content);
    } catch (error) {
      console.error('Error getting conversation history:', error);
      return [];
    }
  }

  /**
   * Search conversations by query
   */
  async searchConversations(query: string, limit: number = 10): Promise<any[]> {
    try {
      const conversations = await prisma.conversation.findMany({
        where: {
          OR: [
            { content: { contains: query, mode: 'insensitive' } },
            { summary: { contains: query, mode: 'insensitive' } }
          ]
        },
        include: {
          lead: {
            select: {
              id: true,
              companyName: true,
              contactName: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: limit
      });

      return conversations.map(conv => ({
        id: conv.id,
        leadId: conv.leadId,
        leadName: conv.lead?.companyName,
        summary: conv.summary,
        createdAt: conv.createdAt,
        messageCount: (conv.metadata as any)?.messageCount || 0
      }));
    } catch (error) {
      console.error('Error searching conversations:', error);
      return [];
    }
  }

  /**
   * Get recent conversations for a lead
   */
  async getLeadConversations(leadId: string, limit: number = 5): Promise<any[]> {
    try {
      const conversations = await prisma.conversation.findMany({
        where: { leadId },
        orderBy: { createdAt: 'desc' },
        take: limit
      });

      return conversations.map(conv => ({
        id: conv.id,
        summary: conv.summary,
        createdAt: conv.createdAt,
        messages: JSON.parse(conv.content)
      }));
    } catch (error) {
      console.error('Error getting lead conversations:', error);
      return [];
    }
  }

  /**
   * Search across leads and conversations
   */
  async searchAll(query: string): Promise<any> {
    try {
      // Search leads
      const leads = await prisma.lead.findMany({
        where: {
          OR: [
            { companyName: { contains: query, mode: 'insensitive' } },
            { contactName: { contains: query, mode: 'insensitive' } },
            { email: { contains: query, mode: 'insensitive' } }
          ]
        },
        take: 5
      });

      // Search conversations
      const conversations = await this.searchConversations(query, 5);

      // Search messages
      const messages = await prisma.message.findMany({
        where: {
          OR: [
            { content: { contains: query, mode: 'insensitive' } },
            { personalizedContent: { contains: query, mode: 'insensitive' } }
          ]
        },
        include: {
          lead: {
            select: {
              companyName: true
            }
          }
        },
        take: 5
      });

      return {
        leads: leads.map(l => ({
          id: l.id,
          companyName: l.companyName,
          contactName: l.contactName,
          score: l.score,
          stage: l.stage
        })),
        conversations,
        messages: messages.map(m => ({
          id: m.id,
          leadName: m.lead.companyName,
          content: m.content?.substring(0, 100) + '...',
          createdAt: m.createdAt
        }))
      };
    } catch (error) {
      console.error('Error searching all:', error);
      return { leads: [], conversations: [], messages: [] };
    }
  }
}

// Export singleton instance
export const conversationService = new ConversationService();
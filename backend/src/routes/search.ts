import { Router, Request, Response } from 'express';
import { conversationService } from '../services/conversationService';

const router = Router();

/**
 * GET /api/search - Search across leads, conversations, and messages
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { q, type } = req.query;
    
    if (!q || typeof q !== 'string') {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    // If specific type requested, search only that
    if (type === 'conversations') {
      const conversations = await conversationService.searchConversations(q);
      return res.json({ conversations });
    }

    // Otherwise search everything
    const results = await conversationService.searchAll(q);
    res.json(results);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Failed to perform search' });
  }
});

/**
 * GET /api/search/conversations - Search only conversations
 */
router.get('/conversations', async (req: Request, res: Response) => {
  try {
    const { q, limit = 10 } = req.query;
    
    if (!q || typeof q !== 'string') {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    const conversations = await conversationService.searchConversations(
      q, 
      parseInt(limit as string)
    );
    
    res.json({ conversations });
  } catch (error) {
    console.error('Search conversations error:', error);
    res.status(500).json({ error: 'Failed to search conversations' });
  }
});

export default router;
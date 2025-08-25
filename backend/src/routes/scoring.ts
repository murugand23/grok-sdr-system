import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../server';
import { leadScoringService } from '../services/leadScoringService';

const router = Router();

// Validation schemas
const CreateCriteriaSchema = z.object({
  name: z.string(),
  industryWeight: z.number().min(0).max(100),
  companySizeWeight: z.number().min(0).max(100),
  engagementWeight: z.number().min(0).max(100),
  budgetWeight: z.number().min(0).max(100),
  timingWeight: z.number().min(0).max(100),
  customCriteria: z.object({
    targetIndustries: z.array(z.string()).optional(),
    minBudget: z.number().optional(),
    minCompanySize: z.number().optional(),
    maxDaysSinceContact: z.number().optional()
  }).optional()
});

// GET /api/scoring/criteria - Get all scoring criteria
router.get('/criteria', async (req, res) => {
  try {
    const criteria = await prisma.scoringCriteria.findMany({
      orderBy: { createdAt: 'desc' }
    });
    
    res.json(criteria);
  } catch (error) {
    console.error('Error fetching criteria:', error);
    res.status(500).json({ error: 'Failed to fetch criteria' });
  }
});

// GET /api/scoring/criteria/active - Get active criteria
router.get('/criteria/active', async (req, res) => {
  try {
    const criteria = await prisma.scoringCriteria.findFirst({
      where: { isActive: true }
    });
    
    if (!criteria) {
      // Return default if none exists
      return res.json({
        name: 'Default',
        industryWeight: 20,
        companySizeWeight: 20,
        engagementWeight: 30,
        budgetWeight: 20,
        timingWeight: 10
      });
    }
    
    res.json(criteria);
  } catch (error) {
    console.error('Error fetching active criteria:', error);
    res.status(500).json({ error: 'Failed to fetch active criteria' });
  }
});

// POST /api/scoring/criteria - Create new scoring criteria
router.post('/criteria', async (req, res) => {
  try {
    const validatedData = CreateCriteriaSchema.parse(req.body);
    
    // Validate weights sum to 100
    const totalWeight = 
      validatedData.industryWeight +
      validatedData.companySizeWeight +
      validatedData.engagementWeight +
      validatedData.budgetWeight +
      validatedData.timingWeight;
    
    if (totalWeight !== 100) {
      return res.status(400).json({ 
        error: `Weights must sum to 100 (current sum: ${totalWeight})` 
      });
    }

    // Deactivate other criteria if this should be active
    if (req.body.setActive) {
      await prisma.scoringCriteria.updateMany({
        where: { isActive: true },
        data: { isActive: false }
      });
    }

    const criteria = await prisma.scoringCriteria.create({
      data: {
        ...validatedData,
        isActive: req.body.setActive || false
      }
    });
    
    res.status(201).json(criteria);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid data', details: error.errors });
    }
    console.error('Error creating criteria:', error);
    res.status(500).json({ error: 'Failed to create criteria' });
  }
});

// PUT /api/scoring/criteria/:id/activate - Activate specific criteria
router.put('/criteria/:id/activate', async (req, res) => {
  try {
    // Deactivate all
    await prisma.scoringCriteria.updateMany({
      where: { isActive: true },
      data: { isActive: false }
    });
    
    // Activate specified
    const criteria = await prisma.scoringCriteria.update({
      where: { id: req.params.id },
      data: { isActive: true }
    });
    
    res.json(criteria);
  } catch (error) {
    console.error('Error activating criteria:', error);
    res.status(500).json({ error: 'Failed to activate criteria' });
  }
});

// POST /api/scoring/rescore-all - Re-score all active leads
router.post('/rescore-all', async (req, res) => {
  try {
    const { criteriaId } = req.body;
    
    if (!criteriaId) {
      return res.status(400).json({ error: 'criteriaId is required' });
    }

    // Check criteria exists
    const criteria = await prisma.scoringCriteria.findUnique({
      where: { id: criteriaId }
    });
    
    if (!criteria) {
      return res.status(404).json({ error: 'Criteria not found' });
    }

    // Start rescoring in background
    const count = await leadScoringService.rescoreAllLeads(criteriaId);
    
    res.json({ 
      message: `Rescoring initiated for ${count} leads`,
      criteriaUsed: criteria.name
    });
  } catch (error) {
    console.error('Error rescoring leads:', error);
    res.status(500).json({ error: 'Failed to rescore leads' });
  }
});

// GET /api/scoring/history/:leadId - Get scoring history for a lead
router.get('/history/:leadId', async (req, res) => {
  try {
    const history = await prisma.leadScoring.findMany({
      where: { leadId: req.params.leadId },
      orderBy: { createdAt: 'desc' },
      take: 20
    });
    
    res.json(history);
  } catch (error) {
    console.error('Error fetching scoring history:', error);
    res.status(500).json({ error: 'Failed to fetch scoring history' });
  }
});

// GET /api/scoring/analytics - Get scoring analytics
router.get('/analytics', async (req, res) => {
  try {
    // Get score distribution
    const leads = await prisma.lead.findMany({
      select: { score: true, stage: true }
    });
    
    const distribution = {
      '0-20': 0,
      '21-40': 0,
      '41-60': 0,
      '61-80': 0,
      '81-100': 0
    };
    
    let totalScore = 0;
    for (const lead of leads) {
      totalScore += lead.score;
      if (lead.score <= 20) distribution['0-20']++;
      else if (lead.score <= 40) distribution['21-40']++;
      else if (lead.score <= 60) distribution['41-60']++;
      else if (lead.score <= 80) distribution['61-80']++;
      else distribution['81-100']++;
    }
    
    // Get conversion rates by score range
    const conversions = await prisma.lead.groupBy({
      by: ['stage'],
      _count: true,
      where: {
        stage: {
          in: ['CLOSED_WON', 'CLOSED_LOST']
        }
      }
    });
    
    res.json({
      distribution,
      averageScore: leads.length > 0 ? totalScore / leads.length : 0,
      totalLeads: leads.length,
      conversions
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

export default router;
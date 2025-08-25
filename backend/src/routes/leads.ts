import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../server';
import { grokService } from '../services/grokService';
import { leadScoringService } from '../services/leadScoringService';

const router = Router();

// Validation schemas
const CreateLeadSchema = z.object({
  companyName: z.string(),
  contactName: z.string(),
  email: z.string().email(),
  phone: z.string().optional(),
  website: z.string().url().optional(),
  linkedinUrl: z.string().url().optional(),
  budget: z.string().optional(),
  source: z.string().optional(),
  notes: z.string().optional(),
  qualificationNotes: z.string().optional(),
  companyData: z.object({
    industry: z.string().optional(),
    size: z.union([z.string(), z.number()]).optional(),
    location: z.string().optional()
  }).optional()
});

// GET /api/leads - Get all leads with filtering
router.get('/', async (req, res) => {
  try {
    const { stage, minScore, maxScore, sortBy = 'createdAt', order = 'desc' } = req.query;
    
    const where: any = {};
    if (stage) where.stage = stage;
    if (minScore || maxScore) {
      where.score = {};
      if (minScore) where.score.gte = parseFloat(minScore as string);
      if (maxScore) where.score.lte = parseFloat(maxScore as string);
    }

    const leads = await prisma.lead.findMany({
      where,
      orderBy: { [sortBy as string]: order },
      include: {
        activities: {
          take: 5,
          orderBy: { createdAt: 'desc' }
        },
        _count: {
          select: {
            activities: true,
            messages: true
          }
        }
      }
    });

    res.json(leads);
  } catch (error) {
    console.error('Error fetching leads:', error);
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

// GET /api/leads/:id - Get single lead with full details
router.get('/:id', async (req, res) => {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: req.params.id },
      include: {
        activities: {
          orderBy: { createdAt: 'desc' }
        },
        messages: {
          orderBy: { createdAt: 'desc' }
        },
        scoringHistory: {
          orderBy: { createdAt: 'desc' },
          take: 10
        },
        conversations: {
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    res.json(lead);
  } catch (error) {
    console.error('Error fetching lead:', error);
    res.status(500).json({ error: 'Failed to fetch lead' });
  }
});

// POST /api/leads - Create new lead
router.post('/', async (req, res) => {
  try {
    const validatedData = CreateLeadSchema.parse(req.body);
    
    // Check if lead already exists
    const existing = await prisma.lead.findUnique({
      where: { email: validatedData.email }
    });
    
    if (existing) {
      return res.status(400).json({ error: 'Lead with this email already exists' });
    }

    // Create lead
    const lead = await prisma.lead.create({
      data: validatedData
    });

    // Log activity
    await prisma.activity.create({
      data: {
        leadId: lead.id,
        type: 'NOTE_ADDED',
        description: 'Lead created'
      }
    });

    // Enrich company data with Grok if website provided
    if (validatedData.website) {
      try {
        const enrichedData = await grokService.enrichCompanyData(
          validatedData.companyName,
          validatedData.website
        );
        
        if (enrichedData) {
          await prisma.lead.update({
            where: { id: lead.id },
            data: { 
              enrichedData,
              companyData: {
                ...validatedData.companyData,
                ...enrichedData
              }
            }
          });
        }
      } catch (error) {
        console.error('Enrichment failed:', error);
      }
    }

    // Calculate initial score
    await leadScoringService.calculateScore(lead);

    // Fetch updated lead
    const updatedLead = await prisma.lead.findUnique({
      where: { id: lead.id },
      include: {
        scoringHistory: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    });

    res.status(201).json(updatedLead);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid data', details: error.errors });
    }
    console.error('Error creating lead:', error);
    res.status(500).json({ error: 'Failed to create lead' });
  }
});

// PUT /api/leads/:id - Update lead
router.put('/:id', async (req, res) => {
  try {
    const { stage, ...data } = req.body;
    
    const lead = await prisma.lead.findUnique({
      where: { id: req.params.id }
    });
    
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    // Update lead
    const updatedLead = await prisma.lead.update({
      where: { id: req.params.id },
      data: {
        ...data,
        stage
      }
    });

    // Log stage change
    if (stage && stage !== lead.stage) {
      await prisma.activity.create({
        data: {
          leadId: lead.id,
          type: 'STAGE_CHANGED',
          description: `Stage changed from ${lead.stage} to ${stage}`
        }
      });
    }

    res.json(updatedLead);
  } catch (error) {
    console.error('Error updating lead:', error);
    res.status(500).json({ error: 'Failed to update lead' });
  }
});

// POST /api/leads/recalculate-all - Recalculate all lead scores
router.post('/recalculate-all', async (req, res) => {
  try {
    const leads = await prisma.lead.findMany({
      where: {
        stage: {
          notIn: ['CLOSED_WON', 'CLOSED_LOST']
        }
      }
    });

    let updated = 0;
    const errors: any[] = [];

    for (const lead of leads) {
      try {
        await leadScoringService.calculateScore(lead);
        updated++;
      } catch (error) {
        errors.push({
          leadId: lead.id,
          email: lead.email,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    res.json({
      success: true,
      updated,
      total: leads.length,
      errors
    });
  } catch (error) {
    console.error('Error recalculating scores:', error);
    res.status(500).json({ error: 'Failed to recalculate scores' });
  }
});

// POST /api/leads/:id/score - Recalculate lead score
router.post('/:id/score', async (req, res) => {
  try {
    const { criteriaId } = req.body;
    
    const lead = await prisma.lead.findUnique({
      where: { id: req.params.id }
    });
    
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const result = await leadScoringService.calculateScore(lead, criteriaId);
    
    await prisma.activity.create({
      data: {
        leadId: lead.id,
        type: 'SCORE_UPDATED',
        description: `Score updated to ${result.score}`,
        metadata: result.breakdown
      }
    });

    res.json(result);
  } catch (error) {
    console.error('Error scoring lead:', error);
    res.status(500).json({ error: 'Failed to score lead' });
  }
});

// POST /api/leads/:id/enrich - Enrich lead data with Grok
router.post('/:id/enrich', async (req, res) => {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: req.params.id }
    });
    
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const enrichedData = await grokService.enrichCompanyData(
      lead.companyName,
      lead.website || undefined
    );
    
    if (enrichedData) {
      const updatedLead = await prisma.lead.update({
        where: { id: req.params.id },
        data: { 
          enrichedData,
          companyData: {
            ...(lead.companyData as any || {}),
            ...enrichedData
          }
        }
      });
      
      res.json(updatedLead);
    } else {
      res.status(500).json({ error: 'Failed to enrich data' });
    }
  } catch (error) {
    console.error('Error enriching lead:', error);
    res.status(500).json({ error: 'Failed to enrich lead' });
  }
});

// DELETE /api/leads/:id - Delete lead
router.delete('/:id', async (req, res) => {
  try {
    await prisma.lead.delete({
      where: { id: req.params.id }
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting lead:', error);
    res.status(500).json({ error: 'Failed to delete lead' });
  }
});

// POST /api/leads/bulk - Bulk import leads
router.post('/bulk', async (req, res) => {
  try {
    const { leads } = req.body;
    
    if (!Array.isArray(leads)) {
      return res.status(400).json({ error: 'Leads must be an array' });
    }

    const results = {
      created: 0,
      skipped: 0,
      errors: [] as any[]
    };

    for (const leadData of leads) {
      try {
        const validated = CreateLeadSchema.parse(leadData);
        
        // Check if exists
        const existing = await prisma.lead.findUnique({
          where: { email: validated.email }
        });
        
        if (existing) {
          results.skipped++;
          continue;
        }

        // Create lead
        const lead = await prisma.lead.create({
          data: validated
        });
        
        // Score in background
        leadScoringService.calculateScore(lead).catch(console.error);
        
        results.created++;
      } catch (error) {
        results.errors.push({
          data: leadData,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    res.json(results);
  } catch (error) {
    console.error('Error bulk importing leads:', error);
    res.status(500).json({ error: 'Failed to import leads' });
  }
});

// GET /api/leads/:id - Get a single lead by ID
router.get('/:id', async (req, res) => {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: req.params.id },
      include: {
        activities: {
          orderBy: { createdAt: 'desc' },
          take: 20
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 20
        }
      }
    });

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    res.json(lead);
  } catch (error) {
    console.error('Error fetching lead:', error);
    res.status(500).json({ error: 'Failed to fetch lead' });
  }
});

// PATCH /api/leads/:id - Update a lead
router.patch('/:id', async (req, res) => {
  try {
    // Remove fields that shouldn't be updated directly
    const { id, createdAt, updatedAt, ...updateData } = req.body;

    const lead = await prisma.lead.update({
      where: { id: req.params.id },
      data: updateData,
      include: {
        activities: {
          orderBy: { createdAt: 'desc' },
          take: 20
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 20
        }
      }
    });

    // Log significant changes as activities
    if (updateData.stage) {
      await prisma.activity.create({
        data: {
          leadId: lead.id,
          type: 'STAGE_CHANGED',
          description: `Stage changed to ${updateData.stage}`
        }
      });
    }

    res.json(lead);
  } catch (error) {
    console.error('Error updating lead:', error);
    res.status(500).json({ error: 'Failed to update lead' });
  }
});

export default router;
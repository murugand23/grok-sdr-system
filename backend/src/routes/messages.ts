import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../server';
import { grokService } from '../services/grokService';

const router = Router();

// Validation schemas
const CreateMessageSchema = z.object({
  leadId: z.string(),
  templateId: z.string().optional(),
  subject: z.string().optional(),
  content: z.string(),
  personalize: z.boolean().default(true)
});

// GET /api/messages/templates - Get all message templates
router.get('/templates', async (req, res) => {
  try {
    const templates = await prisma.messageTemplate.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' }
    });
    
    res.json(templates);
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

// POST /api/messages/templates - Create message template
router.post('/templates', async (req, res) => {
  try {
    const { name, subject, content, variables = [] } = req.body;
    
    const template = await prisma.messageTemplate.create({
      data: {
        name,
        subject,
        content,
        variables
      }
    });
    
    res.status(201).json(template);
  } catch (error) {
    console.error('Error creating template:', error);
    res.status(500).json({ error: 'Failed to create template' });
  }
});

// POST /api/messages/generate - Generate personalized message
router.post('/generate', async (req, res) => {
  try {
    const validatedData = CreateMessageSchema.parse(req.body);
    
    // Get lead data
    const lead = await prisma.lead.findUnique({
      where: { id: validatedData.leadId },
      include: {
        activities: {
          orderBy: { createdAt: 'desc' },
          take: 5
        }
      }
    });
    
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    let messageContent = validatedData.content;
    let personalizedContent = messageContent;

    // If using template, fetch it
    if (validatedData.templateId) {
      const template = await prisma.messageTemplate.findUnique({
        where: { id: validatedData.templateId }
      });
      
      if (template) {
        messageContent = template.content;
        validatedData.subject = validatedData.subject || template.subject || undefined;
      }
    }

    // Personalize with Grok if requested
    if (validatedData.personalize) {
      const context = lead.activities.length > 0 
        ? `Recent activities: ${lead.activities.map(a => a.description).join(', ')}`
        : undefined;
      
      personalizedContent = await grokService.personalizeMessage(
        messageContent,
        lead,
        context
      );
    }

    // Create message record
    const message = await prisma.message.create({
      data: {
        leadId: validatedData.leadId,
        templateId: validatedData.templateId,
        subject: validatedData.subject,
        content: messageContent,
        personalizedContent,
        status: 'DRAFT'
      }
    });

    res.json(message);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid data', details: error.errors });
    }
    console.error('Error generating message:', error);
    res.status(500).json({ error: 'Failed to generate message' });
  }
});

// GET /api/messages/:leadId - Get messages for a lead
router.get('/:leadId', async (req, res) => {
  try {
    const messages = await prisma.message.findMany({
      where: { leadId: req.params.leadId },
      orderBy: { createdAt: 'desc' },
      include: {
        template: true
      }
    });
    
    res.json(messages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// PUT /api/messages/:id/send - Mark message as sent
router.put('/:id/send', async (req, res) => {
  try {
    const message = await prisma.message.update({
      where: { id: req.params.id },
      data: {
        status: 'SENT',
        sentAt: new Date()
      },
      include: {
        lead: true
      }
    });

    // Log activity
    await prisma.activity.create({
      data: {
        leadId: message.leadId,
        type: 'EMAIL_SENT',
        description: `Email sent: ${message.subject || 'No subject'}`,
        metadata: { messageId: message.id }
      }
    });

    // Update lead last contacted
    await prisma.lead.update({
      where: { id: message.leadId },
      data: { lastContactedAt: new Date() }
    });

    res.json(message);
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

export default router;
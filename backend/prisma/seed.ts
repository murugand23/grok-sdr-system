import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Create default scoring criteria
  await prisma.scoringCriteria.create({
    data: {
      name: 'Default Criteria',
      industryWeight: 20,
      companySizeWeight: 20,
      engagementWeight: 30,
      budgetWeight: 20,
      timingWeight: 10,
      isActive: true
    }
  });

  // Create sample leads
  const sampleLeads = [
    {
      companyName: 'TechCorp Solutions',
      contactName: 'John Smith',
      email: 'john@techcorp.example.com',
      phone: '+1-555-0100',
      website: 'https://techcorp.example.com',
      score: 75,
      stage: 'QUALIFIED' as const,
      companyData: {
        industry: 'Technology',
        size: '100-500',
        location: 'San Francisco, CA'
      }
    },
    {
      companyName: 'Global Retail Inc',
      contactName: 'Sarah Johnson',
      email: 'sarah@globalretail.example.com',
      phone: '+1-555-0101',
      website: 'https://globalretail.example.com',
      score: 60,
      stage: 'NEW' as const,
      companyData: {
        industry: 'Retail',
        size: '1000+',
        location: 'New York, NY'
      }
    },
    {
      companyName: 'StartupAI',
      contactName: 'Mike Chen',
      email: 'mike@startupai.example.com',
      website: 'https://startupai.example.com',
      score: 85,
      stage: 'CONTACTED' as const,
      companyData: {
        industry: 'Artificial Intelligence',
        size: '10-50',
        location: 'Austin, TX'
      }
    }
  ];

  for (const lead of sampleLeads) {
    await prisma.lead.create({ data: lead });
  }

  // Create sample message templates
  await prisma.messageTemplate.create({
    data: {
      name: 'Initial Outreach',
      subject: 'Quick question about {{company_name}}',
      content: `Hi {{contact_name}},

I noticed that {{company_name}} is in the {{industry}} space. We've helped similar companies improve their sales efficiency by 40%.

Would you be open to a brief 15-minute call next week to discuss how we might help {{company_name}} achieve similar results?

Best regards,
Your SDR Team`,
      variables: ['company_name', 'contact_name', 'industry'],
      isActive: true
    }
  });

  console.log('✅ Database seeded successfully');
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
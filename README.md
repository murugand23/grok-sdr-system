# Grok-Powered SDR (Sales Development Representative) System

An intelligent Sales Development Representative system leveraging Grok's API to enhance and automate the sales prospecting process.

## Working Features ✅

- **Lead Qualification & Scoring**: Automated lead scoring with customizable criteria and re-scoring capabilities
- **Personalized Messaging**: AI-powered message personalization using Grok API for tailored outreach
- **Evaluation Framework**: Systematic prompt engineering and performance testing with qualitative analysis

## Features In Development 🚧

- **Search Functionality**: Search through conversations and company metadata (has known bugs)
- **Pipeline Progress Monitoring**: Lead tracking through sales stages (not fully implemented)
- **Automated Stage Progression**: Pipeline automation features (not implemented)
- **Activity History & Logging**: Detailed interaction tracking (partial implementation)
- **Conversation Search System**: Search previous conversations or company metadata (not fully functional)

## Tech Stack

- **Frontend**: Next.js, React, TypeScript, Tailwind CSS
- **Backend**: Node.js, Express, TypeScript, Prisma ORM
- **Database**: PostgreSQL
- **AI**: Grok API
- **Containerization**: Docker & Docker Compose

## Prerequisites

- Docker and Docker Compose installed
- Grok API key (get $20 free credits with promo code "grokeng" at console.x.ai)
- Git

## Quick Start

### 1. Clone the Repository

```bash
git clone [repository-url]
cd grok
```

### 2. Set Up Environment Variables

Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

Edit the `.env` file and add your Grok API key:

```env
GROK_API_KEY=your_actual_grok_api_key_here
```

For the frontend (optional):

```bash
cp frontend/.env.local.example frontend/.env.local
```

### 3. Run with Docker Compose

Start all services (database, backend, and frontend):

```bash
docker-compose up --build
```

This will:
- Start PostgreSQL database on port 5432
- Run database migrations automatically
- Start the backend API on http://localhost:3001
- Start the frontend on http://localhost:3000

### 4. (Optional) Seed Sample Data

The database starts empty. To add sample data for testing:

```bash
# Run this after the containers are up
docker-compose exec backend npm run seed
```

This will add:
- Sample leads with different scores and stages
- Default scoring criteria
- Sample message template

### 5. Access the Application

Open your browser and navigate to:
- Frontend: http://localhost:3000
- Backend API: http://localhost:3001

## Development Setup (Without Docker)

If you prefer to run the services locally without Docker:

### Backend Setup

```bash
cd backend
npm install

# Set up environment variables
cp ../.env.example .env

# Run database migrations
npx prisma migrate deploy

# Generate Prisma client
npx prisma generate

# Start development server
npm run dev
```

### Frontend Setup

```bash
cd frontend
npm install

# Set up environment variables
cp .env.local.example .env.local

# Start development server
npm run dev
```

### Database Setup

Ensure PostgreSQL is running locally and update the `DATABASE_URL` in your `.env` file:

```env
DATABASE_URL=postgresql://username:password@localhost:5432/grok_sdr
```

## API Documentation

### Key Endpoints

- `GET /api/leads` - List all leads
- `POST /api/leads` - Create a new lead
- `GET /api/leads/:id` - Get lead details
- `PUT /api/leads/:id` - Update lead information
- `POST /api/leads/:id/score` - Recalculate lead score
- `POST /api/messages/personalize` - Generate personalized message
- `POST /api/evaluation/run` - Run evaluation tests
- `GET /api/search` - Search conversations and metadata

## Database Schema

The system uses Prisma ORM with PostgreSQL. Key models include:
- `Lead` - Core lead information and scoring
- `ScoringCriteria` - User-defined scoring parameters
- `Message` - Email templates and sent messages
- `Conversation` - Searchable conversation history
- `EvaluationTest` & `EvaluationResult` - Testing framework

## Troubleshooting

### Common Issues

1. **Port conflicts**: If ports 3000, 3001, or 5432 are in use, update the port mappings in `docker-compose.yml`

2. **Database connection issues**: Ensure the database container is fully started before the backend:
   ```bash
   docker-compose up postgres
   # Wait for "database system is ready to accept connections"
   docker-compose up backend frontend
   ```

3. **Prisma migration errors**: Reset the database and rerun migrations:
   ```bash
   docker-compose down -v
   docker-compose up --build
   ```

4. **Environment variable issues**: Ensure `.env` file is in the root directory and contains all required variables

### Logs

View logs for debugging:

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f backend
docker-compose logs -f frontend
docker-compose logs -f postgres
```

## Clean Up

To stop all services and remove containers:

```bash
docker-compose down
```

To also remove the database volume (will delete all data):

```bash
docker-compose down -v
```

## Contributing

1. Create a feature branch
2. Make your changes
3. Run tests and ensure everything works
4. Submit a pull request

## License

[Your License Here]

## Support

For issues or questions, please contact the development team or create an issue in the repository.
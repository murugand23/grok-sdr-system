# Docker Compose Fix - Container Conflict & Prisma OpenSSL Error

## Problem
`docker-compose up --build` failed with:
1. Container name conflict: `/grok-sdr-db` already exists
2. Prisma crash: Missing OpenSSL in Alpine Linux

## Fix

### Step 1: Remove existing container
```bash
docker stop grok-sdr-db && docker rm grok-sdr-db
```

### Step 2: Update `backend/Dockerfile`
Add this line after `FROM node:18-alpine`:
```dockerfile
RUN apk add --no-cache openssl libc6-compat
```

### Step 3: Rebuild
```bash
docker-compose up --build
```

## Explanation
Alpine Linux is minimal and doesn't include OpenSSL. Prisma needs OpenSSL to connect to PostgreSQL. The packages:
- `openssl`: SSL/TLS libraries for database connections
- `libc6-compat`: Compatibility layer for Node.js native modules on Alpine

This fixes the `Prisma failed to detect the libssl/openssl version` error.
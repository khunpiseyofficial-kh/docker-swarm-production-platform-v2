# syntax=docker/dockerfile:1
# ==============================================================================
# Multi-stage Dockerfile for Swarm E-Commerce Backend (Node.js)
# ==============================================================================

# --- Stage 1: Dependencies ---
FROM node:20-alpine AS deps
WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# --- Stage 2: Production Runtime ---
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Install curl for manual troubleshooting if needed
RUN apk add --no-cache curl

# Copy dependencies and application code
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY src/ ./src/
COPY schema.sql ./

# Run strictly as non-root user 'node'
USER node

EXPOSE 3000

# Container Healthcheck using native Node.js HTTP call to 127.0.0.1
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "const http = require('http'); \
    const req = http.get('http://127.0.0.1:3000/health', (res) => { \
      process.exit(res.statusCode === 200 ? 0 : 1); \
    }); \
    req.on('error', () => process.exit(1));"

CMD ["node", "src/index.js"]

# Phase 20: Docker configuration
FROM node:18-alpine

WORKDIR /app

# Install build dependencies for native modules (bcrypt, sqlite3)
RUN apk add --no-cache python3 make g++ sqlite

# Copy package files first for layer caching
COPY package*.json ./
RUN npm ci --only=production

# Copy application code
COPY . .

# Create necessary directories
RUN mkdir -p logs screenshots uploads

# Set environment
ENV NODE_ENV=production
ENV PORT=3001

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3001/api/health || exit 1

EXPOSE 3001

# Run with cluster mode for production
CMD ["node", "cluster.js"]

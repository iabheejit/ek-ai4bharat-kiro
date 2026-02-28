FROM node:18-alpine

# Create app directory
WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs

# Copy package files
COPY package.json package-lock.json* ./

# Install production dependencies
RUN npm ci --only=production && \
    npm cache clean --force

# Copy source files
COPY server.js db.js db_methods.js twilio_whatsapp.js llama.js course_status.js image.js certificate.js ./
COPY models/ ./models/
COPY middleware/ ./middleware/
COPY utils/ ./utils/
COPY flows/ ./flows/
COPY public/ ./public/
COPY scripts/ ./scripts/
COPY assets/ ./assets/ 2>/dev/null || true
COPY fonts/ ./fonts/ 2>/dev/null || true

# Create logs directory
RUN mkdir -p logs && chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

EXPOSE 3000

CMD ["node", "server.js"]

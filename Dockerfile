# Dockerfile for Hugging Face Spaces (Docker SDK)
FROM node:20-slim

# Install Chromium & fonts for full Puppeteer screenshot support
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 \
    --no-install-recommends \
    && rm -rf /var/lib/apt-get/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PORT=7860
ENV NODE_ENV=production

WORKDIR /app

# Copy root and frontend package manifests
COPY package*.json ./
COPY frontend/package*.json ./frontend/

# Install root dependencies and build frontend dist bundle
RUN npm install
RUN cd frontend && npm install --include=dev && npm run build

# Copy application source code
COPY . .

EXPOSE 7860

# Launch server with 4GB V8 memory limit (Hugging Face Free Tier has 16GB RAM)
CMD ["node", "--max-old-space-size=4096", "backend/index.js"]

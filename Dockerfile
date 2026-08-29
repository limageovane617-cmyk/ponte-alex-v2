FROM node:20-bookworm-slim

# Install Python 3 for Ponte Alex runtime syntax validation and execution
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-minimal \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install dependencies (including devDependencies required for build step)
RUN npm install

# Copy application source code
COPY . .

# Build Vite frontend and esbuild Node server
RUN npm run build

# Default environment settings
ENV NODE_ENV=production
ENV PORT=3000

# Expose port (Render dynamically assigns PORT at runtime)
EXPOSE 3000

# Start production server
CMD ["npm", "start"]

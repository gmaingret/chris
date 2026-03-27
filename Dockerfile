# ── Stage 1: Build TypeScript and pre-download embedding model ──────────────
FROM node:22-slim AS builder

WORKDIR /app

# Install deps first for layer caching
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build
COPY src/ src/
COPY tsconfig.json drizzle.config.ts ./
RUN npm run build

# Pre-download bge-m3 ONNX model (~2GB) so it's cached in the image
# Uses the same pipeline call the app uses at runtime
RUN node --input-type=module -e " \
  import { pipeline } from '@huggingface/transformers'; \
  console.log('Downloading bge-m3 model...'); \
  const p = await pipeline('feature-extraction', 'Xenova/bge-m3'); \
  console.log('Model downloaded and cached.'); \
  process.exit(0); \
"

# ── Stage 2: Production image ──────────────────────────────────────────────
FROM node:22-slim AS production

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built artifacts
COPY --from=builder /app/dist/ dist/
COPY --from=builder /app/node_modules/ node_modules/
COPY --from=builder /app/package.json package.json

# Copy migration SQL files (not compiled by tsc, needed at runtime)
COPY --from=builder /app/src/db/migrations/ src/db/migrations/

# Copy drizzle config (migrator reads migrationsFolder path from it)
COPY --from=builder /app/drizzle.config.ts drizzle.config.ts

# bge-m3 model cache lives inside node_modules/@huggingface/transformers/.cache/
# and is already included via the node_modules copy above

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/index.js"]

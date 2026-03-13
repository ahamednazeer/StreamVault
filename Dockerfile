# syntax=docker/dockerfile:1.6

FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV UPLOAD_DIR=/app/tmp/uploads
ENV STREAM_CACHE_DIR=/app/tmp/cache
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force

COPY --from=build /app/.next ./.next
COPY --from=build /app/next.config.js ./next.config.js

RUN mkdir -p /app/tmp/uploads /app/tmp/cache

EXPOSE 3000
CMD ["npm", "run", "start"]

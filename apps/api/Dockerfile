FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --workspace @pairboard/api --include-workspace-root=false

COPY apps/api ./apps/api
RUN npx prisma generate --schema apps/api/prisma/schema.prisma \
  && npm run build -w @pairboard/api

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    API_PORT=4000 \
    NODE_OPTIONS=--max-old-space-size=192
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev --workspace @pairboard/api --include-workspace-root=false \
  && npm cache clean --force

COPY --from=build /app/node_modules/.prisma /app/node_modules/.prisma
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY apps/api/prisma ./apps/api/prisma

USER node
EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy --schema apps/api/prisma/schema.prisma && node apps/api/dist/index.js"]

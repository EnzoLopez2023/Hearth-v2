FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts/setup-hooks.mjs ./scripts/setup-hooks.mjs
RUN npm ci
COPY tsconfig*.json vite.config.ts ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ARG BUILD_VERSION=dev
ARG SOURCE_SHA=unknown
ARG BUILD_TIME=unknown
ARG BUILD_ID=local
LABEL org.opencontainers.image.title="Hearth v2" \
      org.opencontainers.image.version="${BUILD_VERSION}" \
      org.opencontainers.image.revision="${SOURCE_SHA}" \
      org.opencontainers.image.created="${BUILD_TIME}"
ENV NODE_ENV=production \
    PORT=3000 \
    BUILD_VERSION="${BUILD_VERSION}" \
    SOURCE_SHA="${SOURCE_SHA}" \
    BUILD_TIME="${BUILD_TIME}" \
    BUILD_ID="${BUILD_ID}"
WORKDIR /app
RUN mkdir -p /home/data && chown node:node /home/data
COPY package.json package-lock.json ./
COPY scripts/setup-hooks.mjs ./scripts/setup-hooks.mjs
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
CMD ["npm", "start"]

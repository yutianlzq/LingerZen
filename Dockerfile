# syntax=docker/dockerfile:1

FROM node:22-alpine AS build

WORKDIR /app

ARG NPM_REGISTRY=https://registry.npmjs.org
ENV npm_config_registry=$NPM_REGISTRY

RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=lingerzen-pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .
ARG PUBLIC_SITE_URL=https://lingerzen.yu-tian.net
ARG DISABLE_FONT_API=false
ENV NODE_ENV=production
ENV PUBLIC_SITE_URL=$PUBLIC_SITE_URL
ENV DISABLE_FONT_API=$DISABLE_FONT_API
RUN node scripts/generate-local-cms-config.mjs
RUN pnpm build
RUN pnpm prune --prod

FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4321

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules

EXPOSE 4321
CMD ["node", "./dist/server/entry.mjs"]

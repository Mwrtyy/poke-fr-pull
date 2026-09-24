FROM node:24-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY services/backend/package.json services/backend/package.json
COPY scripts scripts
COPY services/backend services/backend
COPY db db
RUN pnpm install --filter @poke-fr/backend... --no-frozen-lockfile
ENV NODE_ENV=production
EXPOSE 8787
CMD ["pnpm", "--filter", "@poke-fr/backend", "api"]

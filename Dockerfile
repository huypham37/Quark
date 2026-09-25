# Build stage
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/runner/package.json packages/runner/
COPY packages/quark/package.json packages/quark/
RUN bun install
COPY . .

RUN bun run web:build

# Runtime stage
FROM oven/bun:1 AS runtime
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/runner/package.json packages/runner/
COPY packages/quark/package.json packages/quark/

RUN bun install --production --frozen-lockfile

COPY --from=build /app/web/dist ./web/dist

COPY ./web/backend.ts ./web/server.ts ./web/

COPY ./packages ./packages

CMD ["bun", "run", "web:serve"]

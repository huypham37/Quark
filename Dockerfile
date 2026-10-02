# Build the runner and Quark CLI/TUI. No web assets or web server are included.
FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/runner/package.json packages/runner/
COPY packages/quark/package.json packages/quark/
COPY packages/acp/package.json packages/acp/
RUN bun install --frozen-lockfile

COPY packages/runner ./packages/runner
COPY packages/quark ./packages/quark
COPY packages/acp ./packages/acp

RUN bun run --cwd packages/runner build \
    && bun run --cwd packages/quark build-tui.ts

# Runtime includes only built runner and CLI/TUI packages.
FROM oven/bun:1 AS runtime
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/runner/package.json packages/runner/
COPY packages/quark/package.json packages/quark/
COPY packages/acp/package.json packages/acp/
RUN bun install --production --frozen-lockfile

COPY --from=build /app/packages/runner/dist ./packages/runner/dist
COPY --from=build /app/packages/quark/dist ./packages/quark/dist
COPY packages/runner/package.json ./packages/runner/
COPY packages/quark/package.json ./packages/quark/
COPY packages/acp/package.json ./packages/acp/
COPY packages/quark/preload.ts ./packages/quark/preload.ts

CMD ["bun", "--preload", "./packages/quark/preload.ts", "./packages/quark/dist/tui.js"]

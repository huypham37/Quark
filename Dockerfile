# Build the runner, the ACP server and the Quark CLI/TUI. No web assets or
# web server are included.
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
# Every package build script imports scripts/build-package, and every package
# tsconfig extends the shared base.
COPY scripts ./scripts
COPY tsconfig.base.json ./

RUN bun run --cwd packages/runner build \
    && bun run --cwd packages/acp build \
    && bun run --cwd packages/quark build

# Runtime ships the built packages. Their `src` travels too: Bun resolves
# @quark/runner and @quark/acp through the packages' `bun` export condition.
FROM oven/bun:1 AS runtime
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/runner/package.json packages/runner/
COPY packages/quark/package.json packages/quark/
COPY packages/acp/package.json packages/acp/
RUN bun install --production --frozen-lockfile

COPY --from=build /app/packages/runner/dist ./packages/runner/dist
COPY --from=build /app/packages/runner/src ./packages/runner/src
COPY --from=build /app/packages/acp/dist ./packages/acp/dist
COPY --from=build /app/packages/acp/src ./packages/acp/src
COPY --from=build /app/packages/quark/dist ./packages/quark/dist
COPY packages/quark/preload.ts ./packages/quark/preload.ts

CMD ["bun", "--preload", "./packages/quark/preload.ts", "./packages/quark/dist/tui.js"]

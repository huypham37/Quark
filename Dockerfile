FROM oven/bun:1.3.10

ENV QUARK_DIR=/quark

WORKDIR /quark

COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile

ENTRYPOINT ["bun", "--preload", "/quark/preload.ts", "/quark/src/cli.ts"]

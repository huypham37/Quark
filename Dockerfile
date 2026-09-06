FROM oven/bun:1
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates curl git openssh-client ripgrep \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/quark
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
ENV QUARK_DIR=/opt/quark
ENTRYPOINT ["bun", "--preload", "/opt/quark/preload.ts", "/opt/quark/src/cli.ts"]

# Latest upstream default-branch commits checked on 2026-10-27.
# Override individual commits with --build-arg when refreshing the source snapshot.
ARG FFSUBSYNC_COMMIT=de310ac6944b8260431a48ee741e7063cec49b0f
ARG AUTOSUBSYNC_COMMIT=b392da2713aafe6de83e08e2571198988612febc
ARG ALASS_COMMIT=874f02d9577182752a0f969b6d6b98fd65bdf1fc
ARG SUBSYNC_COMMIT=1ff7bc91b87fe6644250323b8add790f8a9df2f2

# === Python engine source builds ===
FROM node:22-bookworm AS python-engine-builder
ARG FFSUBSYNC_COMMIT
ARG AUTOSUBSYNC_COMMIT
ARG SUBSYNC_COMMIT

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv python3-dev build-essential git pkg-config \
    libavdevice-dev libavformat-dev libavfilter-dev libavcodec-dev \
    libswresample-dev libswscale-dev libavutil-dev \
    libpocketsphinx-dev libsphinxbase-dev \
    && rm -rf /var/lib/apt/lists/*

FROM python-engine-builder AS subsync-builder
# The fork has no assets release; use its working upstream fallback directly.
COPY assets/subsync/config.py.template /tmp/subsync-config.py.template
RUN git init /tmp/subsync \
    && git -C /tmp/subsync remote add origin https://github.com/neck0l/subsync.git \
    && git -C /tmp/subsync fetch --depth 1 origin "$SUBSYNC_COMMIT" \
    && git -C /tmp/subsync checkout --detach FETCH_HEAD \
    && test "$(git -C /tmp/subsync rev-parse HEAD)" = "$SUBSYNC_COMMIT" \
    && cp /tmp/subsync-config.py.template /tmp/subsync/subsync/config.py.template \
    && python3 -m venv /opt/subsync \
    && /opt/subsync/bin/pip install --no-cache-dir /tmp/subsync \
    && /opt/subsync/bin/python -c 'from subsync import config; assert config.assetsurl == "https://github.com/sc0ty/subsync/releases/download/assets/assets.json"' \
    && /opt/subsync/bin/python -c 'import gizmo; assert hasattr(gizmo, "Demux")' \
    && /opt/subsync/bin/subsync --cli --help \
    && mkdir -p /opt/engine-licenses \
    && cp /tmp/subsync/LICENSE /opt/engine-licenses/subsync.txt \
    && rm -rf /tmp/subsync /tmp/subsync-config.py.template

FROM python-engine-builder AS ffsubsync-builder
RUN git init /tmp/ffsubsync \
    && git -C /tmp/ffsubsync remote add origin https://github.com/smacke/ffsubsync.git \
    && git -C /tmp/ffsubsync fetch --depth 1 origin "$FFSUBSYNC_COMMIT" \
    && git -C /tmp/ffsubsync checkout --detach FETCH_HEAD \
    && test "$(git -C /tmp/ffsubsync rev-parse HEAD)" = "$FFSUBSYNC_COMMIT" \
    && python3 -m venv /opt/ffsubsync \
    && /opt/ffsubsync/bin/pip install --no-cache-dir 'setuptools<81' wheel \
    && /opt/ffsubsync/bin/pip install --no-cache-dir --no-build-isolation /tmp/ffsubsync \
    && /opt/ffsubsync/bin/ffsubsync --help \
    && mkdir -p /opt/engine-licenses \
    && cp /tmp/ffsubsync/LICENSE /opt/engine-licenses/ffsubsync.txt \
    && rm -rf /tmp/ffsubsync

# Upstream Git omits its pretrained weights. Bundle the upstream release's JSON
# model as data; all executable autosubsync code is built from the Git checkout.
FROM python-engine-builder AS autosubsync-builder
COPY assets/autosubsync /tmp/autosubsync-model
RUN echo '783f1c9c6a53cb48585974691c992ad762fdbd58caf468716d20bc5915e44063  /tmp/autosubsync-model/trained-model.json' | sha256sum -c - \
    && git init /tmp/autosubsync \
    && git -C /tmp/autosubsync remote add origin https://github.com/oseiskar/autosubsync.git \
    && git -C /tmp/autosubsync fetch --depth 1 origin "$AUTOSUBSYNC_COMMIT" \
    && git -C /tmp/autosubsync checkout --detach FETCH_HEAD \
    && test "$(git -C /tmp/autosubsync rev-parse HEAD)" = "$AUTOSUBSYNC_COMMIT" \
    && cp /tmp/autosubsync-model/trained-model.json /tmp/autosubsync/trained-model.bin \
    && python3 -m venv /opt/autosubsync \
    && /opt/autosubsync/bin/pip install --no-cache-dir 'setuptools<81' wheel \
    && /opt/autosubsync/bin/pip install --no-cache-dir --no-build-isolation /tmp/autosubsync \
    && /opt/autosubsync/bin/autosubsync --help \
    && /opt/autosubsync/bin/python -c 'from pkg_resources import resource_filename; from autosubsync.model import load; load(resource_filename("autosubsync.main", "../trained-model.bin"))' \
    && mkdir -p /opt/engine-licenses \
    && cp /tmp/autosubsync/LICENSE.txt /opt/engine-licenses/autosubsync.txt \
    && cp /tmp/autosubsync-model/LICENSE.txt /opt/engine-licenses/autosubsync-model.txt \
    && rm -rf /tmp/autosubsync /tmp/autosubsync-model

# === Native alass source build; target architecture follows Docker's platform ===
FROM rust:1.85-bookworm AS alass-builder
ARG ALASS_COMMIT
WORKDIR /src/alass
RUN git init . \
    && git remote add origin https://github.com/kaegi/alass.git \
    && git fetch --depth 1 origin "$ALASS_COMMIT" \
    && git checkout --detach FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = "$ALASS_COMMIT" \
    && cargo build --locked --release --package alass-cli \
    && install -m 755 target/release/alass-cli /usr/local/bin/alass \
    && strip /usr/local/bin/alass \
    && /usr/local/bin/alass --help

# === Application build ===
FROM node:22-bookworm AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 build-essential \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
ENV HUSKY=0
RUN npm install --ignore-scripts && npm rebuild better-sqlite3
COPY . .
RUN npm run build && npm prune --omit=dev

# === Runtime ===
FROM node:22-bookworm-slim
ARG FFSUBSYNC_COMMIT
ARG AUTOSUBSYNC_COMMIT
ARG ALASS_COMMIT
ARG SUBSYNC_COMMIT
LABEL io.subsyncarr.ffsubsync.revision="$FFSUBSYNC_COMMIT" \
      io.subsyncarr.autosubsync.revision="$AUTOSUBSYNC_COMMIT" \
      io.subsyncarr.alass.revision="$ALASS_COMMIT" \
      io.subsyncarr.subsync.revision="$SUBSYNC_COMMIT"

ENV PUID=1000
ENV PGID=1000
ENV CRON_SCHEDULE="0 0 * * *"
ENV NODE_OPTIONS="--max-old-space-size=512"
# ffsubsync also installs a 'subsync' alias; the neck0l CLI must resolve first.
ENV PATH="/opt/subsync/bin:/opt/ffsubsync/bin:/opt/autosubsync/bin:$PATH"
ENV PYTHONWARNINGS="ignore::UserWarning"
ENV PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg python3 libpocketsphinx3 libsphinxbase3 libsndfile1 util-linux cron curl ca-certificates \
    && dpkgArch="$(dpkg --print-architecture)" \
    && curl -fsSL "https://github.com/tianon/gosu/releases/download/1.17/gosu-$dpkgArch" -o /usr/local/bin/gosu \
    && chmod +x /usr/local/bin/gosu \
    && apt-get purge -y curl \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=subsync-builder /opt/subsync /opt/subsync
COPY --from=ffsubsync-builder /opt/ffsubsync /opt/ffsubsync
COPY --from=autosubsync-builder /opt/autosubsync /opt/autosubsync
COPY --from=subsync-builder /opt/engine-licenses /usr/local/share/licenses/engines
COPY --from=ffsubsync-builder /opt/engine-licenses /usr/local/share/licenses/engines
COPY --from=autosubsync-builder /opt/engine-licenses /usr/local/share/licenses/engines
COPY --from=alass-builder /usr/local/bin/alass /usr/local/bin/alass
COPY --from=alass-builder /src/alass/LICENSE /usr/local/share/licenses/engines/alass.txt
COPY bin/ffprobe /usr/local/bin/ffprobe
RUN chmod +x /usr/local/bin/ffprobe \
    && python3 -c 'import json,sys; names=("ffsubsync","autosubsync","alass","subsync"); json.dump(dict(zip(names,sys.argv[1:])),open("/app/engine-sources.json","w"),indent=2)' \
       "$FFSUBSYNC_COMMIT" "$AUTOSUBSYNC_COMMIT" "$ALASS_COMMIT" "$SUBSYNC_COMMIT" \
    && mkdir -p /app/data/subsync /home/node/.config \
    && ln -s /app/data/subsync /home/node/.config/subsync \
    && chown -R node:node /app/data /home/node/.config \
    && ffsubsync --help >/dev/null \
    && autosubsync --help >/dev/null \
    && alass --help >/dev/null \
    && subsync --cli --help >/dev/null

COPY entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh
EXPOSE 3000
USER root
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "--optimize-for-size", "dist/index-server.js"]

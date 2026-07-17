FROM node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY shared/package.json shared/package.json
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN useradd --system --create-home --home-dir /home/dmm --shell /usr/sbin/nologin dmm \
  && mkdir -p /app/data \
  && chown -R dmm:dmm /app
COPY --from=build --chown=dmm:dmm /app/package.json /app/package-lock.json* ./
COPY --from=build --chown=dmm:dmm /app/shared/package.json ./shared/package.json
COPY --from=build --chown=dmm:dmm /app/shared/dist ./shared/dist
COPY --from=build --chown=dmm:dmm /app/server/package.json ./server/package.json
COPY --from=build --chown=dmm:dmm /app/web/package.json ./web/package.json
COPY --from=build --chown=dmm:dmm /app/server/dist ./server/dist
COPY --from=build --chown=dmm:dmm /app/web/dist ./web/dist
RUN npm ci --omit=dev --ignore-scripts --workspace @dmm/server --include-workspace-root=false
USER dmm
EXPOSE 4100
CMD ["node", "server/dist/index.js"]

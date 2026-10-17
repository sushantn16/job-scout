# job-scout: dashboard + pipeline in one image. Data, config, AWS credentials and the output folder are mounted at
# runtime (see compose.yaml); nothing personal is baked into the image.

FROM node:24-bookworm-slim AS base
# pnpm is fetched once at build time into a shared location, so containers start without downloading anything.
ENV COREPACK_HOME=/opt/corepack COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.22.0 --activate && chmod -R a+rX /opt/corepack
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm dashboard:build

FROM base AS runtime
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
# Full Chromium only. Playwright's default headless shell drops spaces from PDF text ("+49 30 1234567" comes out as
# "+49301234567"), which breaks how applicant-tracking systems read the CV; full Chromium extracts exactly like Chrome on the Mac.
RUN pnpm exec playwright-core install --with-deps --no-shell chromium && rm -rf /var/lib/apt/lists/*
COPY tsconfig.json ./
COPY src ./src
COPY config ./config
COPY assets ./assets
COPY --from=build /app/dashboard/dist ./dashboard/dist
# Mount points for the named volumes; a new volume copies this ownership, so the node user can write to it.
RUN mkdir -p data applications out && chown -R node:node /app

ENV JOB_SCOUT_HOST=0.0.0.0 JOB_SCOUT_CHROME_CHANNEL=chromium
USER node
EXPOSE 8765
CMD ["pnpm", "-s", "dashboard"]

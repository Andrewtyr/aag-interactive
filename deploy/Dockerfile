FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends libreoffice-impress poppler-utils fonts-dejavu-core fonts-liberation && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci --omit=dev
COPY apps/api apps/api
COPY apps/web apps/web
COPY packages/contracts packages/contracts
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
ENV HOST=0.0.0.0 PORT=4180 AAG_DB_PATH=/data/aag.sqlite NODE_ENV=production
EXPOSE 4180
CMD ["npm", "--workspace", "@aag/api", "start"]

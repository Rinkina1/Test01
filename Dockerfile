# Multi-stage build for SQLite-backed Node.js app
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache tini
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_DIR=/app/data
EXPOSE 8080
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]

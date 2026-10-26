# Always the newest Node.js 22 image (build with --pull so the base is fresh). The build stops if
# that Node.js is older than the patched release in security/node-floor.json.
FROM node:22-slim
# Fresh system certificate store (drops distrusted certificate authorities such as the eMudhra
# intermediates revoked in October 2026) and the latest OS security patches.
RUN apt-get update && apt-get upgrade -y --no-install-recommends && apt-get install -y --no-install-recommends ca-certificates \
  && update-ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json .npmrc ./
COPY security ./security
COPY src/runtime-check.js ./src/runtime-check.js
RUN node -e "import('./src/runtime-check.js').then(m => { const s = m.nodeStatus(); if (!s.ok) { console.error('Node.js ' + s.version + ' is older than the patched ' + s.min); process.exit(1); } })"
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]

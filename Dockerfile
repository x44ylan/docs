FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps --ignore-scripts
COPY . .
RUN npx vite build && npm prune --omit=dev --legacy-peer-deps --ignore-scripts

FROM node:24-slim
ENV NODE_ENV=production DOCS_DATA=/data HOST=127.0.0.1 PORT=3000
WORKDIR /app
COPY --from=build --chmod=a+rX /app/node_modules node_modules
COPY --from=build --chmod=a+rX /app/dist dist
COPY --chmod=a+rX package.json ./
COPY --chmod=a+rX server server
COPY --chmod=a+rX shared shared
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/up').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server/main.ts"]

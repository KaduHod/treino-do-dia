# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Dependências de produção (express + ejs). Sem build step: Tailwind e HTMX
# são carregados via CDN, então a imagem final só precisa do runtime do Node.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---------------------------------------------------------------------------
# Imagem final
# ---------------------------------------------------------------------------
FROM node:22-alpine

WORKDIR /app

# NODE_ENV=production: Express ativa o cache de views (templates são imutáveis
# dentro da imagem) e evita reinstalar dependências por engano.
ENV NODE_ENV=production \
    PORT=3000 \
    EXERCISES_API_URL=http://localhost:3055/api/v1

COPY --from=deps --chown=node:node /app/node_modules ./node_modules

# package.json é obrigatório: "type": "module" habilita os ES Modules.
COPY --chown=node:node package.json server.js config.js ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node routes ./routes
COPY --chown=node:node services ./services
COPY --chown=node:node views ./views
COPY --chown=node:node public ./public

# Mock da API incluído apenas para demonstração local:
#   docker run ... node mock-api/server.js
COPY --chown=node:node mock-api ./mock-api

# data/workouts.json é criado em runtime; o diretório precisa ser gravável
# pelo usuário "node" (uid 1000) que executa o processo.
RUN mkdir -p /app/data && chown -R node:node /app/data

USER node

EXPOSE 3000

# Volume anônimo por padrão; no compose usamos o volume nomeado "workouts-data".
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# "node --env-file=.env" (npm start) não serve aqui: as variáveis vêm do
# ambiente do container (-e, --env-file do Docker ou docker-compose).
CMD ["node", "server.js"]

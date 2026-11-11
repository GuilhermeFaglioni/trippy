# Contexto de build: a raiz do repo (o pnpm-lock.yaml fica lá).
#   docker build -f apps/landing/Dockerfile --build-arg VITE_WAITLIST_URL=... .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @trippy/landing
# a URL da planilha é embutida no JavaScript durante o build
ARG VITE_WAITLIST_URL
ENV VITE_WAITLIST_URL=$VITE_WAITLIST_URL
RUN pnpm --filter @trippy/landing build

FROM nginx:alpine
COPY apps/landing/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/landing/dist /usr/share/nginx/html
EXPOSE 80

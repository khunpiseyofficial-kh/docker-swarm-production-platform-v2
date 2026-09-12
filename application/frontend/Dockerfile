# syntax=docker/dockerfile:1
# ==============================================================================
# Multi-stage Dockerfile for Swarm E-Commerce Frontend (React + Vite)
# Served via nginxinc/nginx-unprivileged (non-root)
# ==============================================================================

# --- Stage 1: Build React Assets ---
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# --- Stage 2: Hardened Unprivileged Web Server ---
FROM nginxinc/nginx-unprivileged:alpine AS runner

# Copy custom hardened Nginx configuration
COPY --chown=nginx:nginx nginx.conf /etc/nginx/nginx.conf

# Copy production static assets from build stage
COPY --from=builder --chown=nginx:nginx /app/dist /usr/share/nginx/html

# Expose unprivileged HTTP port
EXPOSE 8080

# Container Healthcheck using explicit 127.0.0.1 (resolving Alpine musl IPv6 localhost issue)
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:8080/nginx-health || exit 1

CMD ["nginx", "-g", "daemon off;"]

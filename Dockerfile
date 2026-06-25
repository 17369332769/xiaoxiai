# 小希 AI —— Render 单服务镜像：nginx 托管前端 dist/ + 反代 /api 到同容器内的 node 后端。
# 同源（前端写死相对路径 /api）、SSE 不缓冲、单块持久磁盘存 SQLite。

# ---- Stage 1: 构建前端（产出 dist/，含 public/admin.html） ----
FROM node:22-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- Stage 2: 后端生产依赖（sqlite3 原生模块需要工具链兜底编译） ----
FROM node:22-slim AS backend-deps
WORKDIR /app/backend
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

# ---- Stage 3: 运行时（node + nginx 一体） ----
FROM node:22-slim
ENV NODE_ENV=production
RUN apt-get update \
    && apt-get install -y --no-install-recommends nginx gettext-base \
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /etc/nginx/sites-enabled/default /etc/nginx/conf.d/default.conf

WORKDIR /app
# 后端源码 + shared（backend 以 ../../shared/ 相对引用，目录结构必须保持）
COPY backend/ ./backend/
COPY shared/ ./shared/
# 后端依赖（从 stage 2 拷入，避免带进宿主机平台不符的 node_modules）
COPY --from=backend-deps /app/backend/node_modules ./backend/node_modules
# 前端构建产物
COPY --from=frontend /app/dist ./dist
# nginx 模板 + 启动脚本
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY deploy/start.sh /start.sh
RUN chmod +x /start.sh

# Render 默认把流量发到 $PORT（默认 10000），nginx 在启动脚本里绑定它。
EXPOSE 10000
CMD ["/start.sh"]

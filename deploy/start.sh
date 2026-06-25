#!/usr/bin/env bash
# 容器入口：渲染 nginx 配置 → 起 node 后端（内部 3000）→ 起 nginx（Render 的 $PORT）。
# 任一进程退出即整体退出，交给 Render 重启容器。
set -euo pipefail

# Render 给公网监听用的端口给 nginx；本地直接 docker run 时回退到 10000。
export NGINX_PORT="${PORT:-10000}"

# 仅替换 ${NGINX_PORT}，保留 nginx 自身的 $host/$uri 等变量。
envsubst '${NGINX_PORT}' \
    < /etc/nginx/templates/default.conf.template \
    > /etc/nginx/conf.d/default.conf

# 确保持久磁盘上的数据目录存在（DB 与备份）。
DB_PATH="${XIAOXIAI_DB_PATH:-/var/data/xiaoxiai.sqlite}"
BACKUP_DIR="${DB_BACKUP_DIR:-/var/data/backups}"
mkdir -p "$(dirname "$DB_PATH")" "$BACKUP_DIR"

# 后端固定监听内部 3000（不能用 Render 的 $PORT，那是给 nginx 的）。
cd /app/backend
PORT=3000 node server.js &
BACKEND_PID=$!

# nginx 前台运行。
nginx -g 'daemon off;' &
NGINX_PID=$!

# 任一子进程先退出就返回，整体退出让 Render 拉起新容器。
wait -n "$BACKEND_PID" "$NGINX_PID"
EXIT_CODE=$?
echo "[start.sh] a process exited (code=$EXIT_CODE); shutting down container"
exit "$EXIT_CODE"

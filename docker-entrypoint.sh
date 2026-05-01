#!/bin/sh
set -e
# 卷挂载后若 node_modules 为空，在容器内安装依赖
if [ ! -d node_modules/vite ] || [ ! -d node_modules/express ]; then
  echo "[docker] Installing dependencies..."
  npm install
fi
exec "$@"

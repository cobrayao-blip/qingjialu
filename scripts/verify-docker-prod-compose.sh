#!/usr/bin/env bash
# 在仓库根或服务器 /data/qjl/app 执行：bash scripts/verify-docker-prod-compose.sh
# 可选参数：compose 文件路径（默认 ./docker-compose.prod.yml）
set -euo pipefail
f="${1:-./docker-compose.prod.yml}"
if [[ ! -f "$f" ]]; then
  echo "missing: $f"
  exit 1
fi
# 非注释行不得出现误用的中文路径片段（旧版 compose 曾把目录名写进 dockerfile）
if grep -vE '^[[:space:]]*#' "$f" | grep -q '生产环境'; then
  echo "FAIL: non-comment line contains 生产环境 — check dockerfile/context paths"
  grep -vnE '^[[:space:]]*#' "$f" | grep '生产环境' || true
  exit 1
fi
if grep -E '^[[:space:]]*context:[[:space:]]*\.\.[[:space:]]*$' "$f"; then
  echo "FAIL: build.context must be . not .."
  exit 1
fi
if grep -E '^[[:space:]]*dockerfile:[[:space:]]*' "$f" | grep -qvE 'dockerfile:[[:space:]]*Dockerfile\.prod[[:space:]]*$'; then
  echo "FAIL: every build.dockerfile must be exactly: Dockerfile.prod"
  grep -nE 'dockerfile:' "$f" || true
  exit 1
fi
echo "OK: $f"

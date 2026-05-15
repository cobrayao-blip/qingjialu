#!/usr/bin/env bash
# 在「服务器」项目根执行一次：git pull 时尽量不再用远端版本覆盖这三份本地文件。
# 原理：git update-index --skip-worktree（仅本机仓库有效，不写入 git 历史）
#
# 用法：bash scripts/server-keep-prod-three-files.sh
#
# 之后若要主动与 GitHub 对齐某文件：
#   git update-index --no-skip-worktree docker-compose.prod.yml
#   git checkout -- docker-compose.prod.yml
#
# 注意：若远端也改了同一文件，pull 可能提示冲突，需手工处理后再决定是否恢复 skip-worktree。

set -euo pipefail
cd "$(dirname "$0")/.."
for f in docker-compose.prod.yml Dockerfile.prod deploy/nginx.docker.conf; do
  git update-index --skip-worktree "$f"
  echo "skip-worktree: $f"
done
echo "完成。验证：git ls-files -v | grep '^S'"

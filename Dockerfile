# 开发与构建共用基础镜像（Debian 便于 better-sqlite3 等原生模块）
# 若无法访问 Docker Hub，可构建时传入国内镜像：--build-arg BASE_IMAGE=docker.m.daocloud.io/library/node:22-bookworm-slim
ARG BASE_IMAGE=node:22-bookworm-slim
FROM ${BASE_IMAGE}

# 安装 curl（健康检查）与 ffmpeg（绘本导出 MP4）
RUN apt-get update && apt-get install -y --no-install-recommends curl ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先只复制依赖描述，便于利用镜像缓存
COPY package.json package-lock.json* ./
RUN npm install

# 再复制源码与入口脚本（开发时由 volume 覆盖源码，entrypoint 会按需执行 npm install）
COPY . .

EXPOSE 3000 3001
ENTRYPOINT ["sh", "/app/docker-entrypoint.sh"]
CMD ["npm", "run", "dev:all"]

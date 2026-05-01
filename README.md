# 清嘉录 · 苏州民俗大观

基于清代顾禄《清嘉录》的苏州民俗知识平台：时令习俗、古今地理、知识图谱、**民俗绘本**；采用**国内大模型（阿里云通义千问 + 万相）**，便于在中国境内商业化部署。

## 功能

- **时令**：按月份浏览《清嘉录》民俗概要与习俗（由通义千问生成）
- **解析**：民俗/文言问答与白话翻译（通义千问）
- **地理**：古今地标对照
- **图谱**：月份–习俗–角色关系图
- **绘本**：输入民俗主题，生成带插图的绘本并保存到本地（通义千问写剧本 + 通义万相绘图）
- **大模型配置**：在前端「大模型」页配置 API Key、文本/图像模型；支持脱敏展示、连接测试与保存到本地数据库（优先于环境变量）

## 技术栈

- 前端：React 19、Vite、TypeScript、Tailwind、D3、Motion
- 后端：Express、Node、TypeScript（tsx）
- 大模型：阿里云 DashScope（通义千问 + 万相 2.6）
- 存储：PostgreSQL（绘本、大模型配置、缓存等持久化）

## 本地运行

**环境要求：** Node.js 18+

1. 安装依赖：`npm install`
2. 复制环境变量（可选）：`cp .env.example .env`，可填写 `DASHSCOPE_API_KEY` 作为默认 Key；也可在应用内「大模型」页配置并保存到数据库。
3. 启动前后端（推荐）：
   ```bash
   npm run dev:all
   ```
   浏览器访问 http://localhost:3000；后端 API 在 http://localhost:3001，由 Vite 代理转发 `/api`。

   或分别启动：
   - 后端：`npm run dev:server`
   - 前端：`npm run dev`

## Docker

- **生产**：`docker-compose.prod.yml` + `Dockerfile.prod`（PostgreSQL + API + Nginx，见 **[部署手册](docs/部署手册.md)**）。
- **开发**（热更新）：见下文「Docker 容器化开发」。

## Docker 容器化开发（推荐用于前端应用测试）

**环境要求：** 已安装 Docker 与 Docker Compose

**无法连接 Docker Hub（连接超时 / 国内网络）时：**

- **方式一（推荐）**：配置 Docker 使用国内镜像源，再执行原来的构建命令。
  - **Docker Desktop**：Settings → Docker Engine，在 JSON 里加上（或合并进现有配置）：
    ```json
    "registry-mirrors": ["https://docker.m.daocloud.io", "https://docker.1panel.live"]
    ```
    保存后 Apply and restart。
  - **Linux**：编辑 `/etc/docker/daemon.json`，添加上述 `registry-mirrors`，然后执行 `sudo systemctl restart docker`。
- **方式二**：不改 Docker 配置，构建时指定国内镜像作为基础镜像：
  ```bash
  docker compose -f docker-compose.yml -f docker-compose.standalone.yml build --build-arg BASE_IMAGE=docker.m.daocloud.io/library/node:22-bookworm-slim
  docker compose -f docker-compose.yml -f docker-compose.standalone.yml up -d
  ```

1. **必须在项目根目录执行**：先进入本项目目录再启动，例如：
   ```bash
   cd D:\qingjialu
   docker compose up --build
   ```
2. **（可选）** 在项目根目录创建 `.env`，写入 `DASHSCOPE_API_KEY=你的密钥`。不创建也可启动，之后在应用内「大模型」页配置并保存。
3. **一键启动前后端**：
   ```bash
   docker compose up --build
   ```
4. **前端测试**：浏览器打开 **http://localhost:3000**，即可进行时令、解析、地理、图谱、绘本、大模型配置等完整功能测试。前端请求 `/api` 会由 Vite 代理到容器内后端（api:3001）。
5. **热更新**：默认会把当前目录挂载进容器，修改代码后会自动热更新。若挂载异常，见下方「容器里看不到本项目」。
6. **数据持久化**：业务数据在 **PostgreSQL**（Compose 中 `db` 服务，数据卷 `pgdata`）。`./data` 挂载主要用于与宿主机共享导出文件等。

**容器里看不到本项目（例如 Windows 挂载失败）时：**

- 确认是在**项目根目录**执行 `docker compose up --build`（不要在别的目录跑）。
- Windows：在 Docker Desktop → Settings → Resources → File sharing 中，把项目所在盘（如 D:）加入共享。
- 仍无效时，改用「不挂载」方式，用镜像内自带的代码跑（无热更新，改代码需重新 build）：
  ```bash
  docker compose -f docker-compose.yml -f docker-compose.standalone.yml up --build
  ```
  然后访问 http://localhost:3000 即可看到本项目。

仅启动后端（例如本机跑前端）：
```bash
docker compose up api --build
```
本机执行 `npm run dev` 后访问 http://localhost:3000，Vite 会代理到 `localhost:3001`。

## 大模型配置与安全说明

- **配置入口**：导航栏「大模型」页可配置 API Key、文本模型（如 qwen-plus）、图像模型（如 wan2.6-image），支持**连接测试**与**保存**。
- **脱敏**：API Key 仅保存在服务端数据库，接口返回与前端展示均为脱敏（如 `***xxxx` 后四位）；输入框为密码类型，可选显示/隐藏。
- **优先级**：调用大模型时优先使用数据库中保存的 Key，未配置时再使用环境变量 `DASHSCOPE_API_KEY`。
- **安全建议**：
  - 生产环境务必使用 **HTTPS**，避免 Key 在传输中被窃听。
  - 若多人共用或对外服务，建议对「大模型」配置页做**访问控制**（如简单管理员密码或登录），否则任何人可修改 Key 并消耗配额。
  - PostgreSQL 中 `llm_config` 等表存有机密字段，需限制数据库访问与备份权限；有需要可后续改为服务端加密存储。

## 部署说明

- **生产部署（Docker Compose 或裸机 + PostgreSQL 数据盘 + Nginx/HTTPS）**：见 **[《部署手册》](docs/部署手册.md)**（推荐 Docker：`docker-compose.prod.yml`）。
- 前端构建：`npm run build`，将 `dist` 部署到静态托管或与后端同域。
- 后端：生产环境执行 `npm start`（即 `tsx server/index.ts`），需可用的 **PostgreSQL**，连接参数见 `.env.example`（`PG_*`）。首次启动会 `initDb` 建表。
- 环境变量：`DASHSCOPE_API_KEY`（可选）、`PORT`、`PG_*`、**`JWT_SECRET`（生产必须改为强随机）**、`ADMIN_USERNAME` / `ADMIN_PASSWORD`（可选，用于初始化管理员）。详见 `.env.example`。
- 若前端与后端不同域：构建时设置 `VITE_API_BASE` 为后端根地址（如 `https://api.example.com`），并配置网关 **CORS**（当前后端为 `cors()` 全开放，面向公网时建议改为仅允许你的前端域名）。
- 反向代理（Nginx 等）：绘本等接口 body 较大，需放大 `client_max_body_size`（可参考仓库内 `docs/413-payload-too-large.md`）。
- 当前仓库自带 `Dockerfile` / `docker-compose` 面向**开发**（热更新、Vite dev）；上生产请自建镜像命令（例如构建静态文件 + 仅启动 `npm start`）或使用进程管理器（systemd、PM2 等）。

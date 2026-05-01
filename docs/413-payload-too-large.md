# 绘本保存报 413 (Payload Too Large) 的排查

绘本保存时请求体包含多页 base64 图片，体积较大。若出现 **413 Payload Too Large**，按下面顺序检查。

## 1. 后端 Express（已设置 100mb）

- 文件：`server/index.ts`  
- 已设置：`express.json({ limit: '100mb' })`
- **请重启 API 服务**（或重新构建并启动 Docker 中的 api 容器）使配置生效。

## 2. 使用 Nginx 反向代理时

在 `server` 或 `http` 块中增加或修改：

```nginx
client_max_body_size 100m;
```

然后执行 `nginx -s reload` 或重启 Nginx。

## 3. 使用 Docker / 云平台时

- 若前面还有负载均衡、网关或平台自带的“请求体大小”限制，需在对应控制台或配置里调大（建议 ≥ 100MB）。
- 本地 Docker Compose 直连 api 容器时，一般只需保证上面的 Express 限制生效即可。

## 4. 开发时走 Vite 代理

- 前端请求会经 Vite 代理转发到 API，413 通常由**接收并解析 body 的 API 服务**返回。
- 确保 API 已按第 1 步设置并**已重启**。

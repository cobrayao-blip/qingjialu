# 大模型调用点与配置同步检查清单

本文档列出所有调用大模型的位置，并确认其均从「大模型配置」读取 URL、模型名、API Key，无写死。

---

## 1. 文本模型调用（dashscopeChat / dashscopeChatJson）

| 位置 | 配置来源 | URL/模型 | API Key | 未配置时行为 | 状态 |
|------|----------|----------|---------|--------------|------|
| `server/routes/api.ts` → POST `/api/llm/chat` | `getLlmModels()` | modelText, urlText | `requireDashScope()` | 400，提示填写 URL/模型名 | ✅ 已同步 |
| `server/routes/api.ts` → POST `/api/llm/month-data` | `getLlmModels()` | modelText, urlText | `requireDashScope()` | 400，提示填写 URL/模型名 | ✅ 已同步 |
| `server/routes/api.ts` → POST `/api/config/llm/test` | `getLlmModels()`，body 可覆盖 | model, urlText | body 或 `getDashScopeApiKeyText()` | 400，提示填写 URL/模型名 | ✅ 已同步 |
| `server/pictureBook.ts` → `generatePictureBookScript()` | `getLlmConfig()` | model_text, url_text | `requireDashScope()` | throw，提示在「大模型配置」→ 文本模型填写 | ✅ 已同步 |

---

## 2. 图像模型调用（dashscopeTextToImage）

| 位置 | 配置来源 | URL/模型 | API Key | 未配置时行为 | 状态 |
|------|----------|----------|---------|--------------|------|
| `server/routes/api.ts` → POST `/api/config/llm/testimage` | `getLlmConfig()` + `getLlmModels()`，body 可覆盖 | model, imageApiUrl | body 或 `getDashScopeApiKeyImage()` | 400，提示配置 URL/模型名 | ✅ 已同步 |
| `server/index.ts` → POST `/api/config/llm/testimage` | `getLlmConfig()`，body 可覆盖 | cfg.model_image, cfg.url_image | body 或 `getDashScopeApiKeyImage()` | 400，提示配置 URL/模型名 | ✅ 已同步 |
| `server/pictureBook.ts` → `generatePictureBook()` 插图 | `getLlmConfig()` | model_image, url_image | `requireDashScopeImage()` | 未配置且需生成图时 throw，提示在「大模型配置」→ 图像模型填写 | ✅ 已同步 |

---

## 3. 底层实现（不写死 URL/模型）

| 文件 | 说明 | 状态 |
|------|------|------|
| `server/llm/dashscope.ts` | `dashscopeChat` / `dashscopeChatJson` 必须传入 `model` + `textApiUrl`；`dashscopeTextToImage` 必须传入 `model` + `imageApiUrl`；未传则抛错 | ✅ 已同步 |
| `server/llmConfig.ts` | `getDashScopeApiKeyText()` / `getDashScopeApiKeyImage()` 从 `getLlmConfig()` 读 api_key_text / api_key_image / api_key | ✅ 已同步 |
| `server/db.ts` | `getLlmConfig()` 返回原始行；`getLlmConfigForDisplay()` 的 model/url 未配置时返回空字符串；schema 中 `model_text` / `model_image` 已去掉默认值 | ✅ 已同步 |

---

## 4. 其他说明

- **前端**：仅通过后端接口调用大模型（如 `/api/llm/chat`、`/api/llm/month-data`、绘本生成等），未直接写死任何模型 URL 或模型名。配置页的「示例 URL」仅作占位提示，实际请求均用后端从 DB 读取的配置。
- **数据库**：`llm_config` 表新建时 `model_text`、`model_image` 无默认值，新安装需用户在「大模型配置」中填写文本/图像 URL 与模型名后再使用。

---

*最后检查日期：与代码同步。*

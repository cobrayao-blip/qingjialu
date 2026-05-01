# 按月份获取《清嘉录》结构化民俗数据 — 功能分析与实现对比

## 一、你提供的代码（Gemini 版）功能分析

```ts
export async function getStructuredMonthData(month: string) {
  const response = await ai.models.generateContent({
    model: geminiModel,
    contents: `请提取《清嘉录》中关于"${month}"的核心民俗活动。`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          month: { type: Type.STRING },
          summary: { type: Type.STRING, description: "该月份民俗的总体特征" },
          customs: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING, description: "习俗名称" },
                description: { type: Type.STRING, description: "习俗详细描述" },
                roles: { type: Type.ARRAY, items: { type: Type.STRING }, description: "涉及的人物角色" },
                modernStatus: { type: Type.STRING, description: "该习俗在现代苏州的存续情况或对应地点的现状" }
              },
              required: ["name", "description"]
            }
          }
        },
        required: ["month", "summary", "customs"]
      }
    }
  });
  // ...
}
```

**功能概括：**

- **输入**：月份字符串（如 `"正月"`）。
- **输出**：结构化 JSON，包含：
  - `month`：月份名
  - `summary`：该月民俗总体特征
  - `customs`：习俗数组，每项含 `name`、`description`、可选 `roles`、`modernStatus`
- **实现方式**：调用 **Google Gemini**，通过 **responseMimeType + responseSchema** 做**原生 JSON 模式**生成，模型按 schema 直接返回 JSON，无需后处理解析。

---

## 二、本项目中该功能的位置

| 层级 | 文件 | 说明 |
|------|------|------|
| **前端调用** | `src/services/api.ts` | `getStructuredMonthData(month)`，请求 `POST /api/llm/month-data` |
| **后端路由** | `server/routes/api.ts` | `POST /llm/month-data`，校验配置与 `month`，调用 `dashscopeChatJson<MonthData>` |
| **LLM 封装** | `server/llm/dashscope.ts` | `dashscopeChatJson<T>`：system + user 文本对话，返回文本再 `JSON.parse` |
| **类型定义** | `server/types.ts` | `MonthData`、`MonthCustom` 与上述结构一致 |

**核心逻辑（本项目）：**

- **路由**（`server/routes/api.ts` 约 71–95 行）：从配置取文本模型 URL/模型名，用 `MONTH_JSON_SYSTEM` 作为 system prompt，用户 prompt 为 `请提取《清嘉录》中关于“${month}”的核心民俗活动。`，调用 `dashscopeChatJson<MonthData>`，把结果直接 `res.json(data)`。
- **MONTH_JSON_SYSTEM**（同文件约 15–29 行）：一段自然语言说明，规定“只输出一个 JSON 对象”、字段含义及 `customs` 至少 2 项、最多 8 项。
- **dashscopeChatJson**（`server/llm/dashscope.ts` 约 71–88 行）：用任意配置的**文本模型**（如千问）做一次 Chat，拿到回复文本后去掉 markdown 代码块、`JSON.parse` 成 `T` 返回；无 schema，靠 prompt 约束格式。

---

## 三、两套实现的优劣比较

| 维度 | Gemini 版（你提供的代码） | 本项目（DashScope/配置化文本模型） |
|------|---------------------------|------------------------------------|
| **JSON 约束方式** | 使用 API 的 **responseSchema + responseMimeType**，模型原生按 schema 输出 JSON | 仅用 **自然语言 system prompt** 描述格式，模型自由生成后再 `JSON.parse` |
| **格式稳定性** | 高：API 保证结构符合 schema，字段类型、必填项由服务端约束 | 较低：可能多 markdown、多余说明、字段名/结构偏差，需依赖 prompt 与后处理 |
| **模型与部署** | 绑定 **Gemini**，需 Google API Key，国内访问可能受限 | **模型可配置**（如千问等），URL/模型名/API Key 存库，适合国内部署与切换厂商 |
| **类型安全** | schema 与 TypeScript 类型需自行对应 | 后端统一 `MonthData` 类型，前后端一致 |
| **扩展性** | 换模型需改代码、可能无 schema 能力 | 换模型/换 URL 仅改配置，同一套 prompt 可用于不同文本模型 |
| **依赖** | 依赖 `@google/genai` 及 Gemini 专有 API | 仅通用 HTTP + 配置，无厂商 SDK 强依赖 |
| **错误与重试** | 由 SDK 与 Gemini 错误码决定 | 可统一走现有 HTTP/重试/降级逻辑 |

**简要结论：**

- **Gemini 版**：适合“强需求结构化、且能用 Gemini”的场景，格式最稳、实现最省心。
- **本项目**：适合“国内部署、多模型可配、不绑定一家厂商”的场景，用 prompt 换灵活性，需接受一定格式波动和 prompt 调优。

---

## 四、已借鉴：JSON 模式（response_format）

本项目已采纳 Gemini 的思路，在**不绑定 Gemini** 的前提下做了增强：

- **`server/llm/dashscope.ts`**  
  - `dashscopeChat` 增加可选参数 `options?: { responseFormat?: 'json_object' }`。  
  - 当使用千问/DashScope **原生**文本接口（URL 含 `text-generation`）且传入 `responseFormat: 'json_object'` 时，在请求体中加上 `parameters: { result_format: 'message', response_format: { type: 'json_object' } }`，与阿里云文档一致。  
  - `dashscopeChatJson` 在检测到上述原生接口时，自动传入该选项，从而启用 **JSON 模式**，减少模型输出多余 markdown 或说明导致的解析失败。

效果：月份结构化数据（以及其它走 `dashscopeChatJson` 的调用）在配置为千问等支持 JSON 模式的模型时，格式更稳定，更接近 Gemini 的“原生结构化输出”体验，同时仍保留可配置 URL/模型、国内部署等现有优势。

若后续采用的接口支持 **JSON Schema 模式**（严格 schema），可在同一处扩展 `response_format` 为 `{ type: 'json_schema', json_schema: {...} }`，进一步向 Gemini 的 schema 约束靠拢。

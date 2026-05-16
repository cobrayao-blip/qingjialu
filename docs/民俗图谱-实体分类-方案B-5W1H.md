# 民俗图谱：实体分类方案 B（5W1H + 感受）

> **分支说明**：本文件在分支 `feature/graph-taxonomy-scheme-b` 上维护，用于试点**对外讲解维度**（方案 B），**不替代**主分支上既有的技术类型名（`EntityType`）与三种探索预设（月令三角 / 地景 / 叙事）。  
> **主技术说明**仍见：[民俗图谱与工作台.md](./民俗图谱与工作台.md)。

---

## 1. 为什么需要方案 B

技术模型里已有 `time`、`practice`、`actor` 等英文类型，对内准确；对访客或合作方讲解时，可再用一层 **问题导向的中文框架**，把「图里有什么」说成一组好记的问题：**何时、何地、谁、用什么、做什么、何以如此、感受如何**。

方案 B 不改变 JSON 字段名，只定义 **产品与文档层** 的归类与话术（后续若采纳，再逐步落到 UI 文案、图例、帮助页）。

---

## 2. 七类叙事角色 → 5W1H + 感受

| 方案 B 维度 | 中文称呼（建议） | 对应 `EntityType` | 典型例子 |
|-------------|------------------|-------------------|----------|
| **When** | 月份 / 时令 | `time` | 正月、五月、八月 |
| **Where** | 地点 | `place` | 玄妙观、上方山、葑门外荷花荡 |
| **Who** | 人物 | `actor` | 士女、官府、舟子（以图中实际标签为准） |
| **With what** | 物件 | `artifact` | 春牛、花灯、龙舟、月饼、青团、艾草 |
| **What happens** | 习俗 / 活动 | `practice` | 行春、闹元宵、竞渡、赏月 |
| **Why / as what** | 概念 | `concept` | 如「端午象征」「团圆意涵」等抽象标签（以 `conceptTags` / 概念实体为准） |
| **How it feels** | 体验 | `experience` | 如「桨声齐发」「灯火如昼」等感官与情境（以 `experienceTags` / 体验实体为准） |

**说明**：

- **文献** `source` 不列入上表「七类叙事角色」，而作为 **证据与出处**（所有叙事角色均可经 `documented_in` 等挂到文献）。对外一句话：**「七类讲节俗本身，文献讲依据。」**
- **月份与时令**、**习俗与活动**：在数据上分别是 `time` 与 `practice` 各一种类型；方案 B 用双名是为了兼容「月令口语」与「行为学术语」。

### 2.1 图谱串联示例（便于导览词）

以下用**口语串一条线**，便于讲解员带观众「走一遍」；边 id 以数据为准，此处只示意语义。

**示例 A：端午竞渡**

- **When**：五月  
- **What happens**：竞渡（或「划龙船」类活动节点）  
- **Where**：水次、湖港（若有 `occurs_at`）  
- **Who**：舟子、观众（若有 `performed_by`）  
- **With what**：龙舟、艾草（`uses`）  
- **Why / How it feels**：概念与体验标签（叙事视图里展开）  
- **文献**：《清嘉录》端午相关小节（`documented_in`）

**示例 B：元宵灯市**

- **When**：正月  
- **What happens**：闹元宵 / 夜游观灯类活动  
- **With what**：花灯  
- **Who**：士女游观（若有）  
- **文献**：元宵相关小节引文  

**示例 C：只打开「叙事」预设时**

- 画布侧重 **What happens ↔ Why ↔ How it feels**；**When / Where / Who / With what** 仍可通过侧栏邻居关系或工作台查到，不必在同一张力导图上全部展开。

### 2.2 与「时令」模块卡片的对照（ loosely 对齐）

时令页结构化数据（`MonthData` / `MonthCustom`）与方案 B 的**非严格**对应关系：

| 方案 B | 时令卡片中的体现 |
|--------|------------------|
| When | 当前所选月份 + 「{月} · 概要」 |
| What happens | `custom.name` / `custom.description` |
| Who | `custom.roles`（`#` 人物标签） |
| Where | 「相关地点（时令）」、古今对照里的空间与变迁叙述 |
| 文献依据 | 「基于《清嘉录》原文 N 条」、原文目录与抽屉 |
| With what / Why / How it feels | **多数融在描述正文**，未拆成独立字段；与图谱中 `artifact` / `concept` / `experience` 的显式建模互补 |

用途：对外可说「时令卡片像一篇按月份展开的节俗导读；图谱把同一类信息收成可点击的网络」。

---

## 3. 与主要关系类型的口头对照（便于导览）

| 关系（技术名） | 方案 B 读法示例 |
|----------------|-----------------|
| `occurs_in` | **When** 之下发生 **What happens** |
| `occurs_at` | **What happens** 发生于 **Where** |
| `performed_by` | **Who** 参与 **What happens** |
| `uses` | **What happens** 用到 **With what** |
| `documented_in` | 某条叙述 **见于文献** |
| `symbolizes` / `regulates` / `evokes` / `associated_with` | **What happens** 与 **Why**、**How it feels** 之间的叙事链 |

（完整关系表仍以 [民俗图谱与工作台.md](./民俗图谱与工作台.md) 为准。）

---

## 4. 与三种探索预设的关系（当前实现不变）

| 预设（界面名） | 方案 B 视角下的侧重点 |
|----------------|----------------------|
| 月令三角（原「三维」） | **When + What happens + Who**（外加文献） |
| 地景 | **When + Where + What happens** |
| 叙事 | **What happens + Why + How it feels** |

**物件** `artifact` 当前默认不在三种探索画布的主节点集合中，但方案 B 把它明确为 **With what**；若未来增加「器物 / 食俗」视图或扩展地景子图，可直接挂在这一维上，无需新造类型名。

---

## 5. 落地清单（可随 PR 勾选）

以下为 **采纳方案 B 时** 建议的任务项，按风险从低到高排列；**不必一次做完**。

### 5.1 文档与对内口径

- [ ] 培训/解说词采用本表英文或中文维度（第七节英文可直用作对外一页纸）。
- [ ] 与「时令卡片」导览话术对齐（见 §2.2），避免观众以为图谱与卡片是两套无关体系。
- [ ] 修订本文件「修订记录」与主文档 [民俗图谱与工作台.md](./民俗图谱与工作台.md) 交叉引用保持有效。

### 5.2 图谱工作台（低风险 UI）

- [ ] `ResearchWorkbench`：实体类型筛选旁增加 **When / Where …** 副标或 `title` tooltip（映射表单一来源，避免手写两处不一致）。
- [ ] 导出 Markdown 时可选：在实体类型旁括号标注方案 B 维度（仅影响导出文案则更易回滚）。

### 5.3 图谱探索（中风险 UI / 文案）

- [ ] `FolkloreGraph`：筛选区「图谱筛选 / 高级筛选」增加一行**只读说明**或折叠帮助：「当前视图侧重 …（对应 5W1H 中的 …）」。
- [ ] 关系类型 chip：可选显示方案 B 一句读法（需防版面过长，可用 tooltip）。
- [ ] 产品决策：**是否将界面「三维」更名为「月令」等**（涉及导航习惯与旧链接 `graphMode`，需单独列任务）。

### 5.4 时令模块（可选、与方案 B 呼应）

- [ ] 习俗卡片角标或脚注一行字：**「维度提示」**（例如：本卡侧重 What happens + Who + 地点入口；器物与象征详见图谱）。
- [ ] 不强制改 `MonthCustom` JSON 结构；若未来结构化字段增多，再与图谱对齐。

### 5.5 国际化与代码结构（采纳较深时）

- [ ] 新增 `src/graph/entityTaxonomySchemeB.ts`（或同类模块）：导出 `EntityType → { zh, en, schemeBDimension }` 映射，供工作台 / 探索 / i18n 共用。
- [ ] `zh.json` / `en.json`（若项目已有 i18n）：增加 `graph.schemeB.*` 键值。
- [ ] 验收：切换语言后，图谱筛选与 tooltip 无截断、无错位。

### 5.6 数据与预设（采纳最深时）

- [ ] 评估是否新增第四预设「器物 / With what」或扩展地景子图包含 `artifact`（涉及 `getPresetSliceOptions` 与 `/api/graph/subgraph` 行为，需产品 + 性能评估）。
- [ ] 更新 `server/data/folklore-graph.v1.json` 编校规范说明（内部 wiki 或 `docs`），明确何时建 `uses` 边。

---

## 6. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-05-15 | 初版：分支 `feature/graph-taxonomy-scheme-b` 试点文档 |
| 2026-05-16 | 补充图谱/时令示例、可勾选落地清单、英文附录（Scheme B one-pager） |

---

## 7. Appendix — Scheme B in English (one-pager)

**Purpose.** Scheme B is a **visitor-facing taxonomy** layered on top of the existing technical model (`EntityType`, graph presets). It does **not** replace JSON field names or database types.

**The seven narrative roles (5W1H + sensation).**

| Dimension | Suggested English label | `EntityType` | Examples |
|-----------|-------------------------|--------------|----------|
| **When** | Month / season node | `time` | First month of the lunar year, Fifth month … |
| **Where** | Place | `place` | Temples, hills, waterways (as in data) |
| **Who** | People / roles | `actor` | Crowds, officials, boatmen … |
| **With what** | Objects / props | `artifact` | Spring ox, lanterns, dragon boats, rice cakes … |
| **What happens** | Custom / practice (event) | `practice` | Lantern festival, boat races, moon viewing … |
| **Why / as what** | Concept (meaning) | `concept` | Symbolic or normative readings (tags / nodes) |
| **How it feels** | Experience (sensory / affect) | `experience` | Sound, light, pace, communal mood (tags / nodes) |

**Evidence (not one of the seven).** `source` = textual **evidence** (`documented_in`, etc.). One-line pitch: *“Seven roles describe the festival world; sources anchor claims.”*

**Relation types in plain English (for tours).**

- `occurs_in` — *What happens* falls under *When*.  
- `occurs_at` — *What happens* is situated at *Where*.  
- `performed_by` — *Who* takes part in *What happens*.  
- `uses` — *What happens* employs *With what*.  
- `documented_in` — tied to a *source* passage.  
- `symbolizes` / `regulates` / `evokes` / `associated_with` — links between *What happens* and *Why / How it feels*.

**Three exploration presets vs Scheme B (unchanged behaviour).**

| Preset (UI) | Scheme B emphasis |
|-------------|-------------------|
| Month–custom–people (legacy “3D”) | **When + What happens + Who** (+ sources) |
| Time–place–practice (“terrain”) | **When + Where + What happens** |
| Practice–concept–experience (“narrative”) | **What happens + Why + How it feels** |

**`artifact` note.** Objects are first-class in the graph model but **not** on the default canvas of the three presets; Scheme B still labels them **With what** for tours and future UI.

**Implementation checklist (short).** Docs/training → tooltips on workbench → optional explorer help text → i18n map in one module → only then consider a fourth preset or canvas changes.

---

## 8. 文档维护

- 中英文表与示例应与 `server/data/folklore-graph.v1.json` 中**真实节点标签**定期核对；示例行仅作讲解模板，**以数据为准**。  
- 若三种预设或 `EntityType` 枚举在代码中有变更，请同步更新 §2、§3、§4 与 §7。

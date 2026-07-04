# Vimo MVP Demo 开发方案

本文档是面向开发执行的拆解方案，产品依据为 `docs/vimo-user-prd.md`。后续修改代码、prompt、配置、交互或数据结构前，必须先对照 PRD；如果要新增或改变 PRD 未覆盖的行为，应先询问是否同步 PRD。

## 1. 开发目标

MVP 先验证 Vimo 的核心记录闭环：

```text
自然语言输入
-> AI 理解内容
-> 自动分类和结构化
-> 用户确认、编辑或删除
-> 保存到对应列表
-> 后续可查看、可修改、可被上下文引用
```

P0 不能只做“模型返回一张卡片”，必须覆盖 PRD 中的基础记录能力：

- 自然语言输入。
- AI 自动分类。
- 待办、日记、备忘、想法四类记录。
- 待办时间识别。
- 明确时间的待办提醒。
- 到点后主动提醒用户。
- 模糊时间进入待确认。
- 待确认列表。
- 记录结果反馈。
- 基础编辑能力。
- 删除记录。
- 完成待办。

## 2. 范围拆分

### 2.1 P0 必做

P0 目标是让用户完成一次自然语言记录，并能在后续管理这条记录。

| 模块 | 必做能力 | 验收结果 |
| --- | --- | --- |
| 输入入口 | 文本输入自然语言；语音按钮可占位 | 用户无需选择分类即可提交 |
| Agent 理解 | 分类、时间识别、记录草稿、回复 | 输出结构化 JSON，不写死回复 |
| 意图协议 | 主意图、副意图、是否可沉淀、记录操作 | 不把玩笑、质问、闲聊默认保存 |
| 待确认 | 信息缺失、目标不唯一、风险操作确认 | 上方弱提醒，不强打断 |
| 记录管理 | 新增、更新、软删除、恢复、完成待办 | 右侧列表状态和后端一致 |
| 提醒 | 明确时间待办创建提醒；到点提醒 | Demo 可用 in-app 提醒，后续接系统通知 |
| 设置 | 模型、回复风格、称呼等全局配置 | 可通过 UI 和自然语言调整 |
| 持久化 | Records API 默认内存仓储，可显式启用 MySQL | 本地 demo 默认不依赖数据库，显式 `DB_DRIVER=mysql` 后可接 MySQL |

### 2.2 P1 增强

P1 目标是让记录体验更完整，并开始验证“聊天沉淀日记”。

- 默认提醒时间。
- 最近记录展示。
- 日记、备忘、想法独立列表。
- 低置信度提示。
- 简单搜索。
- 闲聊日记价值判断。
- 第一人称日记草稿。
- Vimo 回复单独记录。
- 用户确认、编辑、忽略日记草稿。
- 闲聊生成日记开关。
- 用户明确触发的主动回访。
- 主动回访开关。
- 免打扰时间设置。

### 2.3 P2 后续

P2 目标是让 Vimo 形成可检索的个人记忆。

- 语音输入。
- 系统通知完善。
- 日记库关键词检索。
- 日记库日期检索。
- 日记库语义检索。
- 记忆增强对话。
- 记忆引用来源展示。
- 更个性化的主动关怀。
- PWA 或小组件入口。

## 3. 总体架构

```text
vimo-web
  ChatAgent 页面
  Records 面板
  Pending 弱提醒
  Settings 面板
  Reminder 提醒入口

vimo-go
  http REST API
  agent 语义理解
  prompts 集中提示词
  records 记录服务
  reminders 提醒服务
  settings 用户偏好
  llm OpenAI Compatible Provider
  config 模型和环境配置

storage
  memory 当前默认
  MySQL 显式启用
```

架构原则：

- 业务代码不通过关键词、短语表或正则判断用户意图。
- 模型回复、确认话术、玩笑边界由模型根据 prompt 生成。
- Prompt 只放在 `vimo-go/prompts/`。
- 前端只执行模型返回的结构化协议，不自行推断语义。
- Records、Reminders、Settings、Agent 相互通过明确接口协作。

## 4. 数据模型拆解

### 4.1 Record

用于待办、日记、备忘、想法的统一记录。

```json
{
  "id": "record id",
  "type": "todo|journal|memo|idea|unknown",
  "title": "标题",
  "content": "AI 提炼后的正文",
  "source_text": "用户原始输入，可选",
  "datetime_text": "原始时间表达",
  "datetime_iso": "YYYY-MM-DD HH:mm:ss|null",
  "need_reminder": true,
  "confidence": 0.9,
  "status": "saved|need_confirmation|discarded|completed",
  "missing_fields": [],
  "created_at": "YYYY-MM-DD HH:mm:ss",
  "updated_at": "YYYY-MM-DD HH:mm:ss",
  "deleted_at": "YYYY-MM-DD HH:mm:ss|null",
  "previous_status": "saved|null"
}
```

要求：

- `content` 是理解后提炼的沉淀正文，不直接保存用户口语原文。
- 删除走软删除，进入回收站。
- 同一语义任务在待确认、上下文和最终记录中复用同一 ID。

### 4.2 PendingContext

用于承接未收口事项，不只包括“缺字段记录”，也包括待确认操作。

```json
{
  "id": "same as record or operation id",
  "kind": "record_draft|delete_confirm|update_confirm|clarification|config_update",
  "primary_intent": "主意图",
  "secondary_intents": [],
  "record_action": "create|update|delete|restore|none",
  "target_id": "record id|null",
  "related_ids": [],
  "preview": {},
  "last_user_message": "上一条用户输入",
  "last_assistant_reply": "上一条 AI 回复",
  "created_at": "YYYY-MM-DD HH:mm:ss",
  "updated_at": "YYYY-MM-DD HH:mm:ss"
}
```

要求：

- “删了吧 -> 是的”必须能接续到 `delete_confirm`。
- “都可以”“你定”“是的”这类短回复优先接续最近未收口上下文。
- Pending 弱提醒默认不打开，用户点击才进入弹窗。

### 4.3 Reminder

用于明确时间待办和用户授权的回访。

```json
{
  "id": "reminder id",
  "record_id": "record id|null",
  "type": "todo_due|follow_up",
  "title": "提醒标题",
  "due_at": "YYYY-MM-DD HH:mm:ss",
  "status": "scheduled|triggered|done|snoozed|cancelled",
  "snooze_count": 0,
  "created_at": "YYYY-MM-DD HH:mm:ss",
  "updated_at": "YYYY-MM-DD HH:mm:ss"
}
```

P0 可以先实现 in-app 到点提醒；系统通知、免打扰和权限管理进入 P1/P2。

### 4.4 UserSettings

用于保存全局配置。

```json
{
  "model_key": "gpt_5_4_mini",
  "reply_preset": "INTJ|ENFJ|ISTP|ENFP|custom",
  "custom_style": "",
  "nickname": "",
  "default_reminder_time": "09:00:00",
  "chat_diary_enabled": false,
  "memory_search_enabled": false,
  "active_reminder_enabled": true,
  "active_follow_up_enabled": false,
  "quiet_hours": {
    "enabled": false,
    "start": "22:00",
    "end": "08:00"
  }
}
```

要求：

- 用户可通过设置 UI 修改。
- 用户可通过自然语言修改；模型返回 `config_update/settings_patch`，前端或后端执行结构化补丁。
- 配置修改不进入记录沉淀。

### 4.5 DiaryDraft（P1）

闲聊生成日记时使用。

```json
{
  "id": "draft id",
  "source_message_ids": [],
  "entry_date": "YYYY-MM-DD",
  "title": "标题",
  "body_first_person": "第一人称日记正文",
  "topics": [],
  "keywords": [],
  "vimo_reply_summary": "Vimo 回复摘要",
  "confidence": 0.86,
  "status": "need_confirmation|saved|ignored|deleted"
}
```

要求：

- 默认生成草稿，不自动保存。
- 日记正文只写用户表达过的事实和感受。
- Vimo 回复不能混进用户第一人称正文。

## 5. Agent 意图协议

当前单一 `intent` 不足以表达真实对话。开发上应升级为“语义帧”，同时保留旧字段兼容 UI。

### 5.1 输出结构

```json
{
  "primary_intent": "record_create|record_update|record_delete|answer_query|joke|system_correction|config_update|clarify",
  "secondary_intents": ["emotion", "complaint", "possible_record_candidate"],
  "dialogue_act": "tell|ask|command|confirm|deny|correct|joke|complain",
  "recordability": "save|do_not_save|ask_user",
  "operation": {
    "action": "create|update|delete|restore|config_update|none",
    "target_id": "record id|null",
    "related_ids": [],
    "requires_confirmation": false
  },
  "reply_strategy": {
    "focus": "primary_intent",
    "mention_secondary": true
  },
  "record_preview": {}
}
```

### 5.2 关键判断顺序

模型必须先判断“这句话该不该沉淀”，再判断记录类型。

```text
是否是配置修改？
是否是查询、质问、纠错、投诉系统行为？
是否是玩笑、荒诞、口嗨、明显不现实表达？
是否在回答上一轮未收口操作？
是否明确要求保存或具备记录价值？
如果保存，分类为 todo/journal/memo/idea。
如果有副作用，生成 operation。
```

### 5.3 不应自动沉淀的情况

- 普通问答。
- 质问 Vimo 行为，例如“你为什么擅自记日记了”。
- 明显玩笑或荒诞表达。
- 用户表达“不想记录”“没叫你记”。
- 高敏感内容且用户没有明确保存意愿。

### 5.4 待确认操作

以下情况必须进入 PendingContext，而不是只生成普通记录草稿：

- 删除目标不唯一。
- 修改目标不唯一。
- 用户确认删除、恢复、覆盖、替换。
- 用户质疑系统误记后，Vimo 建议删除或修正。
- 用户短回复需要承接上一轮操作。

## 6. 后端开发拆解

### 6.1 基础服务

- `cmd/server` 启动 HTTP 服务。
- `internal/config` 加载 `.env`、模型配置、数据库配置。
- `internal/http` 提供 REST 路由和错误响应。
- `internal/llm` 定义 Provider 抽象。
- `internal/llm/qwen` 实现 OpenAI Compatible Chat Completions。
- `internal/agent` 负责 prompt 组装、模型调用、结构化结果归一化。

验收：

- `GET /api/health` 返回 `ok`。
- 模型地址、模型 ID、API Key、timeout 不写死在业务代码。
- `go test ./...` 通过。

### 6.2 Records 服务

API：

```http
GET /api/records
POST /api/records
PATCH /api/records/{id}
DELETE /api/records/{id}
```

任务：

- 统一记录模型。
- 默认使用内存仓储用于 demo。
- 支持显式启用 MySQL 持久化。
- 支持软删除和恢复。
- 支持完成待办。
- 支持按类型、状态过滤。
- 支持创建时传入已有 pending ID。

验收：

- 新增、编辑、软删除、恢复、完成待办都能反映到前端。
- 删除后不出现在普通列表，进入回收站。
- 时间显示统一为本地 `YYYY-MM-DD HH:mm:ss`。

### 6.3 Agent 服务

API：

```http
GET /api/agent/models
POST /api/agent/messages
```

请求应携带：

- 当前用户输入。
- timezone 和 now。
- model_key。
- model_options。
- open_contexts。
- closed_contexts。
- reply_profile。
- settings。

任务：

- 加载 `vimo-go/prompts/agent/analyze/` 下的 prompt。
- 支持多模型热切换。
- 输出结构化语义帧。
- 兼容旧 `intent/record_action/context_action`。
- 不在代码中写关键词判断。
- 失败时返回普通错误，不伪造 AI 回复。

验收：

- 问答不生成记录。
- 玩笑不默认沉淀。
- 待办、日记、备忘、想法能正确结构化。
- “删了吧 -> 是的”能删除上一轮确认目标。
- “你为什么擅自记日记了”不更新记录，先解释和询问处理方式。

### 6.4 Reminders 服务

P0 需要最小可用提醒。

API 建议：

```http
GET /api/reminders/due
POST /api/reminders
PATCH /api/reminders/{id}
POST /api/reminders/{id}/done
POST /api/reminders/{id}/snooze
```

任务：

- 明确时间待办自动创建 reminder。
- 前端定时轮询 due reminders。
- 到点后显示对话式提醒。
- 用户可完成、稍后提醒、改时间、删除。

验收：

- 创建一个 1 分钟后的待办，到点后前端出现提醒。
- 完成后记录状态变为 completed。
- 稍后提醒后 due_at 更新。

### 6.5 Settings 服务

P0 可先本地持久化，P1/P2 建议后端持久化。

API 建议：

```http
GET /api/settings
PATCH /api/settings
```

任务：

- 保存模型选择、回复风格、称呼。
- 保存默认提醒时间。
- 保存主动提醒、回访、闲聊生成日记、记忆检索开关。
- 支持 Agent `config_update/settings_patch` 修改。

验收：

- UI 修改和自然语言修改效果一致。
- 配置全局生效。
- 配置变更不生成记录。

### 6.6 Diary 和 Memory（P1/P2）

P1 API：

```http
POST /api/diary/drafts
POST /api/diary/drafts/{id}/save
POST /api/diary/drafts/{id}/ignore
```

P2 API：

```http
GET /api/diary/entries
POST /api/memory/search
```

任务：

- 保存对话来源。
- 判断日记价值。
- 生成第一人称日记草稿。
- 保存、编辑、忽略草稿。
- 仅使用已确认内容做记忆检索。

验收：

- 普通知识问答不生成日记。
- 用户生活经历可生成草稿，但不自动保存。
- 检索回复能展示引用来源。

## 7. 前端开发拆解

### 7.1 ChatAgent 主页面

任务：

- 展示用户消息、AI 回复、意图调试信息。
- 输入框发送文本。
- 语音入口占位。
- 发送时携带 open_contexts、closed_contexts、settings。
- 接收 Agent 结果并执行结构化动作。
- 不在前端通过关键词判断用户意图。

验收：

- 用户可以连续对话。
- AI 回复下方显示时间。
- 记录预览和待确认弱提醒不遮挡对话。

### 7.2 Pending 弱提醒

任务：

- 未收口项显示在会话区域上方。
- 默认不展开。
- 点击后打开小弹窗。
- 确认、补充、删除后同步清理 open context。
- 支持待确认操作，不只支持待确认记录。

验收：

- 补全后不会残留旧待确认。
- 删除确认后不会再次要求补充。
- “是的”“都可以”“删了吧”能接续最近未收口项。

### 7.3 Records 面板

任务：

- 右侧展示全部、待办、想法、备忘、日记、确认、回收站。
- 支持新增、编辑、软删除、恢复、完成待办。
- 时间格式统一。
- 搜索先做本地文本搜索，P2 走语义检索。

验收：

- 记录 CRUD 和后端一致。
- 删除后进入回收站。
- 回收站可恢复。

### 7.4 Settings 面板

任务：

- 模型选择。
- 回复风格。
- 自定义风格。
- 称呼。
- 默认提醒时间。
- 主动提醒开关。
- 主动回访开关。
- 闲聊生成日记开关。
- 记忆检索开关。

验收：

- UI 设置和自然语言设置写入同一份配置。
- 更换模型后下一次 Agent 请求立即生效。

### 7.5 Reminder UI

任务：

- 轮询到点提醒。
- 弹出轻量提醒卡。
- 支持完成、稍后提醒、改时间、删除。
- 提醒回复以对话方式写入消息流。

验收：

- 不需要刷新页面即可看到到点提醒。
- 用户处理后 reminder 状态正确更新。

## 8. Prompt 开发拆解

Prompt 统一放在 `vimo-go/prompts/`。

### 8.1 Agent Analyze Prompt

文件建议：

```text
vimo-go/prompts/agent/analyze/
  00-role.md
  05-intention-engine.md
  10-output-schema.md
  15-context-rules.md
  20-classification-rules.md
  30-time-rules.md
  40-confirmation-rules.md
```

任务：

- 明确先判断 recordability。
- 支持主意图和副意图。
- 支持待确认操作上下文。
- 支持配置修改。
- 支持玩笑、质问、纠错不自动沉淀。
- 支持 ASR/拼音/短回复接续。
- 输出严格 JSON。

### 8.2 Diary Prompt（P1）

任务：

- 判断是否有日记价值。
- 生成第一人称草稿。
- 不混入 Vimo 回复。
- 不编造事实。
- 敏感内容保守处理。

### 8.3 Memory Prompt（P2）

任务：

- 按日期、关键词、语义检索候选。
- 只带入少量相关摘要。
- 回复中展示引用来源。
- 不暴露大量原文。

## 9. 阶段计划

### Milestone 0：PRD 对齐和基础整理

- 确认 `docs/vimo-user-prd.md` 是产品基准。
- `docs/mvp-demo-plan.md` 拆成开发任务。
- `AGENTS.md` 写入 PRD 对齐规则。
- 项目命名统一为 Vimo。

### Milestone 1：P0 记录闭环

- Agent 语义帧 schema。
- Prompt 升级。
- Records API 完整 CRUD。
- ChatAgent 执行结构化动作。
- PendingContext 支持记录草稿和操作确认。
- MySQL 持久化。

### Milestone 2：P0 到点提醒

- Reminder 数据模型。
- 明确时间待办自动创建 reminder。
- 前端轮询 due reminders。
- 提醒卡处理完成、稍后、改时间、删除。

### Milestone 3：P0 设置和信任边界

- Settings 数据模型。
- UI 设置。
- 自然语言设置。
- 不自动沉淀玩笑、质问、纠错。
- 用户可以关闭主动提醒相关能力。

### Milestone 4：P1 闲聊日记草稿

- 保存来源对话。
- 日记价值判断。
- 第一人称日记草稿。
- 用户确认、编辑、忽略、删除。
- 闲聊生成日记开关。

### Milestone 5：P1 主动回访

- 用户明确授权后创建 follow_up reminder。
- 回访开关。
- 免打扰时间。
- 回访结果进入待确认日记候选。

### Milestone 6：P2 记忆检索和语音

- 日记关键词、日期、语义检索。
- 记忆增强对话。
- 引用来源展示。
- 语音输入和 ASR。
- PWA 或小组件入口。

## 10. 验收用例

### 10.1 P0 基础记录

| 输入 | 预期 |
| --- | --- |
| 明天下午三点提醒我交周报 | `todo`，有 `datetime_iso`，创建 reminder |
| 这周找时间整理电脑桌面 | `todo`，进入待确认，不强行提醒 |
| 公司 Wi-Fi 密码是 12345678 | `memo`，可保存 |
| 我想到一个语音输入自动变任务卡的点子 | `idea`，可保存 |
| 今天和朋友吃饭挺开心 | 主动记录场景识别为 `journal`，可保存 |

### 10.2 不应自动沉淀

| 输入 | 预期 |
| --- | --- |
| Go 里面 interface 是什么 | `answer_query`，不保存 |
| 我中午吃了点狗屎 | `joke` 或 `do_not_save`，不自动日记 |
| 你为什么擅自记日记了 | 解释和道歉，询问是否删除误记，不更新记录 |
| 我没叫你记 | 不保存，进入纠错/系统行为解释 |

### 10.3 上下文接续

| 对话 | 预期 |
| --- | --- |
| 提醒我吃饭 -> 都可以你定 | 接续同一 pending，补默认时间或继续确认 |
| 删除这条吗？-> 是的 | 删除上一轮确认目标 |
| 算了还是提醒我吃晚饭吧 | 判断为更新/替换原提醒，不默认新增重复记录 |
| shan le ba | 按上下文识别为“删了吧”，不当新记录 |

### 10.4 记录管理

| 操作 | 预期 |
| --- | --- |
| 删除记录 | 普通列表消失，回收站出现 |
| 恢复记录 | 回到原状态 |
| 完成待办 | 状态变为 completed |
| 编辑记录 | 列表和后端一致 |

### 10.5 提醒

| 场景 | 预期 |
| --- | --- |
| 创建 1 分钟后提醒 | 到点出现提醒卡 |
| 点击完成 | 待办 completed，reminder done |
| 点击稍后 | reminder due_at 更新 |
| 修改时间 | record 和 reminder 同步 |

## 11. 测试要求

后端：

- `go test ./...`
- Agent JSON 解析测试。
- Prompt loader 测试。
- Records CRUD 测试。
- Reminder due 查询测试。
- Settings patch 测试。

前端：

- `npm run build`
- Agent 请求 payload 检查。
- PendingContext 状态更新测试。
- 删除、恢复、完成待办流程测试。
- 时间格式展示测试。
- Settings patch 应用测试。

人工回归：

- 跑通 10.1 到 10.5 的验收用例。
- 检查没有业务关键词硬编码。
- 检查 prompt 只在 `vimo-go/prompts/`。

## 12. 风险和约束

### 12.1 用户信任风险

风险：Vimo 擅自记录玩笑、敏感内容或用户质问。

措施：

- 先判断 `recordability`。
- 闲聊日记默认草稿。
- 质问和纠错不沉淀。
- 用户可删除和关闭相关能力。

### 12.2 意图扁平化风险

风险：单一 intent 无法表达复杂对话。

措施：

- 使用主意图、副意图、dialogue_act、recordability、operation。
- 旧 `intent` 只作为兼容字段。

### 12.3 上下文丢失风险

风险：短回复无法接续上一轮确认。

措施：

- open_contexts 保存 pending action。
- 待确认操作和记录草稿都进入 PendingContext。
- 同一任务复用同一 ID。

### 12.4 提醒可靠性风险

风险：浏览器页面关闭后 in-app reminder 不触达。

措施：

- P0 demo 先做页面内提醒。
- P1/P2 接系统通知、服务端调度或 PWA。

### 12.5 范围失控风险

风险：过早做长期记忆、复杂排期、日历同步。

措施：

- P0 只做 PRD 必须项。
- P1 验证聊天日记。
- P2 再做记忆检索和语音。

## 13. 当前实现差距跟踪

| PRD 能力 | 当前状态 | 下一步 |
| --- | --- | --- |
| 自然语言输入 | 已有文本输入 | 保持 |
| AI 自动分类 | 已有基础 intent | 升级语义帧 |
| 四类记录 | 已有 | 补信任边界 |
| 待确认 | 已有弱提醒 | 支持 pending action |
| 编辑、删除、完成 | 基础可用 | 补测试 |
| MySQL 持久化 | 已接入但默认关闭 | 需要时显式 `DB_DRIVER=mysql` 并补运行说明 |
| 到点主动提醒 | 未完整实现 | Milestone 2 |
| 设置 | 部分已有 | 补默认提醒、开关 |
| 闲聊日记草稿 | 未完整实现 | Milestone 4 |
| 记忆检索 | 未实现 | Milestone 6 |
| 语音输入 | 未实现 | Milestone 6 |

## 14. 开发执行规则

- 每个任务开始前对照 `docs/vimo-user-prd.md`。
- 需求变化先确认是否同步 PRD。
- 开发完成后更新 `docs/wiki/` 中相关模块。
- 涉及用户可见行为时补验收用例。
- 不通过关键词、正则、短语表写业务意图。
- 不硬编码 AI 回复。
- Prompt 只集中在 `vimo-go/prompts/`。
- 代码只执行结构化字段，不自行理解用户语义。

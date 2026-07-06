# Conventions

## PRD 对齐

- 每次涉及代码、prompt、配置、交互或数据结构修改前，必须先对照 `docs/vimo-user-prd.md` 的相关内容，确认实现没有偏离 PRD。
- 如果用户提出新增、删除或改变 PRD 中未覆盖的产品行为，必须询问用户是否同步更新 `docs/vimo-user-prd.md`。
- 不要只改代码而让 PRD 落后；最终回复需要说明 PRD 是否已同步，或说明用户未授权同步。

## 配置

- 模型地址、模型 ID、超时和默认采样参数放在 `vimo-go/configs/models.yaml` 或环境变量中。
- OpenAI Compatible `base_url` 可填写服务根地址，也可直接填写到 `/v1`，客户端会统一请求 `/chat/completions`。
- `vimo-go/configs/models.example.yaml` 和 `vimo-go/.env.example` 只提交示例值。
- 不在业务代码中写死真实模型服务地址和模型 ID。
- 公开仓库中的示例模型服务地址只能使用公开占位或本机地址；本地/内网/公司网关地址必须放在未提交的 `vimo-go/.env` 或运行环境变量中。
- 真实模型 API Key 只放本地 `vimo-go/.env` 或运行环境变量，不写入示例配置和业务代码。
- `vimo-go/.env`、`vimo-go/configs/models.yaml`、`vimo-web/node_modules/`、`vimo-web/dist/`、`.playwright-cli/`、`.learnings/` 和 `tmp/` 必须保持 git ignored；上传 GitHub 前先做 secret scan 和 `git check-ignore` 抽查。
- `vimo-web/.env.example` 只提交示例值；真实 `VITE_API_TOKEN` 不提交。
- 多模型通过 `model_key` 热切换；前端从 `GET /api/agent/models` 获取可选项。
- Records API 默认使用内存仓储；只有显式配置 `DB_DRIVER=mysql` 时才使用 MySQL，单独存在 `MYSQL_DSN` 不会自动切换数据库。
- MySQL DSN 示例必须包含 `parseTime=true`，确保 Go 能正确扫描 `DATETIME` 字段。

## API

- 后端 API 使用 `/api` 前缀。
- Agent 接口返回 assistant 消息和 `record_preview`。
- `/api/agent/fast-reply/stream` 是独立快路 SSE 接口，后端用模型 JSON mode 非流式拿完整 `text/route`，再把 `text` 作为 `fast_delta` 发给前端；快路 `fast_done.route=chat_only` 表示纯闲聊可只展示快路回复并跳过慢路，`continue_slow` 才进入慢路。`/api/agent/messages` 是慢路执行接口。`/api/agent/messages/stream` 保留兼容，事件顺序为快路 `fast_delta/fast_done`，必要时再发慢路 `final/done`，错误用 `error`。
- 快路只做即时承接，不执行记录保存、修改、删除或提醒履约；慢路 `final.record_preview` 才能驱动前端执行计划。
- 同一轮快路和慢路请求共享 `turn_id`；慢路请求可以携带 `fast_reply_context`，用于告诉模型快路已经对用户说了什么；慢路回复需要续写同一个助手，不重复快路承接。
- Agent 请求可以携带 `recent_messages`，只用于模型理解短追问和上一句闲聊语境；不得把它变成本地关键词分流。
- Agent `record_preview` 可包含字段级 `field_confidence` 和 `field_risk`；代码只能按这些结构化字段做风险矩阵和 UI 展示，不能回到用户原文关键词判断。
- 记录状态使用 `ready`、`need_confirmation`、`saved`、`discarded`、`completed`。
- 记录时间值使用 `YYYY-MM-DD HH:mm:ss`，例如 `2026-07-01 15:00:00`。
- 软删除记录使用 `status=discarded`，并携带 `deleted_at`、`previous_status`；硬删除只用于 `DELETE /api/records/{id}`。
- 本地默认后端端口是 `8080`；如果端口被占用，可通过 `HTTP_PORT` 覆盖。
- 本地默认后端只监听 `HTTP_HOST=127.0.0.1`；非 `local` 环境或外部可达监听地址必须配置 `REQUIRE_API_TOKEN=true` 和 `API_TOKEN`。
- CORS 通过 `ALLOWED_ORIGINS` 配置白名单，不使用 wildcard origin。
- 前端开发代理默认转发 `/api` 到 `http://localhost:8080`；如果后端改端口，可通过 `VITE_API_PROXY_TARGET` 覆盖。
- 前端 `npm run dev` 默认只本机访问；需要局域网访问时显式加 `--host 0.0.0.0`，并确保后端也配置了 API token。

## Prompt

- 所有模型提示词集中放在 `vimo-go/prompts/`。
- Agent 结构化识别提示词放在 `vimo-go/prompts/agent/analyze/`。
- Agent 快路承接提示词放在 `vimo-go/prompts/agent/fast-reply/`。
- Vimo 运行时 AI skills 放在 `vimo-go/prompts/skills/`；`skills/always/*.md` 会自动拼入 Agent analyze 和 fast-reply prompt。
- Always skills 只能约束通用行为和自然语言字段，不能改变 JSON schema、枚举、字段名、执行协议或 API 合约。
- “说人话”类润色能力属于运行时 skill，不属于 Codex/Claude Code 开发工具 skill；当前精简版为 `vimo-go/prompts/skills/always/00-shuorenhua-natural-language.md`，覆盖聊天回复以及可沉淀 `title/content` 字段。
- 模型不能自行下载或创建可执行 skill；如果需要未加载 skill，应通过结构化 skill need/request 交给后端 registry 判断是否存在、能否启用、是否需要用户授权。
- Runtime skills 自主选择的详细方案见 `docs/wiki/runtime-skills-autonomy-plan.md`；正式实现前必须先同步 `docs/vimo-user-prd.md` 中的 skills 来源、安全检查、授权和隐私边界。
- Prompt 片段使用两位数字前缀控制拼接顺序，例如 `00-role.md`。
- 业务代码只负责加载 prompt 文件，不内联维护大段 prompt 文本。
- 业务代码不得硬编码 AI 回复、确认话术、玩笑边界话术或模型失败兜底话术。
- 模型失败时可以展示普通错误 UI，但不得写入 assistant 消息冒充 AI 回复。
- 用户意图、记录类型、玩笑边界、查询、重复/相近和待确认接续都由模型判断；本地不得用关键词、短语表或正则分流。
- 历史查询后续应走语义/相似度检索，把候选历史记录交给模型判断，不做固定关键词路线。

## 前端

- 当前主页面优先服务 PC 端双栏使用：左侧 Chat Agent，右侧 Records API 记录列表面板。
- 语音按钮仅作为 disabled 占位，不接入真实录音。
- `vimo-web` 的视觉规范以 `docs/wiki/design-system.md` 为准，默认采用 C 端、圆润、轻快、icon 优先的设计语言。

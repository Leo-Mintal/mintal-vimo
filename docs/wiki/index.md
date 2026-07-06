# Mintal Vimo Wiki

## 项目简介

Mintal Vimo / 微默是一个极简 AI 记录 Demo。当前阶段验证文本输入经过大模型结构化理解后，生成待确认或可保存的记录。

## 主要模块索引

- 后端服务：`vimo-go/`
- 前端应用：`vimo-web/`
- MVP Demo 方案：`docs/mvp-demo-plan.md`
- 后端模块说明：`docs/wiki/modules/vimo-go.md`
- 前端模块说明：`docs/wiki/modules/vimo-web.md`
- Agent 实时反馈链路改造方案：`docs/wiki/realtime-agent-feedback-plan.md`
- Runtime Skills 自主选择与安全启用方案：`docs/wiki/runtime-skills-autonomy-plan.md`

## 架构说明入口

- `docs/wiki/architecture.md`

## 开发约定入口

- `docs/wiki/conventions.md`
- `docs/wiki/design-system.md`

## 重要决策入口

- `docs/wiki/decisions.md`

## 最近更新记录

- 2026-07-06：`vimo-go` 统一流事件顺序改为 `fast_thinking -> fast_delta -> slow_thinking -> final -> done`；`vimo-web` 按“快路思考-快路回复-慢路思考-慢路回复”分段即时渲染。
- 2026-07-06：`vimo-web` 思考过程正文改为视觉层逐字渲染：后端仍通过 `fast_thinking` / `final.thinking` 返回完整 reasoning，前端收到后用本地队列流式显示，完成状态仍等待服务端 `done`。
- 2026-07-06：`vimo-web` 发送消息改为只消费后端统一 `POST /api/agent/messages/stream`，成功收尾统一依赖服务端 `done` 事件，快路 `chat_only` 也能结束等待态和思考计时。
- 2026-07-06：移除设置页模型列表中的思考模式入口和模型能力图标；思考开关只保留在输入框内，模型设置页只负责选择模型。
- 2026-07-06：`vimo-web` 思考面板改为耗时状态行：生成中显示“处理中 Ns”，最终回复完成后显示“已处理 Ns”，展开后直接展示 reasoning 正文，不再显示快路/慢路标题。
- 2026-07-06：收紧思考过程展示门控：只有本轮请求明确开启 `thinking.enabled=true` 时，后端才保留 provider reasoning，前端才展示“思考过程”；关闭或未暴露开关时丢弃模型默认 reasoning。
- 2026-07-06：将 `deepseek_v4_flash` 标记为支持思考模式，输入框选择 DeepSeek V4 Flash 时会暴露“思考”开关；关闭不发送 thinking，请求开启才透传 `thinking.enabled=true`。
- 2026-07-06：调整 `vimo-web` 思考过程面板：收到快路/慢路 reasoning 时可展开查看，慢路最终回复输出完成后自动收起，历史消息恢复时默认收起。
- 2026-07-06：修复 `vimo-web` 快路 `chat_only` 闲聊只显示首字的问题：前端区分内部取消慢路和用户手动停止，内部取消不截断快路逐字渲染，用户停止仍会中断整轮生成。
- 2026-07-06：`vimo-web` 主页面改为 Codex-like 三栏工作台：左侧只保留搜索、定时任务和个人资料入口，个人资料进入中间设置页，右侧记录面板按 tab 做分类型预览。
- 2026-07-06：补齐模型思考模式链路：模型配置和自定义模型可声明 `supports_thinking`，输入框按能力显示思考开关，快路/慢路请求会透传 `thinking.enabled` 并展示 provider 返回的 reasoning；刷新成功不再 toast，清空聊天改为二次确认。
- 2026-07-06：新增 `docs/wiki/runtime-skills-autonomy-plan.md`，沉淀未来让 Agent 通过结构化 `skill_request` 请求 runtime skills、由后端 registry 和 Safety Gate 安全启用的方案；当前未改运行时代码，正式实现前需同步 PRD。
- 2026-07-06：重构 `vimo-web` 主聊天界面为开放式 Claude-like 输入体验：模型选择移入输入框，自定义模型缓存到 localStorage，生成中可停止，记录不再支持手动新增，主题跟随系统深浅色。
- 2026-07-04：公开仓库上传前将示例模型地址和 Qwen fallback 默认地址改为公开安全占位/本机地址，避免提交内部服务域名或内网 IP。
- 2026-07-04：Go 模块要求提升到 `go 1.25.11`，用于避开 `govulncheck` 报出的 Go 标准库已修复漏洞；本地旧工具链如需自动下载需启用 Go checksum database。
- 2026-07-04：按当前需求彻底移除独立 model-test / 在线 eval 流程，删除 `vimo-go/cmd/eval`、`vimo-go/internal/agent/eval.go` 和 `vimo-go/internal/agent/evalcases/`，主流程仅保留服务、prompt 和单元测试链路。
- 2026-07-04：`vimo-web` AI 回复设置面板改为紧凑样式，模型列表折叠为下拉选择，风格预设压缩为小型分段按钮，减少弹窗高度。
- 2026-07-04：移除独立模型调试链路：删除对应后端接口、静态页面、agent 调试代码、环境开关和相关使用说明。
- 2026-07-04：完成上传前安全加固：本地真实配置和生成产物补齐 ignore，后端默认仅监听本机、CORS 白名单、外部可达需 API token，前端限制 `closed_contexts` 最多 30 条并校验模型设置 key。
- 2026-07-03：`vimo-web` 通知改为双通道：复制、设置、手动记录操作等即时反馈继续使用顶部短暂 toast；AI/记录处理结果可作为聊天区内联 `notice` 状态行展示，且不进入模型 `recent_messages`。当前普通刷新成功不提示。
- 2026-07-03：快路/慢路 prompt 增加重复闲聊连续性规则；当 `recent_messages` 显示用户重复或高度近似地问同一问题时，模型应自然承认已经答过并保持同一立场，而不是每次重新包装成标准答案。
- 2026-07-03：AI 回复风格预设改为 MBTI-style 英文枚举 `INTJ|ENFJ|ISTP|ENFP|custom`；前端设置面板、快路/慢路 prompt 和 `settings_patch.preset` schema 同步更新，旧 preset 会迁移到最接近的人格风格。
- 2026-07-03：Agent 请求新增 `recent_messages` 最近可见聊天上下文，快路和慢路都可用它理解短追问和上一句闲聊，避免普通聊天被未收口日记/待确认项强行吸走。
- 2026-07-03：快路 prompt 按 `route` 区分回复方式：`chat_only` 必须直接作为最终闲聊/轻问题回答，`continue_slow` 才允许承接和继续处理，避免“我先想一下”成为最终回复。
- 2026-07-03：快路协议输出加固为“完整 JSON mode -> 后端解析 -> 只发 text”，并支持解包误放进 `text` 的协议 JSON；前端慢路改为快路首字/短超时后启动，待确认补时间会从主候选同步到保存字段。
- 2026-07-03：快路新增 `route=chat_only|continue_slow` 路由，并改为模型 JSON mode 非流式返回完整 `text/route`；后端只把 `text` 作为 SSE 文本发给前端，避免协议 JSON 泄漏到 UI。
- 2026-07-03：`vimo-web` 思考中等待态改为无头像、无气泡的“正在思考”文字，并将扫光限制在文字字形内。
- 2026-07-03：`vimo-web` 对话消息、未收口上下文、待确认候选和当前待确认项改为本地缓存持久化；顶部待补全条支持逐条删除上下文，删除后同步清理缓存和 open context。
- 2026-07-03：扩展 Vimo 运行时 `说人话` skill 为自然语言输出润色能力；`skills/always/00-shuorenhua-natural-language.md` 会自动拼入快路和慢路 prompt，覆盖聊天回复与可沉淀 `title/content` 字段，但不改变结构化协议。
- 2026-07-03：新增 `docs/wiki/realtime-agent-feedback-plan.md`，沉淀未来把现有快路/慢路升级为 Codex 风格结构化实时反馈链路的方案，当前未改代码逻辑。
- 2026-07-03：副候选自动执行策略放开为“明确、字段完整且高置信的 `todo|memo|idea` 创建任务可自动执行”；日记、情绪、长期记忆和主动回访仍保守进入草稿或待确认。
- 2026-07-03：前端风险门控改为按当前候选动作应用 hard stop，避免副候选的目标不唯一/删除风险阻断主候选的新建提醒；文档同步记录自动执行阈值。
- 2026-07-03：修复待确认任务上下文注入：顶部 pending 候选现在会随 `open_contexts` 发给模型，并携带 `record_action/target_id/related_ids/execution_plan`；用户确认 pending 删除时复用上一条结构化动作执行，避免“是的”接不上原任务。
- 2026-07-03：`vimo-web` 意图栈面板改为默认收起，并移动到原 AI 意图 badge 位置；单独 `intent` badge 不再显示，用户需要调试时再展开查看主/副意图、候选和 trace。
- 2026-07-03：删除意图改为结构化任务执行边界：唯一目标且高置信的 `record_action=delete` 可直接软删除进回收站，目标不明确或低置信时显示删除确认卡；多动作输入后续按 `record_candidates/execution_plan` 任务队列演进。
- 2026-07-03：模型展示名去掉 API/部署括号说明，`qwen_local` 前端显示为 `Qwen3.5`，内部模型 key 保持不变。
- 2026-07-03：快路/慢路协议补齐同轮 `turn_id` 和 `fast_reply_context` 桥接；快路 prompt 收紧为“情绪承接 + 我来处理具体任务”且禁止完成态，慢路基于快路已展示文本续写真实处理结果，避免重复寒暄或像两个助手接力。
- 2026-07-03：Agent 模型配置默认值改为 `deepseek_v4_flash`，模型展示描述同步为 DeepSeek、GPT、Qwen 顺序；前端会把旧默认 `gpt_5_4_mini` 本地设置迁移到新的后端默认。
- 2026-07-03：`vimo-web` AI 回复展示改为无头像、无气泡的直排文本；用户消息仍保留气泡，AI 回复上方保留意图栈入口。
- 2026-07-03：Agent 新增并行快路/慢路消息链路，前端会同时调用 `/api/agent/fast-reply/stream` 和 `/api/agent/messages`；快路使用集中 prompt 生成即时承接，慢路输出意图栈和 `record_preview`，同一条 AI 回复按 delta 逐字渲染，三个点保持到慢路开始输出后消失。
- 2026-07-02：曾新增 Agent 在线 eval runner 和 19 条首批回归样例；该独立 model-test / 在线 eval 流程已在 2026-07-04 移除。
- 2026-07-02：后端新增结构化 Hard Stop Gate，目标不唯一/低置信修改或删除、模糊提醒时间、主意图隐私日记/长期记忆/主动回访会降为待确认并写入 `intent_trace.gate_reasons`；前端顶部待确认区按状态分组展示并拦截 hard stop 自动执行。
- 2026-07-02：Agent 协议新增轻量 `intent_trace` 和 `pending_state/context_state`，用于记录接续依据、风险/确认门原因、替代解释和未收口状态迁移；前端意图栈面板会展示 trace chips，便于调试意图跑偏。
- 2026-07-02：后端 Records API 默认固定使用内存仓储；只有显式设置 `DB_DRIVER=mysql` 才连接 MySQL，避免本地残留 `MYSQL_DSN` 导致启动失败。
- 2026-07-02：曾新增独立 prompt 调试页和后端调试接口；该调试链路已在 2026-07-04 移除。
- 2026-07-02：强化 Agent 待确认接续规则：未收口项等待提醒时间等高风险字段时，用户补字段的回答优先作为主意图更新 pending；同句情绪只进入副意图/日记草稿，避免把“八点吧，难受”误存为“八点难受”日记。
- 2026-07-02：Agent 协议升级为兼容式意图栈，新增 `primary_intent`、`secondary_intents`、`record_candidates`、`execution_plan` 和 `reply_strategy`；前端会显示本轮识别出的全部意图和多候选卡，副意图默认不自动执行。
- 2026-07-02：Agent 意图系统加入字段级 `field_confidence/field_risk` 和风险矩阵；前端按结构化风险决定自动保存或待确认，并用确认卡采纳/修改行为调整本地阈值。
- 2026-07-02：Agent 模型配置新增 DeepSeek OpenAI Compatible provider：`deepseek_v4_flash` 和 `deepseek_v4_pro`，前端模型设置可热切换。
- 2026-07-02：按 `docs/vimo-user-prd.md` 重写 `docs/mvp-demo-plan.md` 为面向开发的拆解方案，覆盖 P0/P1/P2 范围、数据模型、模块任务、里程碑和验收用例。
- 2026-07-02：新增 PRD 对齐开发约定：改代码、prompt、配置、交互或数据结构前必须对照 `docs/vimo-user-prd.md`；需求变化需询问是否同步 PRD。
- 2026-07-02：修复 Agent 删除已保存记录时误把同 ID 记录当作 pending 草稿导致“说删了但还在”的问题；记录列表时间统一展示为本地 `YYYY-MM-DD HH:mm:ss`。
- 2026-07-02：Agent 新增 `config_update/settings_patch` 配置修改通道，用户可通过自然语言调整全局 AI 设置且不沉淀记录；未收口任务、顶部待确认和最终记录复用同一 id。
- 2026-07-02：OpenAI Compatible 客户端兼容 `base_url` 直接配置到 `/v1`；前端模型选择只使用后端 `GET /api/agent/models` 返回的模型配置。
- 2026-07-02：Agent 模型配置支持 `gpt_5_4_mini`、`gpt_5_5`、`qwen_local`、`deepseek_v4_flash` 和 `deepseek_v4_pro` 热切换；前端 AI 设置可选择模型。
- 2026-07-02：Agent 上下文升级为 `open_contexts` 未收口项和 `closed_contexts` 已收口项分层，澄清追问、模糊补充和局部回答优先由模型接续最近未收口项。
- 2026-07-01：`vimo-web` 每条用户/AI 会话消息下方显示本地发送日期时间，便于截图和追溯。
- 2026-07-01：`vimo-go` Records API 支持可选 MySQL 持久化；当前默认保持内存仓储，只有显式 `DB_DRIVER=mysql` 才连接 MySQL。
- 2026-07-01：`vimo-web` 记录列表从直接写 `localStorage` 改为通过 Records API 读写，旧本地记录会在空库时尝试导入一次。
- 2026-07-01：Agent 待确认时间补充会沿用待确认记录的日期，只替换用户本轮补充的钟点，避免“明天晚上 + 晚上九点”落到今天。
- 2026-07-01：`vimo-web` 删除记录改为软删除进入回收站，可当天恢复；读取本地记录时会清理非当天回收站记录。
- 2026-07-01：Agent 上下文支持 `discarded/deleted_at` 回收站记录，用户反悔删除时模型应恢复目标记录，避免误接续无关待确认草稿。
- 2026-07-01：Agent `content` 规则改为 AI 理解后提炼出的记录正文，不再要求保存用户原文；时间、提醒等结构化字段不重复写入正文。
- 2026-07-01：调整 Agent analyze prompt，保留 Intention Engine、结构化动作协议和禁止关键词规则。
- 2026-07-01：Agent 结果新增 `record_action`/`target_id` 执行动作协议，前端按模型结构化动作创建、更新或删除本地记录，避免续聊修改生成重复记录。
- 2026-07-01：`vimo-web` 待补全信息改为弱提醒，默认不打开弹窗；AI 回复气泡下方可显示补全链接并打开对应弹窗。
- 2026-07-01：新增项目级 `AGENTS.md`，明确禁止本地硬编码意图、固定 AI 回复和散落 prompt，并约定历史查询走语义/相似度检索。
- 2026-07-01：移除后端固定兜底回复、前端失败 assistant 固定消息和快捷输入固定自然语言模板。
- 2026-07-01：移除本地关键词/短语意图分流，Agent 意图统一由模型根据系统提示词和上下文返回，后端仅做结构化归一化。
- 2026-07-01：`vimo-web` 改为高置信 `ready` 结果自动保存，缺失信息进入会话区上方待确认条并通过弹窗编辑确认。
- 2026-07-01：`vimo-web` 曾在每条 AI 回复气泡上方显示后端解析出的 `intent`，方便调试意图理解结果；当前已改为默认收起的意图栈入口。
- 2026-07-01：`vimo-web` 顶部栏、消息气泡、右侧记录面板、记录条目和确认卡补齐显式深色样式，避免残留浅色区域。
- 2026-07-01：Agent analyze 系统提示词移除 Vimo 思考协议，改为固定加载 `Intention Engine` 前置 skill，并整理重复上下文规则。
- 2026-07-01：`vimo-web` 主题 token 切换为深色风格，背景、面板、文字、图标和状态色保持深色背景可见性。
- 2026-07-01：压缩 `vimo-web` PC 会话区、输入区、消息气泡、记录确认卡和右侧记录面板尺寸，提升截图和扫读效率。
- 2026-07-01：新增 Agent 玩笑/不现实输入意图 `joke_response`，明显荒诞提醒只做口语化回复，不生成记录确认卡。
- 2026-07-01：新增 Agent 查询意图 `answer_query` 和 `should_preview=false`，用户询问已有安排时只回复答案，不弹记录确认卡。
- 2026-07-01：修复待确认续聊字段合并，后端保护只补充时间等字段时沿用上一条记录正文，避免把用户补充句写成记录内容。
- 2026-07-01：Agent 消息支持待确认上下文、最近记录和 AI 回复偏好，前端新增 AI 回复设置并支持语义化接续上一条待确认记录。
- 2026-07-01：`vimo-web` 改为 PC 双栏 Chat Agent 工作台，右侧常驻记录面板通过 tab 管理本地 `localStorage` 记录并支持 CRUD。
- 2026-07-01：`vimo-web` 回到功能优先的聊天式 Chat Agent 样式，保留结构化预览、保存确认和记录抽屉作为当前重点。
- 2026-07-01：曾按参考视频尝试游戏化可拖拽沉淀画布，随后回退为功能优先聊天式体验。
- 2026-06-30：提升 `vimo-web` 记录确认卡的数据可视化程度和文字对比度，补充分布统计、字段状态和可读性规范。
- 2026-06-30：沉淀 `vimo-web` C 端可爱圆润设计规范，并按规范重做聊天界面、输入区、消息气泡、记录卡和记录抽屉样式。
- 2026-06-30：优化 `vimo-web` Chat Agent 为 C 端移动端风格，补充快捷意图、复制/重试、记录抽屉、删除记录和轻量确认卡片。
- 2026-06-30：Agent prompt 从代码常量迁移到 `vimo-go/prompts/agent/analyze/`，按 Markdown 片段集中维护。
- 2026-06-30：前端目录更名为 `vimo-web/`，后端目录更名为 `vimo-go/`，同步更新模块引用和启动说明。
- 2026-06-30：记录时间格式改为 `YYYY-MM-DD HH:mm:ss`，后端会归一化 Agent 和 Records 时间值。
- 2026-06-30：落地 Phase 1 文本版 Chat Agent Demo，包含 Go 后端、React 前端、模型配置示例和验证说明。
- 2026-06-30：补充本地后端端口可通过 `HTTP_PORT` 覆盖的约定。
- 2026-06-30：初始化项目 wiki，记录 Phase 1 文本版 Chat Agent Demo 的已确认范围。

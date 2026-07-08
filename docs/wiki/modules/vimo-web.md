# Vimo Web Module

## 当前页面

- `vimo-web/src/pages/ChatPage.tsx`：Phase 1 主页面。

## 主要组件

- `ChatAgent`：管理 Codex-like 三栏工作台、消息流、发送输入、复制/重试消息、清空会话、设置页入口，以及右侧 Records API 记录预览面板。
- `Composer`：底部输入框、内嵌模型选择菜单、思考模式开关、自定义模型弹窗、发送/停止生成按钮；思考开关只在输入框内展示。
- `RecordCard`：展示识别结果，支持编辑、保存、丢弃，使用 icon 优先的轻量确认面板。
- `MobileShell`：页面安全区容器；当前主界面不再用外层最大宽度面板包住，桌面布局由 `ChatAgent` 内部 grid 控制。

## 当前记录行为

- 主页面为 Codex-like 三栏布局：左侧为窄侧边栏，中间是开放式聊天/设置视图，右侧是记录预览面板；顶部 Vimo 栏和 Chat Agent 子栏已移除。
- 左侧侧边栏不展示会话列表，只保留搜索、定时任务入口和底部个人资料入口；点击个人资料会在中间区域进入设置页，右侧记录预览仍常驻。
- 左侧“定时任务”入口会切换到右侧待办 tab 并进入定时任务 scope，仅展示 `need_reminder=true` 的待办；右侧 tab 或搜索会回到普通记录浏览。
- PC 会话区、用户消息气泡、AI 直排回复、输入区和记录确认卡使用简洁克制的中高密度布局，输入框参考 Claude 风格，模型选择放在输入框内部。
- 每条用户消息和 AI 消息下方显示本地发送日期时间，便于追溯会话。
- 发送 Agent 消息时会为本轮生成 `turn_id`，统一调用 `POST /api/agent/messages/stream`；前端消费后端 `progress` 事件渲染消息级处理摘要，并继续兼容 `fast_thinking`、`fast_delta`、`slow_thinking`、`final` 和 `done`。
- AI 消息不再把“快路思考/快路回复/慢路思考/慢路回复”作为硬 UI 顺序；快路和慢路各自显示 Codex-like 的“处理中/已处理 + 耗时”折叠摘要，处理完成后默认折叠，展开后查看对应进度和 reasoning，回复正文保持直接可见。完成态以本地线性渲染完成为准：思考文字先逐字展示，回复文字后逐字展示，最后才把对应摘要标记为“已处理”。
- 快路回复采用前端缓存渲染：收到 `fast_delta` 后先暂存，等待 `fast_done` 再进入同一本地队列，从而保证快路 reasoning 逐字展示完成后才显示快路回复；慢路仍按 `slow_thinking`/`final`/`done` 顺序处理。
- 慢路最终回复如果包含快路已展示文本作为开头，前端只渲染慢路新增部分；完全相同时不重复展示，避免同一条 assistant 消息里出现两段重复承接。
- `POST /api/agent/messages/stream` 由服务端统一编排快路和慢路，前端不再分别启动快路接口和慢路接口；`final` 事件只缓存慢路结果，成功完成只以服务端 `done` 事件为准。
- 前端会消费后端 `record_execution` 事件，把后端已执行的 create/update/delete/restore 结果同步到右侧 Records 列表；同轮主候选若已由后端执行，前端不再重复调用 Records API。
- 快路 `chat_only` 时，服务端会在快路结束后发送 `done`，前端只保留快路闲聊回复，不生成意图栈、记录卡或待确认项；前端同时把 `fast_done` 和 `done` 作为完成态兜底，避免缺失单个 `progress` 事件时处理摘要卡在“处理中”。
- 用户点击停止生成会 abort 当前统一流式请求，并同时中断快路、慢路和本地逐字渲染。
- 快路文字输出期间，`ThinkingBubble` 以无头像、无气泡的“正在思考”文字展示，扫光只裁剪在文字字形内；前端收到服务端 `done` 后才隐藏等待态并恢复输入状态。
- 若当前模型声明 `supports_thinking=true`，输入框会暴露“思考”开关；关闭时前端不发送 `thinking`，开启时会在请求中发送 `thinking.enabled=true`。只有本轮明确开启思考且 provider 实际返回 reasoning 时，AI 消息输出阶段才展示 reasoning；后端通过 `fast_thinking` 和 `slow_thinking` 返回完整 reasoning 字符串，前端收到后用本地队列逐字渲染。旧后端只在 `final.thinking` 返回慢路 reasoning 时，前端仍兼容显示一次。未开启时即使旧后端或模型返回 thinking 事件也会被前端忽略。
- 聊天历史写入 `localStorage` 时不持久化 provider reasoning、thinking 展开状态或 thinking 时间戳；刷新页面后保留可见回复、进度和预览，不恢复 reasoning 正文。
- 慢路 `final` 事件返回后，前端先缓存最终 `message.content` 和 `record_preview`；收到同轮 `done` 后再校准同一条 AI 回复，并处理后端执行结果、候选卡和待确认逻辑。
- 右侧面板通过 tab 切换 `全部`、`待办`、`想法`、`备忘`、`日记`、`确认`、`回收`；`待办`、`想法`、`备忘`、`日记` 在对应 tab 内使用不同预览布局，通用 tab 仍使用统一记录行。
- 记录通过 Records API 读写；后端可配置 MySQL 持久化，未配置时使用内存仓储。
- 浏览器 `localStorage` 的 `vimo-web.records.v1` 只作为旧数据一次性导入来源和记录服务不可用时的本地兜底缓存。
- 右侧记录正文展示后端 `record_preview.content`，该字段应是 AI 提炼后的沉淀内容，不是用户输入原文。
- 右侧记录卡底部时间会把后端 RFC3339 时间归一为本地 `YYYY-MM-DD HH:mm:ss` 展示。
- 记录只支持由模型交互生成；右侧面板保留搜索、编辑、删除/恢复，`todo` 类型支持完成/恢复，不再提供手动新增入口。
- AI 返回 `ready` 且通过字段级风险矩阵时，统一流式主链路由后端自动保存、更新、删除或恢复记录，并发送 `record_execution`；低风险字段允许较低置信最佳猜测，高风险字段低置信会进入待确认。前端手动确认和旧兼容路径仍保留本地执行兜底。
- 前端仍读取 `record_preview.field_confidence/field_risk` 展示 `datetime`、`need_reminder`、`target` 等高风险字段状态；确认卡会展示低置信或高风险字段的轻量标记。
- 后端主链路自动执行不是只看整体置信度：`confidence` 至少 0.65，低风险字段阈值 0.45，高风险字段默认阈值 0.85；前端手动确认仍会记录用户风险反馈，用于兼容路径和后续策略演进。
- 用户在确认卡中保存时，前端会记录高风险字段是否被修改到 `localStorage` 的 `vimo-web.risk-feedback.v1`，用于小幅调整本地自动保存阈值。
- 前端会在每条 AI 回复正文上方提供默认收起的意图栈入口；展开后可查看主意图、副意图和多候选记录。主候选由后端统一执行或进入待确认；副候选仍在前端按现有风险矩阵自动执行或进入候选草稿，日记、情绪、长期记忆和主动回访仍默认进入候选草稿或待确认。
- 意图栈展开后会展示 `intent_trace` 的轻量 trace chips，例如状态迁移、接续原因、风险原因和确认门原因，方便调试；这些 chips 不参与本地意图判断。
- 统一流式主链路由后端按 `record_preview.record_action` 执行记录变更：`create` 新增、`update` 更新 `target_id` 指向记录、`delete` 软删除 `target_id` 指向记录、`none` 只展示回复；前端只消费 `record_execution` 同步结果。手动确认和旧兼容路径仍可按同一协议执行。
- 自动执行前会额外检查结构化 hard stop：`intent_trace.gate_reasons` 中存在 `hard_stop_*` 时按当前候选动作判断是否阻断，避免副候选的删除/修改风险污染主候选的新建提醒；旧模型可能返回的 `hard_stop_delete` 只有在当前动作也是删除时才阻断。
- `delete` 会优先查找已保存记录并调用 Records API 软删除，即使该记录 id 与当前上下文 id 相同，也不能只关闭 pending 草稿；副候选删除可使用唯一 `target_id` 或单个 `related_ids[0]` 作为目标。
- `record_action=delete` 的待确认卡使用删除专用样式：标题显示“删除确认”，主按钮为“确认删除”，内容展示目标记录标题/正文和时间，不再显示普通保存按钮。
- 删除是软删除：记录状态改为 `discarded` 并写入 `deleted_at`、`previous_status`，在回收站 tab 中可恢复。
- 自动执行 `update`/`delete` 前会确认 `target_id` 对应已有记录或当前待确认草稿存在；删除目标唯一且置信高时可直接软删，目标不明确、多个 `related_ids` 或目标置信低时保留为待确认，不静默新增或删除。
- 关闭提醒是一种 `update`：当模型返回 `need_reminder=false` 且目标记录唯一、置信通过风险矩阵时，前端会清理残留的 `missing_fields=["need_reminder"|"datetime"]` 并允许执行；记录仍可保留原时间信息，但不会出现在定时任务 scope。
- 前端兼容执行 `update` 时，如果模型本轮没有返回新的 `datetime_text/datetime_iso`，`previewPatch` 会沿用目标记录已有时间；因此“关闭提醒”只关闭 `need_reminder`，不会把待办时间清空。
- 只有需要补充或确认的信息会进入会话区域上方的弱提醒待补全条，默认不自动打开；顶部待确认区会按 `waiting_field`、`hard_stop_*`、`ready_to_execute` 和草稿候选分组展示；点击弱提醒或 AI 回复气泡下方的补全链接后，用小弹窗编辑、保存或丢弃。
- 前端维护 `open_contexts` 未收口项池；`clarify`、待补全记录、待确认更新和顶部待确认候选都会进入下一轮 `open_contexts`，下一轮模糊/短回复由模型优先判断是否接续最近未收口项。
- 对话消息、`open_contexts`、顶部待确认候选和当前打开的待确认 id 会分别持久化到 `localStorage` 的 `vimo-web.chat-messages.v1`、`vimo-web.open-contexts.v1`、`vimo-web.pending-previews.v1` 和 `vimo-web.active-pending-id.v1`，刷新页面后仍保留本地上下文；缓存恢复时会丢弃结构异常的 preview。
- 通知分为两类：复制、模型设置、清空、编辑/删除/恢复等即时反馈使用顶部短暂 toast；普通刷新成功不再提示。AI 自动保存/更新/删除结果、待确认残留等处理状态可作为聊天区内联 `notice` 状态行展示并随会话持久化。`notice` 只用于本地 UI 反馈，不会进入模型 `recent_messages`。
- 顶部待补全条中的每个上下文都有单独删除按钮，点击后会同时移除对应待确认候选、关闭同 id 的 `open_contexts`，并清理当前打开的待确认 id；右上角“清空聊天”会先弹出二次确认，确认后清空消息和所有本地未收口上下文，不删除已保存记录。
- `open_contexts` 会携带 `pending_state/context_state`，以及待执行任务的 `intent`、`record_action`、`target_id`、`related_ids`、`record_candidates` 和 `execution_plan`，让模型知道未收口项是在等字段、等确认还是等待执行哪个目标。
- 用户确认上一轮待确认任务时，如果模型返回 `confirm_pending/update_pending` 并指向该 pending id，前端会复用上一条 pending preview 的结构化动作执行；删除类确认支持把已确认的多个 `related_ids` 一起软删除。
- 多目标删除待确认项的 pending id 只用于 `context_target_id` 和本地上下文索引，不会回填成记录 `target_id`；确认合并时会保留原 `record_action=delete` 和多条 `related_ids`，避免保存成“删除某记录”的新待办。
- 用户补齐上一轮待确认任务的时间时，前端会把 `update_pending/confirm_pending` 的新字段合并进旧 pending preview；如果新时间只出现在主 `record_candidates[0]`，`normalizePreview` 也会同步回兼容字段，避免保存时丢失 `datetime_text/datetime_iso`。
- 同一个语义任务在 `open_contexts`、顶部待确认条和最终记录中复用同一个 id；确认或自动保存后会同步清理顶部待确认和未收口上下文，避免重复保存。
- 发送 Agent 消息时会附带 `open_contexts`、最多最近 30 条按 `updated_at/created_at` 排序的 `closed_contexts`、最近 6 条可见 `recent_messages` 和本地 AI 回复偏好，让快路模型先做即时承接、慢路模型再判断续聊、查询、重复或相近记录；不再重复发送旧版 `pending_record/recent_records`，也不再把全部已保存记录无界发送给模型。
- `recent_messages` 用于让“你觉得呢？”这类短追问接上上一句闲聊，也用于让重复提问呈现“刚才已经聊过”的连续感，避免未收口日记/待确认上下文把普通聊天强行吸走；前端只传结构化聊天上下文，不按用户原文做关键词判断。
- 如果当前后端仍是旧进程且严格拒绝未知 `recent_messages` 字段，前端会自动移除该字段重试一次，避免页面直接报错；这种兼容重试只能保证可用性，不能提供新后端的闲聊连续性修复效果。
- 用户继续回复时，前端不做关键词判断；是否接续未收口项、确认、修改或作为新记录完全由模型返回的 `intent/context_action` 决定。
- 模型请求失败时前端只显示普通错误 UI，不再写入固定 assistant 话术。
- 输入框上方不再展示快捷类型按钮；新增记录、分类、确认等入口只通过自然语言与模型交互触发。
- AI 回复偏好保存在 `localStorage`，key 为 `vimo-web.agent-settings.v1`，包含模型选择、回复预设、自定义风格、称呼和 `thinking_enabled`；内置预设仍为 `INTJ`、`ENFJ`、`ISTP`、`ENFP` 和 `custom`，旧 preset 会迁移到最接近的 MBTI-style 预设。
- 模型选择入口从独立 AI 设置面板移动到输入框内部；内置模型来自 `GET /api/agent/models`，默认模型由后端配置决定，用户显式选择后每次发送会带上对应 `model_key` 热切换。
- 设置页模型列表只负责选择模型，不展示思考开关或思考能力图标；思考模式通过输入框内开关控制。
- 自定义模型保存在 `localStorage` 的 `vimo-web.custom-models.v1`，字段包含本地 key、显示名称、OpenAI-compatible API URL、API key、模型名称、超时时间和 `supports_thinking`；发送时只在当前请求中透传匹配的 `custom_model` 给后端。
- 消息生成中时，输入框发送按钮切换为停止按钮；点击会 abort 当前快路/慢路请求并停止本地逐字渲染，保留已生成文本并恢复可输入状态。
- Agent 返回 `intent=config_update` 和 `settings_patch` 时，前端更新全局 AI 设置并持久化到 `localStorage`，不展示记录确认卡、不写入沉淀记录；其中 `settings_patch.model_key` 必须命中 `GET /api/agent/models` 返回的模型 key，否则忽略。
- AI 回复消息不显示头像或气泡；正文上方不再单独显示 `record_preview.intent`，只保留默认收起的意图栈入口，用于按需观察后端意图理解结果。
- 右侧确认 tab 按 `status=need_confirmation` 统计和筛选，不再只依赖 `unknown` 类型。
- 当前端收到 `record_preview.should_preview=false`、`intent=answer_query` 或 `intent=joke_response` 时，只展示 AI 回复，不展示记录确认卡。
- 全局主题通过 CSS variables 和 `prefers-color-scheme` 跟随系统深色/浅色变化，主界面、输入框、弹窗、记录面板和消息控件使用同一套语义变量。

## 本地启动

- 前端默认开发端口：`5173`，默认只监听本机，代理 `/api` 到 `http://localhost:8080`。
- 后端端口被占用时，可用 `VITE_API_PROXY_TARGET=http://localhost:<port>` 覆盖代理目标。
- 如果后端开启 `REQUIRE_API_TOKEN=true`，前端联调需配置同值 `VITE_API_TOKEN`，请求会通过 `X-Vimo-Api-Token` 发送。
- 只有确实需要让局域网设备访问前端时才显式使用 `npm run dev -- --host 0.0.0.0`。
- 如果端口被占用，Vite 会自动切到下一个可用端口，以终端输出的 Local URL 为准。
- 当前联调常用端口：前端 `9999`，后端 `8888`。

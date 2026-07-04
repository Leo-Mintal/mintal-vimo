# Vimo Web Module

## 当前页面

- `vimo-web/src/pages/ChatPage.tsx`：Phase 1 主页面。

## 主要组件

- `ChatAgent`：管理消息流、发送输入、复制/重试消息、清空会话，以及右侧 Records API 记录面板。
- `Composer`：底部输入框、发送按钮、四类快捷意图按钮和 disabled 语音占位按钮。
- `RecordCard`：展示识别结果，支持编辑、保存、丢弃，使用 icon 优先的轻量确认面板。
- `MobileShell`：页面安全区和桌面工作台容器，桌面最大宽度为 `1480px`。

## 当前记录行为

- 主页面为 PC 优先的双栏布局：左侧是 Chat Agent，右侧是记录列表面板。
- PC 会话区、用户消息气泡、AI 直排回复、输入区和记录确认卡使用紧凑尺寸，避免截图时单个组件占据过多画面。
- 每条用户消息和 AI 消息下方显示本地发送日期时间，便于追溯会话。
- 发送 Agent 消息时会为本轮生成 `turn_id`，先调用 `POST /api/agent/fast-reply/stream` 负责快路承接；前端收到 `fast_delta` 后立即更新同一条 AI 回复，并在视觉层逐字渲染。
- 前端在快路首字返回或短超时后启动 `POST /api/agent/messages` 慢路执行，慢路请求会携带 `fast_reply_context`，内容是同一 `turn_id` 下已展示或已收到的快路承接文本；慢路结果不会打断快路文字渲染。
- 快路 `fast_done.route=chat_only` 时，前端只保留快路闲聊回复，并中止或丢弃同轮慢路结果，不生成意图栈、记录卡或待确认项。
- 快路文字输出期间，`ThinkingBubble` 以无头像、无气泡的“正在思考”文字展示，扫光只裁剪在文字字形内；`route=chat_only` 时快路完成后立即隐藏等待态，`route=continue_slow` 时慢路 `final` 事件返回并开始输出最终回复首字时才隐藏等待态。
- 慢路 `final` 事件返回后，前端用最终 `message.content` 校准同一条 AI 回复，再执行原有 `record_preview` 自动保存、候选卡和待确认逻辑。
- 右侧面板通过 tab 切换 `全部`、`待办`、`想法`、`备忘`、`日记`、`确认`。
- 记录通过 Records API 读写；后端可配置 MySQL 持久化，未配置时使用内存仓储。
- 浏览器 `localStorage` 的 `vimo-web.records.v1` 只作为旧数据一次性导入来源和记录服务不可用时的本地兜底缓存。
- 右侧记录正文展示后端 `record_preview.content`，该字段应是 AI 提炼后的沉淀内容，不是用户输入原文。
- 右侧记录卡底部时间会把后端 RFC3339 时间归一为本地 `YYYY-MM-DD HH:mm:ss` 展示。
- 支持手动新增、搜索、编辑、删除记录；`todo` 类型支持完成/恢复。
- AI 返回 `ready` 且通过字段级风险矩阵时，前端会自动调用 Records API 保存或更新记录；低风险字段允许较低置信最佳猜测，高风险字段低置信会进入待确认。
- 前端读取 `record_preview.field_confidence/field_risk` 判断 `datetime`、`need_reminder`、`target` 等高风险字段是否可静默执行；确认卡会展示低置信或高风险字段的轻量标记。
- 自动执行不是只看整体置信度：`confidence` 至少 0.65，低风险字段阈值 0.45，高风险字段默认阈值 0.85；用户多次确认且很少修改后可降到 0.78，频繁修改会升到 0.92。
- 用户在确认卡中保存时，前端会记录高风险字段是否被修改到 `localStorage` 的 `vimo-web.risk-feedback.v1`，用于小幅调整本地自动保存阈值。
- 前端会在每条 AI 回复正文上方提供默认收起的意图栈入口；展开后可查看主意图、副意图和多候选记录。主候选沿用现有自动保存/待确认流程；明确、字段完整且高置信的 `todo|memo|idea` 创建型副候选也会按风险矩阵自动执行，日记、情绪、长期记忆和主动回访仍默认进入候选草稿或待确认。
- 意图栈展开后会展示 `intent_trace` 的轻量 trace chips，例如状态迁移、接续原因、风险原因和确认门原因，方便调试；这些 chips 不参与本地意图判断。
- 前端按 `record_preview.record_action` 执行记录变更：`create` 新增、`update` 更新 `target_id` 指向记录、`delete` 软删除 `target_id` 指向记录、`none` 只展示回复。
- 前端自动保存前会额外检查结构化 hard stop：`intent_trace.gate_reasons` 中存在 `hard_stop_*` 时按当前候选动作判断是否阻断，避免副候选的删除/修改风险污染主候选的新建提醒；旧模型可能返回的 `hard_stop_delete` 只有在当前动作也是删除时才阻断。
- `delete` 会优先查找已保存记录并调用 Records API 软删除，即使该记录 id 与当前上下文 id 相同，也不能只关闭 pending 草稿；副候选删除可使用唯一 `target_id` 或单个 `related_ids[0]` 作为目标。
- `record_action=delete` 的待确认卡使用删除专用样式：标题显示“删除确认”，主按钮为“确认删除”，内容展示目标记录标题/正文和时间，不再显示普通保存按钮。
- 删除是软删除：记录状态改为 `discarded` 并写入 `deleted_at`、`previous_status`，在回收站 tab 中可恢复。
- 自动执行 `update`/`delete` 前会确认 `target_id` 对应已有记录或当前待确认草稿存在；删除目标唯一且置信高时可直接软删，目标不明确、多个 `related_ids` 或目标置信低时保留为待确认，不静默新增或删除。
- 只有需要补充或确认的信息会进入会话区域上方的弱提醒待补全条，默认不自动打开；顶部待确认区会按 `waiting_field`、`hard_stop_*`、`ready_to_execute` 和草稿候选分组展示；点击弱提醒或 AI 回复气泡下方的补全链接后，用小弹窗编辑、保存或丢弃。
- 前端维护 `open_contexts` 未收口项池；`clarify`、待补全记录、待确认更新和顶部待确认候选都会进入下一轮 `open_contexts`，下一轮模糊/短回复由模型优先判断是否接续最近未收口项。
- 对话消息、`open_contexts`、顶部待确认候选和当前打开的待确认 id 会分别持久化到 `localStorage` 的 `vimo-web.chat-messages.v1`、`vimo-web.open-contexts.v1`、`vimo-web.pending-previews.v1` 和 `vimo-web.active-pending-id.v1`，刷新页面后仍保留本地上下文；缓存恢复时会丢弃结构异常的 preview。
- 通知分为两类：刷新、复制、设置、清空、手动新增/更新/删除/恢复等即时反馈使用顶部短暂 toast；AI 自动保存/更新/删除结果、待确认残留等处理状态可作为聊天区内联 `notice` 状态行展示并随会话持久化。`notice` 只用于本地 UI 反馈，不会进入模型 `recent_messages`。
- 顶部待补全条中的每个上下文都有单独删除按钮，点击后会同时移除对应待确认候选、关闭同 id 的 `open_contexts`，并清理当前打开的待确认 id；右上角“清空聊天”会清空消息和所有本地未收口上下文。
- `open_contexts` 会携带 `pending_state/context_state`，以及待执行任务的 `intent`、`record_action`、`target_id`、`related_ids`、`record_candidates` 和 `execution_plan`，让模型知道未收口项是在等字段、等确认还是等待执行哪个目标。
- 用户确认上一轮待确认任务时，如果模型返回 `confirm_pending/update_pending` 并指向该 pending id，前端会复用上一条 pending preview 的结构化动作执行；删除类确认支持把已确认的多个 `related_ids` 一起软删除。
- 用户补齐上一轮待确认任务的时间时，前端会把 `update_pending/confirm_pending` 的新字段合并进旧 pending preview；如果新时间只出现在主 `record_candidates[0]`，`normalizePreview` 也会同步回兼容字段，避免保存时丢失 `datetime_text/datetime_iso`。
- 同一个语义任务在 `open_contexts`、顶部待确认条和最终记录中复用同一个 id；确认或自动保存后会同步清理顶部待确认和未收口上下文，避免重复保存。
- 发送 Agent 消息时会附带 `open_contexts`、最多最近 30 条按 `updated_at/created_at` 排序的 `closed_contexts`、最近 6 条可见 `recent_messages` 和本地 AI 回复偏好，让快路模型先做即时承接、慢路模型再判断续聊、查询、重复或相近记录；不再重复发送旧版 `pending_record/recent_records`，也不再把全部已保存记录无界发送给模型。
- `recent_messages` 用于让“你觉得呢？”这类短追问接上上一句闲聊，也用于让重复提问呈现“刚才已经聊过”的连续感，避免未收口日记/待确认上下文把普通聊天强行吸走；前端只传结构化聊天上下文，不按用户原文做关键词判断。
- 如果当前后端仍是旧进程且严格拒绝未知 `recent_messages` 字段，前端会自动移除该字段重试一次，避免页面直接报错；这种兼容重试只能保证可用性，不能提供新后端的闲聊连续性修复效果。
- 用户继续回复时，前端不做关键词判断；是否接续未收口项、确认、修改或作为新记录完全由模型返回的 `intent/context_action` 决定。
- 模型请求失败时前端只显示普通错误 UI，不再写入固定 assistant 话术。
- 快捷类型按钮只作为 UI 入口，不再向输入框注入固定自然语言模板。
- AI 回复偏好保存在 `localStorage`，key 为 `vimo-web.agent-settings.v1`，包含模型选择、回复预设、自定义风格和称呼；内置预设显示为 `INTJ`、`ENFJ`、`ISTP`、`ENFP` 和 `Custom`，旧 preset 会迁移到最接近的 MBTI-style 预设。
- AI 设置面板从 `GET /api/agent/models` 读取模型列表，默认模型由后端配置决定；若本地设置仍是旧默认 `gpt_5_4_mini`，会迁移到新的后端默认；用户显式选择后，每次发送会带上对应 `model_key` 热切换。
- AI 设置面板保持功能优先的紧凑样式：模型列表折叠为下拉选择，只展示当前模型说明；回复风格预设使用小型分段按钮。
- Agent 返回 `intent=config_update` 和 `settings_patch` 时，前端更新全局 AI 设置并持久化到 `localStorage`，不展示记录确认卡、不写入沉淀记录；其中 `settings_patch.model_key` 必须命中 `GET /api/agent/models` 返回的模型 key，否则忽略。
- AI 回复消息不显示头像或气泡；正文上方不再单独显示 `record_preview.intent`，只保留默认收起的意图栈入口，用于按需观察后端意图理解结果。
- 右侧确认 tab 按 `status=need_confirmation` 统计和筛选，不再只依赖 `unknown` 类型。
- 当前端收到 `record_preview.should_preview=false`、`intent=answer_query` 或 `intent=joke_response` 时，只展示 AI 回复，不展示记录确认卡。

## 本地启动

- 前端默认开发端口：`5173`，默认只监听本机，代理 `/api` 到 `http://localhost:8080`。
- 后端端口被占用时，可用 `VITE_API_PROXY_TARGET=http://localhost:<port>` 覆盖代理目标。
- 如果后端开启 `REQUIRE_API_TOKEN=true`，前端联调需配置同值 `VITE_API_TOKEN`，请求会通过 `X-Vimo-Api-Token` 发送。
- 只有确实需要让局域网设备访问前端时才显式使用 `npm run dev -- --host 0.0.0.0`。
- 如果端口被占用，Vite 会自动切到下一个可用端口，以终端输出的 Local URL 为准。
- 当前联调常用端口：前端 `9999`，后端 `8888`。

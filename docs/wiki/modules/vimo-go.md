# Vimo Go Module

## 入口

- `vimo-go/cmd/server/main.go`

## API

- `GET /api/health`
- `GET /api/agent/models`
- `POST /api/agent/fast-reply/stream`
- `POST /api/agent/messages`
- `POST /api/agent/messages/stream`
- `GET /api/records`
- `POST /api/records`
- `PATCH /api/records/{id}`
- `DELETE /api/records/{id}`

## 运行时安全

- `vimo-go/go.mod` 要求 `go 1.25.11`；该版本线用于覆盖 2026-07-04 `govulncheck` 命中的 Go 标准库漏洞。若本机仍是旧 Go 且依赖自动工具链下载，需要确保 Go checksum database 可用。
- 后端默认监听 `HTTP_HOST=127.0.0.1` 和 `HTTP_PORT=8080`，避免本地 Demo 误暴露到局域网或公网。
- 当 `APP_ENV` 不是 `local`，或 `HTTP_HOST` 配置为 `0.0.0.0`、`::`、`[::]` 等外部可达地址时，启动前必须配置 `REQUIRE_API_TOKEN=true` 和非空 `API_TOKEN`，否则服务拒绝启动。
- CORS 默认只允许 `http://localhost:5173` 和 `http://127.0.0.1:5173`，可通过逗号分隔的 `ALLOWED_ORIGINS` 覆盖；后端不再返回 wildcard origin。
- 所有 API 请求体默认限制为 1 MiB；上游模型错误只记录到服务端日志，客户端只收到通用错误，避免泄露 provider 原始诊断。

## Records 持久化

- 默认不配置 `DB_DRIVER` 或配置 `DB_DRIVER=memory` 时，Records API 使用进程内存仓储，重启后数据清空。
- `POST /api/records` 支持可选 `id`，用于把未收口上下文/待确认任务保存为正式记录时复用同一个任务 id；未传时仍由后端生成 `rec_*`。
- 只有显式配置 `DB_DRIVER=mysql` 时，启动才使用 `records.MySQLRepository`，并自动创建 `vimo_records` 表；单独存在 `MYSQL_DSN` 不会触发 MySQL。
- MySQL DSN 需要包含 `parseTime=true`，示例：`vimo:vimo@tcp(127.0.0.1:3306)/vimo?parseTime=true&charset=utf8mb4&loc=Local`。
- 记录模型包含回收站字段 `deleted_at` 和 `previous_status`；前端删除记录时通过 `PATCH status=discarded` 软删除，`DELETE /api/records/{id}` 仍保留硬删除语义。

## 模型调用

- `vimo-go/internal/llm.Provider` 定义统一接口。
- `vimo-go/internal/llm.Provider` 保留非流式 `Chat`；`vimo-go/internal/llm.StreamProvider` 是可选流式接口，用于快路承接输出。
- `vimo-go/internal/llm/qwen.Client` 调用 OpenAI Compatible `/v1/chat/completions`，`base_url` 可配置为服务根地址或已经包含 `/v1` 的 OpenAI 标准地址；快路和慢路协议请求都使用 JSON mode，用户可见的逐字效果由后端/前端解析完整结构化结果后通过业务 SSE 和本地队列展示。
- 未显式配置 `ACTIVE_MODEL_CONFIG` 且默认模型配置文件缺失时，Qwen fallback 默认地址使用本机 `http://127.0.0.1:8001`；真实内网模型网关应通过未提交的本地 env 覆盖。显式配置 `ACTIVE_MODEL_CONFIG` 后，配置加载失败会直接报错，不再静默使用 fallback。
- `vimo-go/internal/agent.ModelRegistry` 根据 `vimo-go/configs/models.yaml` 注册多个模型 provider。
- `vimo-go/internal/agent.Service` 不直接依赖固定模型地址或模型 ID；每次 `POST /api/agent/messages` 和 `POST /api/agent/fast-reply/stream` 可通过 `model_key` 选择模型。
- Agent 请求支持可选 `custom_model`，用于本轮临时构造 OpenAI-compatible provider；后端只校验并使用 `key`、`api_url/base_url`、`api_key`、`model`、`timeout_seconds` 和 `supports_thinking` 调用模型，不持久化该配置，也不把 API key 写入 prompt payload。
- `custom_model.key` 必须与本轮 `model_key` 匹配才会被使用；快路会优先尝试自定义模型，失败后仍可按原有候选顺序尝试服务端默认/内置模型。
- 模型配置可声明 `supports_thinking: true`；只有当前模型或自定义模型声明支持且请求包含 `thinking.enabled=true` 时，`vimo-go/internal/llm/qwen.Client` 才会向 OpenAI-compatible 请求体写入 `enable_thinking: true`。当前 `deepseek_v4_flash` 和 `deepseek_v4_pro` 都声明支持思考模式。
- OpenAI-compatible 响应会兼容读取 `reasoning_content`、`reasoning` 或 `reasoning_text` 作为 reasoning；只有本轮请求实际启用 `thinking.enabled=true` 时，Agent service 才会保留 reasoning 并通过 `thinking.slow`、`record_preview.reasoning` 或快路 `fast_thinking` 暴露给前端，未开启时会丢弃 provider 默认返回的 reasoning。
- `POST /api/agent/fast-reply/stream` 是独立快路 SSE 接口，只读取当前输入、上下文、模型选择、`turn_id` 和 `reply_profile` 生成即时承接文本，不执行任何记录动作。后端用 OpenAI Compatible `response_format={"type":"json_object"}` 非流式请求快路模型拿到完整 `text/route`，思考模式开启且 provider 返回 reasoning 时先发送 `fast_thinking`，再把解析后的 `text` 作为 `fast_delta` 展示给用户，并在 `fast_done.route` 中输出 `continue_slow` 或 `chat_only`。如果模型把协议 JSON 误放进 `text` 字段，后端只做协议解包；坏 JSON 会报错，不把半截 JSON 发到 UI。快路不是 provider 流式 reasoning；思考模式开启后只能在完整快路响应返回时一次性暴露 provider 返回的 reasoning。
- `POST /api/agent/messages` 是慢路执行接口，负责完整 `Analyze`、意图栈、风险门控和 `record_preview`；统一流式接口会在快路判断为 `continue_slow` 后，把同一 `turn_id` 下已展示的快路文本作为 `fast_reply_context` 带入慢路。
- `POST /api/agent/messages/stream` 是前端当前使用的统一 SSE：请求进入后先执行快路 `StreamFastReply`，`route=chat_only` 直接完成，`route=continue_slow` 再执行慢路 `AnalyzeWithHooks`；后端会发送结构化 `progress` 事件，覆盖 `run.started`、`fast_reply.started`、`fast_reply.completed`、`analyze.started`、`model.requested`、`model.completed`、`preview.created`、`action.planned`、`run.completed/run.failed` 等真实代码节点。
- `progress` payload 使用 `id/turn_id/seq/type/title/detail/status/payload/created_at` 结构；这些状态只能来自代码执行节点和模型结构化结果，不根据用户原文关键词判断，也不由模型编造进度。
- `POST /api/agent/messages/stream` 会在慢路 `action.planned` 后，对明确 `ready` 且通过默认风险矩阵的主候选执行 Records 动作；成功后发送 `record.create.completed` / `record.update.completed` / `record.delete.completed` progress，并通过 `record_execution` 事件返回最终 record。需要用户确认、目标不明确、hard stop 或风险不足时不执行，继续交给前端待确认 UI。
- `POST /api/agent/messages/stream` 继续保留旧事件兼容：开启思考时仍可能发送 `fast_thinking`、`fast_delta`、`fast_done`、`slow_thinking`、`final`、`done`。如果 `fast_done.route=chat_only`，接口直接发送 `run.completed` 和 `done`，不再等待慢路结果；否则继续发送慢路 `slow_thinking/final/done`。`done` 是本轮成功完成的统一信号，前端所有成功收尾逻辑都应依赖它；`final` 的 payload 与旧 `/api/agent/messages` 兼容，包含 assistant message、`record_preview` 和旧客户端兼容用的 `thinking`。
- 快路 prompt 位于 `vimo-go/prompts/agent/fast-reply/`，输出完整 JSON object：`text` 是用户可见回复，`route=chat_only` 只用于纯寒暄、普通闲聊、轻问题或不需要结构化处理的自然回应；`chat_only` 的 `text` 必须能作为最终回答成立，不能写成“我先想一下/我来处理”的慢路占位。重复或高度近似的普通闲聊问题应结合 `recent_messages` 承认已经答过并保持同一立场。所有记录、提醒、查询、修改删除、配置、未收口上下文接续或不确定场景都必须 `continue_slow`。快路协议 JSON 不走模型流式输出，避免半截 JSON 泄漏到 UI。
- 默认模型是 `deepseek_v4_flash`；`GET /api/agent/models` 当前按 DeepSeek、GPT、Qwen 顺序返回 `deepseek_v4_flash`、`deepseek_v4_pro`、`gpt_5_4_mini`、`gpt_5_5`、`qwen_local`。
- `GET /api/agent/models` 返回前端可选模型列表，前端可以热切换。
- 2026-07-04 已移除独立 model-test / 在线 eval 流程：`vimo-go/cmd/eval`、`vimo-go/internal/agent/eval.go` 和 `vimo-go/internal/agent/evalcases/` 不再作为项目入口保留。主流程验证改用 Go 单元测试和前端构建/测试。
- `vimo-go/internal/agent.LoadSystemPrompt` 从 `vimo-go/prompts/agent/analyze/` 读取 Markdown prompt 片段并按文件名顺序拼接；`LoadFastReplyPrompt` 以同样方式加载 `vimo-go/prompts/agent/fast-reply/`。
- 两个 prompt loader 都会把 `vimo-go/prompts/skills/always/*.md` 插入到 Agent role 片段之后、任务 prompt 片段之前；当前 `00-shuorenhua-natural-language.md` 用于统一快路、慢路 `reply` 和可沉淀 `title/content` 的中文自然表达约束。
- `vimo-go/prompts/skills/library/` 保存运行时 skills 的项目内来源和扩展参考，不会自动拼进模型上下文。
- 如果模型需要未加载的 runtime skill，应输出结构化 skill need/request，由后端 skill registry 决定是否加载、安装、创建或要求用户授权；模型本身不能自行下载或创建可执行 skill。
- Runtime skills 自主选择与安全启用的未来方案沉淀在 `docs/wiki/runtime-skills-autonomy-plan.md`；当前代码仍只固定加载 `skills/always/*.md`，没有动态 registry 或 Safety Gate。
- 模型回复链路审计和恢复策略见 `docs/wiki/model-reply-pipeline-recovery.md`。
- `vimo-go/prompts/agent/analyze/05-intention-engine.md` 是固定加载的意图分析前置 skill，位于 Role 和 Output Schema 之间，后续记录解析依赖其意图判断。
- Agent analyze prompt 使用按文件名前缀排序的模块化片段；新增规则时优先保持单一职责，避免重复展开。
- `vimo-go/prompts/agent/analyze/15-context-rules.md` 只保留上下文字段、待确认合并和回复风格等必要补充，避免与 `Intention Engine` 重复。

## Agent 上下文

- `POST /api/agent/messages` 支持 `open_contexts`、`closed_contexts`、`recent_messages`、兼容旧字段 `pending_record`、`recent_records`，以及 `reply_profile`。
- `turn_id` 用于标识同一轮输入的快路和慢路请求；`fast_reply_context` 会告诉慢路快路已经说过的即时承接文本，慢路回复必须直接补真实处理结果、确认门或候选说明，不重复快路寒暄、称呼或情绪承接。
- `recent_messages` 是最近可见聊天消息，按时间顺序注入快路和慢路，用于理解短追问、代词、省略句、上一句闲聊语境和重复提问；它只提供对话连续性，不作为本地关键词路由。
- `open_contexts` 是未收口项，按最近优先排序；澄清追问、待补全记录、待确认修改和进行中的任务都进入这一层。
- `closed_contexts` 是已收口项，用于历史查询、闲聊引用、重复/相近、修改/删除目标查找和回收站恢复。
- `pending_record` 是旧版单未收口项，后端会兼容映射为 `open_contexts[0]`。
- `recent_records` 是旧版已收口项，后端会兼容映射为 `closed_contexts`。
- `closed_contexts.status=discarded` 表示回收站记录，并可携带 `deleted_at`；用户反悔删除或要求恢复时，模型应优先返回 `update_record` + `record_action=update` + 对应 `target_id`。
- `reply_profile` 包含回复预设、自定义风格和称呼；内置预设为 MBTI-style 英文枚举 `INTJ|ENFJ|ISTP|ENFP|custom`，由 prompt 解释为回复组织倾向，不用于判断用户人格。正常 AI 回复由模型生成，不在业务代码里硬编码固定话术。
- Agent `title/content` 是模型理解后提炼出的记录文本，用于长期沉淀查看；会按运行时 `说人话` skill 做克制润色，但不直接保存用户原文，不把时间、提醒指令、口语填充、Vimo 回复、玩笑或安慰重复写入正文。若模型仍返回与用户输入完全一致的正文，后端会降级为 `need_confirmation` 并标记缺失 `content`，避免自动保存原文记录。
- Agent 结果可返回 `intent`、`record_action`、`target_id`、`related_ids`、`context_action`、`context_target_id` 和 `should_preview`，用于前端区分新记录、更新记录、删除记录、续聊确认、上下文开闭、重复确认、相近确认、纯查询回答和玩笑/不现实输入。
- Agent 结果可返回 `pending_state/context_state`，表示未收口状态机：`open`、`waiting_field`、`ready_to_execute`、`executed`、`dismissed`、`none`。前端会把状态随 `open_contexts` 注入下一轮模型输入。
- Agent 结果可返回 `intent_trace`，包含 `matched_context_id`、`continuation_reason`、`risk_reasons`、`discarded_alternatives`、`gate_reasons` 和 `state_transition`；该字段用于运行时诊断，不作为业务代码的关键词路由依据。
- Agent 结果可返回 `field_confidence` 和 `field_risk`，分别标注 `type/title/content/datetime/need_reminder/target` 的字段置信度和误判代价；`datetime`、`need_reminder`、`target` 默认属于高风险字段。
- Agent 结果支持兼容式意图栈：`primary_intent` 决定主回复和主执行动作，`secondary_intents` 保留附带但重要的信息，`record_candidates` 承载多张候选记录，`execution_plan` 给出执行建议，`reply_strategy` 描述回复组织方式。
- 后端会从意图栈回填旧字段，也会在旧模型未返回意图栈时从旧字段生成意图栈；明确、字段完整且高置信的 `todo|memo|idea` 创建型副候选可以保留 `auto_execute`，日记、情绪、长期记忆和主动回访等敏感副候选仍会降为 `preview|pending`。
- 后端归一化层包含结构化 hard stop gate：删除、非 pending 的修改/删除目标缺失或不唯一、`field_confidence.target` 低于阈值、需要提醒但没有 `datetime_iso`、主意图是日记/隐私记忆/主动回访时，都会降为 `need_confirmation`，并把 `hard_stop_*` 写入 `intent_trace.gate_reasons`。
- 关闭提醒属于高风险更新但不再一律 hard stop：当 `record_action=update`、`need_reminder=false`、目标唯一且字段置信通过风险矩阵时，归一化会清理残留的 `need_reminder/datetime` 缺失字段并允许后端自动更新；目标缺失、不唯一或低置信仍进入确认。
- 当 `open_contexts` 中的未收口项正在等待高风险字段（如提醒时间）时，用户本轮补字段的内容必须作为主意图 `update_pending`/`confirm_pending`；同句夹带的情绪或日记线索进入副意图，不能和字段答案合并成新记录正文。
- 当 `open_contexts` 中的未收口项本身是 `record_action=delete`，后端归一化会在 `update_pending/confirm_pending` 中沿用该删除动作和 `related_ids`；多目标删除的 pending id 只作为 `context_target_id`，不能被当成真实记录 `target_id`。
- Agent 结果支持 `intent=config_update` 和 `settings_patch`，用于修改 Vimo 自身可配置项；该意图不沉淀记录，必须 `record_action=none`、`should_preview=false`。`settings_patch.preset` 只能使用 `INTJ|ENFJ|ISTP|ENFP|custom`。
- `record_action=create|update|delete|none` 是记录变更结构化协议；统一流式主链路中明确可自动执行的主候选由后端执行，前端手动确认和旧接口兼容路径仍可按该字段执行。`delete` 表示移入回收站，`update` 可更新或恢复 `discarded` 记录；非 pending 的 `update`/`delete` 只有在唯一目标明确时才可补全 `target_id`，目标不唯一必须进入确认。
- `context_action=open|update|close|none` 是前端维护未收口上下文池的结构化协议；代码只按模型返回的结构化字段维护上下文，不根据用户文本做关键词分流。
- 本地后端不再通过关键词、短语或正则判断用户意图；新增、查询、续聊、确认、重复/相近和玩笑边界都由模型根据系统提示词和上下文返回 `intent`。
- 后端归一化层只做结构化处理：JSON 解析、枚举归一化、字段完整性校验、`answer_query`/`joke_response` 不出预览、重复/相近/澄清进入确认态。
- 对 `pending_record` 的续聊只在模型返回 `update_pending` 或 `confirm_pending` 时合并字段，并沿用上一条记录的 `type`、`title`、`content`，避免把补充句写成记录正文。
- 对 `pending_record` 只补充钟点时，后端会沿用待确认记录已有日期语义再合并钟点，避免模型把日期误落到 `now` 当天。
- `joke_response`、查询回答和口语化回复完全由模型生成，业务代码不再做二次话术改写。
- 如果模型返回非 JSON 或缺少 `reply`，后端返回错误，不生成固定兜底回复。

# Output Schema

只返回一个紧凑 JSON 对象，不要 Markdown、代码块、解释或分析过程。

```json
{"type":"todo|journal|memo|idea|unknown","title":"string","content":"string","datetime_text":"string|null","datetime_iso":"YYYY-MM-DD HH:mm:ss|null","need_reminder":false,"confidence":0.0,"field_confidence":{"type":0.0,"title":0.0,"content":0.0,"datetime":0.0,"need_reminder":0.0,"target":0.0},"field_risk":{"type":"low|high","title":"low|high","content":"low|high","datetime":"low|high","need_reminder":"low|high","target":"low|high"},"status":"ready|need_confirmation","missing_fields":[],"reply":"string","intent":"new_record|update_record|delete_record|update_pending|confirm_pending|duplicate_check|similar_check|clarify|answer_query|joke_response|config_update","record_action":"create|update|delete|none","target_id":"record id|null","related_ids":[],"context_action":"open|update|close|none","context_target_id":"context id|null","pending_state":"open|waiting_field|ready_to_execute|executed|dismissed|none","context_state":"open|waiting_field|ready_to_execute|executed|dismissed|none","should_preview":true,"primary_intent":{"id":"intent_primary","intent":"new_record|update_record|delete_record|update_pending|confirm_pending|duplicate_check|similar_check|clarify|answer_query|joke_response|config_update","category":"string","action":"create_record|update_record|delete_record|answer_query|config_update|clarify|none","record_type":"todo|journal|memo|idea|unknown","confidence":0.0,"risk":"low|high","evidence":["string"],"target_id":"record id|null"},"secondary_intents":[{"id":"intent_secondary_1","intent":"new_record|update_record|delete_record|update_pending|confirm_pending|duplicate_check|similar_check|clarify|answer_query|joke_response|config_update","category":"emotion_signal|journal_candidate|idea_candidate|memo_candidate|todo_candidate|context_update|query|other","action":"create_record|update_record|delete_record|answer_query|config_update|clarify|none","record_type":"todo|journal|memo|idea|unknown","confidence":0.0,"risk":"low|high","evidence":["string"],"target_id":"record id|null"}],"record_candidates":[{"id":"candidate_1","intent_id":"intent_primary","type":"todo|journal|memo|idea|unknown","title":"string","content":"string","datetime_text":"string|null","datetime_iso":"YYYY-MM-DD HH:mm:ss|null","need_reminder":false,"confidence":0.0,"field_confidence":{"type":0.0,"title":0.0,"content":0.0,"datetime":0.0,"need_reminder":0.0,"target":0.0},"field_risk":{"type":"low|high","title":"low|high","content":"low|high","datetime":"low|high","need_reminder":"low|high","target":"low|high"},"status":"ready|need_confirmation","missing_fields":[],"record_action":"create|update|delete|none","target_id":"record id|null","related_ids":[],"execution_decision":"auto_execute|preview|pending|ask_clarify|no_op","should_preview":true,"primary":true}],"execution_plan":[{"id":"exec_1","intent_id":"intent_primary","candidate_id":"candidate_1","decision":"auto_execute|preview|pending|ask_clarify|no_op","action":"create|update|delete|none","risk":"low|high","reason":"string","target_id":"record id|null"}],"reply_strategy":{"focus_intent_id":"intent_primary","tone":"concise|warm|confirming","summary":"string","mention_intent_ids":["intent_secondary_1"]},"intent_trace":{"matched_context_id":"context id|null","continuation_reason":"short_token","risk_reasons":["short_token"],"discarded_alternatives":["short_token"],"gate_reasons":["short_token"],"state_transition":"short_token"},"settings_patch":{"preset":"INTJ|ENFJ|ISTP|ENFP|custom","custom_style":"string","nickname":"string","model_key":"string"}}
```

字段规则：

- `type`：记录类型；无法确定用 `unknown`。
- `title`：不超过 24 个中文字符；用于长期回看，要像记录标题，不要像聊天回复、段子或口号。
- `content`：AI 理解后提炼出的记录正文，不要直接照抄用户原话。对于需要保存的记录，`content` 不得与输入 JSON 的 `message` 完全相同；必须去掉时间表达、提醒指令、口语填充、寒暄、调侃、安慰和对话痕迹，只保留可沉淀的信息。可以按“说人话”规则改写为自然、清晰、适合长期查看的中文表达，但不能新增用户没表达的信息。
- `datetime_text`：用户原文时间；没有则 `null`。如果这里有值，`content` 里不要重复该时间表达。
- `datetime_iso`：只有能明确换算到具体时刻才填写，否则 `null`。
- `need_reminder`：只有提醒、待办、计划、到期语义才为 `true`。
- `confidence`：0 到 1。
- `field_confidence`：字段级置信度，0 到 1；只评估当前输出字段是否可靠。
- `field_risk`：字段级误判代价，只能用 `low` 或 `high`；`datetime`、`need_reminder`、`target` 默认高风险，`type/title/content` 默认低风险，除非误判会导致删除、修改、误提醒或编造事实。
- `status`：可直接保存为 `ready`；缺信息、重复/相近、目标不唯一或需用户决定为 `need_confirmation`；`discarded` 只会出现在输入上下文中，表示回收站记录。
- `missing_fields`：只放缺失字段名；没有则 `[]`。
- `reply`：中文口语化，由你根据上下文生成，适合 TTS；不要固定模板、夸张比喻或表演式共情。
- `record_action`：`create` 新增，`update` 更新或恢复 `target_id`，`delete` 把 `target_id` 移入回收站，`none` 只回复。
- `target_id`：`update/delete` 已保存记录时必须填唯一记录 id；无目标则 `null`。
- `related_ids`：重复、相近或目标不唯一时放候选 id；不能替代 `target_id`。
- 删除、修改、恢复等动作本身不是新记录内容；不要把“删除某些记录”“修改某条记录”“恢复某条记录”包装成新的 `todo`/`memo`。如果用户是在确认上一轮删除任务，必须保持 `intent=confirm_pending`、`record_action=delete`，沿用 pending 里的 `related_ids`，不要改成 `create`。
- `context_action`：`open` 新开未收口项，`update` 更新未收口项，`close` 收口未收口项，`none` 不影响上下文池。
- `context_target_id`：当前输入接续某个 `open_contexts` 时必须填对应 id；新开未收口项时可为 `null`。
- `pending_state/context_state`：未收口状态；只能用 `open`、`waiting_field`、`ready_to_execute`、`executed`、`dismissed`、`none`。缺字段等待用户时用 `waiting_field`，可自动执行或等待代码执行时用 `ready_to_execute`，纯回复用 `none`。
- `should_preview`：查询和玩笑必须 `false`；需要记录变更或确认时为 `true`。
- `primary_intent`：本轮主要目标，必须填写；旧字段必须与它保持一致。
- `secondary_intents`：附带但重要的意图；默认不能自动执行，除非用户明确要求且低风险。
- `record_candidates`：候选记录数组；每个候选必须绑定 `intent_id`，主候选 `primary=true`。候选里的 `title/content` 也必须按“说人话”的长期沉淀规则润色，但不能改动候选结构、类型、时间、提醒和目标字段。
- `execution_plan`：每个候选的执行建议；模型建议会被代码层风险门控二次校验。
- `reply_strategy`：回复组织方式；主回复聚焦 `focus_intent_id`，副意图只轻量提及。
- `intent_trace`：运行时诊断用结构化短标签，不是自然语言推理；记录接续的上下文、风险原因、被放弃的替代解释、确认门原因和状态迁移。
- `settings_patch`：只有 `intent=config_update` 时填写要修改的设置字段；不修改的字段不要放入对象。可配置项包括 `preset`、`custom_style`、`nickname`、`model_key`。配置修改不沉淀记录，必须 `record_action=none`、`context_action=none`、`should_preview=false`。

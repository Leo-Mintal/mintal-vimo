# Intention Engine

来源：`https://clawhub.ai/mouserider/skills/intention-engine`

这是 Vimo 每次处理用户输入前必须先执行的意图推断技能。先理解用户真正想达成什么，再决定记录动作；不要只按字面创建记录。

## 核心流程

1. 判断用户本轮主要目标，必须形成一个 `primary_intent`。
2. 判断当前输入是否接续、修正、确认或关闭 `open_contexts`。
3. 找出可能需要保留的 `secondary_intents`，但副意图默认不能自动执行。
4. 为每个意图绑定 `evidence`，证据必须来自用户输入、上下文或历史记录。
5. 为每个候选记录绑定 `intent_id`，写入 `record_candidates`。
6. 判断每个候选记录的 `execution_decision`：`auto_execute|preview|pending|ask_clarify|no_op`。
7. 高风险低置信进入待确认；删除、修改、提醒时间、目标记录属于高风险。
8. 生成 `reply_strategy`，主回复聚焦 `primary_intent`，副意图只轻量提及。
9. 生成 `intent_trace`，只写结构化短标签，记录接续依据、风险原因、被放弃的主要替代解释和状态迁移；不要写长推理。
10. 对创建、修改、删除先做失败预演：最容易失败的是误把查询/玩笑/补充当新增，或找错已有记录。
11. 输出只落到 JSON schema，不输出分析过程。

## Vimo 意图落地规则

`intent` 只能取：

- `answer_query`：寒暄、普通聊天、能力询问、已有记录查询；`record_action=none`，`should_preview=false`。
- `config_update`：修改 Vimo 自身可配置项；`record_action=none`，`context_action=none`，`should_preview=false`，变更放入 `settings_patch`。
- `new_record`：新增任务、提醒、备忘、日记或想法。
- `update_record`：修改一条已保存记录。
- `delete_record`：取消或删除一条已保存记录。
- `update_pending`：补充或修改上一条待确认记录。
- `confirm_pending`：确认上一条待确认记录可保存。
- `duplicate_check`：与已有记录重复，需要用户确认。
- `similar_check`：与已有记录相近，需要用户确认。
- `clarify`：信息不足，需要继续问用户。
- `joke_response`：明显不符合现实规则、恶搞或玩笑；`record_action=none`，`should_preview=false`。

特别规则：

- 每轮必须有且只有一个 `primary_intent`；旧字段 `intent/type/record_action/status` 必须与主意图和主候选保持兼容。
- 可以有多个 `secondary_intents`，用于保留情绪、日记价值、想法、长期记忆线索、主动回访线索或附带任务。
- `primary_intent` 决定主要回复和主要执行动作；`secondary_intents` 不喧宾夺主，但明确、低风险或高置信的 `todo|memo|idea` 创建候选可以 `auto_execute`，日记、情绪、长期记忆和主动回访仍默认只能 `preview`、`pending` 或 `no_op`。
- 同一句包含多个明确任务/提醒时，不要合并成一条记录；必须为每个任务/提醒建立独立 `record_candidates`。主候选对应本轮最主要任务，其余任务可以作为副候选，默认不高过主候选。
- 日记、情绪、长期记忆、主动回访默认更保守；除非用户明确要求保存，否则只生成候选草稿或轻量提示。
- `recent_messages` 是最近聊天语境，短追问、代词、省略句和“你怎么看/你觉得呢”这类承接必须结合它判断；上一句是闲聊时，下一句通常仍是闲聊，除非明确转向记录、提醒、查询、修改、删除或补字段。
- 如果当前普通闲聊问题与 `recent_messages` 中的用户问题重复或高度相近，主意图仍然是 `answer_query`，但回复不要当成第一次回答；要自然承认已经答过，并在相同立场上轻微推进或调侃，除非用户要求重新解释。
- `open_contexts` 是未收口项：包括正在补信息的记录、上一轮澄清问题、正在进行的任务规划、待确认修改/删除等。存在未收口项时，要判断用户当前输入是否在回答、补充、修正或确认其中某项；但 `open_contexts` 不是强制路由，不能覆盖明显接续 `recent_messages` 的普通闲聊。
- 如果最近的 `open_contexts` 正在等待高风险缺失字段（尤其 `datetime`、`need_reminder` 或目标记录），而用户本轮给出可用于补齐该字段的内容，即使同一句还夹带情绪、感受、寒暄或补充说明，`primary_intent` 也必须是 `update_pending` 或 `confirm_pending`，并把 `context_target_id` 指向该未收口项。
- 普通观点闲聊、轻问题、反问或追问 AI 看法，没有明确保存/记录/日记/提醒/补字段目标时，主意图应是 `answer_query`，不创建记录候选，不打开或更新上下文。
- 补字段回答中夹带的情绪或经历只能进入 `secondary_intents`，例如 `emotion_signal` 或 `journal_candidate`；不要把字段答案和情绪片段拼成新的日记、备忘或待办正文。
- `closed_contexts` 是已收口项：已保存记录、已完成记录、回收站记录和历史沉淀。用于闲聊引用、查询、重复/相近判断、修改/删除目标查找。
- `pending_record` 是旧版单未收口项，语义等同 `open_contexts[0]`；`recent_records` 是旧版已收口项，语义等同 `closed_contexts`。
- `recent_records` 或 `closed_contexts` 存在时，必须检查查询、重复、相近、修改、删除和恢复意图。
- `recent_records.status=discarded` 表示记录在回收站，还没有永久删除；如果用户表达反悔、恢复、还是要做、刚才删错了等语义，应优先判断是否恢复这条回收站记录，返回 `intent=update_record`、`record_action=update`、`target_id` 指向该记录，不要创建新记录。
- 恢复回收站记录时，默认沿用原记录的 `type/title/content/datetime_text/datetime_iso/need_reminder`，除非用户明确修改某个字段；不要因为当前短回复里的语气词改标题或时间。
- 当未收口项和已收口项同时存在时，不要机械优先某一层；必须判断当前输入真正指向哪一个上下文。用户在反悔刚删除的记录时，优先处理已收口层中的 `discarded` 记录。
- 修改或删除已保存记录时，必须选唯一目标，返回 `record_action=update/delete` 和对应 `target_id`；目标不唯一时 `status=need_confirmation`，候选放 `related_ids`。
- 补充未收口记录时返回 `intent=update_pending|confirm_pending`、`record_action=update`、`target_id/context_target_id` 指向该未收口项；能安全补齐则 `status=ready`，否则继续作为未收口项。
- 隐式修正、撤销、局部替换和短回复必须先判断是否指向 `open_contexts`；如果指向未收口记录，只输出结构化的 `update_pending`、`confirm_pending` 或相应动作，不把当前短句当作新记录正文。
- 接续未收口项时，主候选必须沿用未收口项的 `type/title/content/need_reminder`，只更新用户本轮明确补充的字段；例如原任务在等提醒时间，本轮只补钟点时，主候选正文仍是原任务，不要写成本轮短句。
- 当同一句既完成未收口项又表达情绪时，`reply_strategy.focus_intent_id` 必须指向主意图，同时 `mention_intent_ids` 放入情绪副意图；`reply` 需要自然回应情绪，再确认主任务已如何处理，必要时轻量提及日记草稿确认入口。
- `pending_state/context_state` 表示未收口状态，只能用 `open|waiting_field|ready_to_execute|executed|dismissed|none`；缺字段等待用户时用 `waiting_field`，可执行但还未由代码执行时用 `ready_to_execute`。
- `intent_trace` 用于运行时诊断：`matched_context_id` 指向接续的上下文，`continuation_reason` 如 `answering_missing_datetime`，`risk_reasons` 如 `datetime_high_risk`，`discarded_alternatives` 如 `journal_as_primary`，`gate_reasons` 如 `missing_datetime`，`state_transition` 如 `open->ready_to_execute`。
- `clarify` 不是结束：如果你追问用户，必须把当前任务/记录作为未收口语义继续维护，下一轮用户回答应优先接回这个上下文。
- 用户让 Vimo 自行决定且风险低时，选择合理默认值，不要反复追问；如果仍不确定，说明缺口并继续维护未收口项。
- 不允许依赖固定关键词。必须基于语义、上下文、历史记录和当前目标判断。

# Risk Decision Matrix

用字段风险决定是否打扰用户，而不是只看全局 `confidence`。

- 低风险字段高置信：`status=ready`，可静默执行。
- 低风险字段低置信：输出最佳猜测和可编辑字段，通常不要追问；如果整体内容仍可沉淀，可保持 `ready`。
- 高风险字段高置信：可 `ready`，但必须给出对应 `field_risk=high`，让 UI 做轻量视觉标记。
- 高风险字段低置信：`status=need_confirmation`，`missing_fields` 放对应字段，用确认卡让用户点选或编辑，不要用对话追问打断。

高风险字段包括：`datetime`、`need_reminder`、`target`，以及任何会造成误删、误改、误提醒、隐私误沉淀或编造事实的字段。

## Hard Stop Gate

以下动作即使模型整体置信度高，也不能直接 `auto_execute`，必须进入 `pending|ask_clarify` 并在 `intent_trace.gate_reasons` 写入对应短标签：

- 修改或删除目标不唯一、没有唯一 `target_id` 或 `related_ids` 多于 1 个：`hard_stop_target_not_unique`。
- 需要提醒但没有可执行的 `datetime_iso`：`hard_stop_ambiguous_reminder_time`。
- 修改提醒开关、取消提醒或把提醒改成不提醒：`hard_stop_need_reminder_change`。
- 主意图是日记、隐私情绪沉淀、长期记忆或主动回访：`hard_stop_sensitive_memory`。

注意：同一句里的情绪、日记或长期记忆线索如果只是 `secondary_intents`，不能阻断主待办/备忘的自动执行；它们自己只能作为候选草稿或待确认项。

如果 `intent=delete_record` 且目标唯一、`target_id` 明确、目标字段置信度高，可以 `auto_execute`，由代码层执行软删除并保留回收站恢复能力；目标不唯一或目标置信不足时必须 `status=need_confirmation`，候选放 `related_ids`。

如果 `intent=update_record` 且目标不唯一，必须 `status=need_confirmation`，候选放 `related_ids`。

如果 `intent=update_pending|confirm_pending` 且只是修正未收口记录的低风险字段，可以直接更新未收口项；若会改变提醒时间、提醒开关或目标记录，按高风险字段处理。

当用户正在回答未收口项缺失的高风险字段时，字段答案的优先级高于同句里的情绪或日记线索；只要字段答案置信度足够高，主候选可以 `auto_execute` 更新该未收口项，情绪/日记副候选仍按保守策略 `preview|pending|no_op`。

`execution_plan` 必须遵守：

- `auto_execute` 只给主意图的低风险或高置信候选。
- `secondary_intents` 不是一律禁止自动执行：明确、低风险或高置信的 `todo|memo|idea` 创建候选可以 `auto_execute`，但必须各自通过字段风险判断。
- 日记、情绪、长期记忆、主动回访默认 `preview|pending`，不能自动保存。
- 修改、提醒时间、目标记录不明确时必须 `pending|ask_clarify`；删除只有在目标唯一且置信高时才能 `auto_execute`，否则也必须 `pending|ask_clarify`。
- 模糊时间不能 `auto_execute` 提醒。
- `intent_trace.gate_reasons` 必须写入触发确认门的短标签，例如 `missing_datetime`、`target_not_unique`、`privacy_journal`、`active_followup_requires_consent`，以及上面的 `hard_stop_*` 标签。

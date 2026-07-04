# Classification Rules

- `todo`：行动、提醒、计划、安排、未来要做或希望被提醒的事。
- `journal`：已发生经历、感受、复盘、情绪记录。
- `memo`：事实性备忘，如资料、地址、账号、链接、流程。
- `idea`：灵感、创意、方案、产品点子、尚未执行的可能性。
- `unknown`：分类不确定、内容过短或多类型无法判断；此时 `status=need_confirmation`。

如果用户明确希望保存但四类边界不清，且内容保存成备忘不会造成提醒、删除、修改或事实编造风险，可以把 `type` 作为最佳猜测降级为 `memo`，同时把 `field_confidence.type` 调低、`field_risk.type=low`，由 UI 高亮可编辑；不要只因为分类不确定就拒绝记录。

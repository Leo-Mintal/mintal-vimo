# Model Reply Pipeline Recovery

## 背景

- 2026-07-07 按实际代码审计模型回复链路：前端发送统一 SSE 请求，后端先快路再慢路，最终由前端合并为同一条 assistant 消息。
- 本页记录本次发现的问题、已恢复项和后续恢复策略；代码和测试仍是事实来源。

## 已恢复

- 慢路 `Analyze` 请求也使用 OpenAI-compatible `response_format={"type":"json_object"}`，降低模型输出非 JSON 导致整轮失败的概率。
- 显式配置 `ACTIVE_MODEL_CONFIG` 时，如果模型配置文件缺失或解析失败，后端启动加载会返回错误；只有未显式配置时才使用本机 fallback。
- 前端持久化聊天历史时不再写入 provider reasoning、thinking 展开状态和 thinking 时间戳；reasoning 只保留在当前页面会话内展示。
- 慢路最终回复如果以快路已展示文本开头，前端只展示慢路新增部分；如果完全相同则不重复展示。
- 待确认删除任务接续时，后端会优先沿用 pending 上的 `record_action=delete`、`related_ids` 和 `context_target_id`；即使模型在 `confirm_pending` 或主候选里误写 `create`，也不会把“删除记录”保存成新的待办。
- 多目标删除确认只把 pending id 当作上下文 id，不再把它回填为记录 `target_id`；前端确认路径会批量软删除已确认的多个 `related_ids`。

## 保留现状

- 快路仍使用非流式 JSON mode 一次性拿到 `text/route`，再通过业务 SSE 做视觉逐字渲染；这是为了避免协议 JSON 半截泄漏到 UI。
- 统一流式主链路中，主候选自动执行由后端负责；前端仍保留手动确认、旧接口兼容和副候选处理所需的风险矩阵。
- 后端对 pending 只补钟点的日期合并仍有少量中文时间锚点处理；这属于确定性时间归一化，不用于判断用户意图或生成 AI 回复。后续若扩展更多自然语言时间，应优先通过模型结构化字段或专门时间解析模块收敛。

## 后续建议

- 如果要真正做到 provider 级流式回复，应拆分用户可见自然语言流和结构化 JSON 协议，不能直接流式输出协议 JSON。
- 前端副候选自动执行和风险反馈后续应逐步迁到后端，减少前后端策略漂移；前端只保留展示、编辑和手动确认。
- 如果继续展示 reasoning，应提供更明确的产品说明或开关提示，并默认不持久化。
- 模型配置错误应在部署和本地联调日志里显性暴露，避免误用 fallback 模型。
- 继续把“模型输出动作”和“上下文任务 id / 真实记录 id”的边界作为回归重点；尤其是 `confirm_pending`、多目标 `related_ids` 和旧缓存恢复路径。

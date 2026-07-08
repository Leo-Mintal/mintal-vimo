# Agent 实时反馈链路改造方案

## 背景

当前 Vimo 已实现统一 SSE 快路/慢路消息链路：

- 前端主链路统一调用 `POST /api/agent/messages/stream`。
- 快路通过兼容事件输出 `fast_thinking`、`fast_delta`、`fast_done`，前端把解析后的 AI 文本逐字渲染出来。
- 慢路通过同一个 SSE 输出 `slow_thinking`、`final`、`done`，负责完整意图栈、候选记录、风险门控和执行计划。
- 后端已开始输出结构化 `progress` 事件，用于展示真实代码节点，例如 `run.started`、`analyze.started`、`model.requested`、`preview.created`、`action.planned` 和 `run.completed`。

这个方案用于后续把当前体验升级成类似 Codex 的实时反馈链路：不仅流式展示 AI 文本，也实时展示本轮 Agent 正在做什么、做到了哪一步、是否需要确认或已经完成执行。

本方案记录目标链路和分阶段路线；第一阶段的统一 SSE 与基础 `progress` 事件已经落地，后续重点是事件可靠性和执行链路后移。

## 现状边界

已具备的能力：

- `vimo-go/internal/http/handlers.go` 已提供快路 SSE 和兼容式消息 SSE。
- `vimo-go/internal/agent.Service.Analyze` 已完成慢路结构化分析。
- `vimo-go/internal/agent.Service.StreamFastReply` 已完成快路承接流式输出。
- `vimo-web/src/services/agent.ts` 已有 SSE 读取和解析逻辑。
- `vimo-web/src/components/ChatAgent/ChatAgent.tsx` 已有快路逐字渲染、慢路最终回复校准、自动保存/待确认处理。

当前缺口：

- 第一阶段已经具备基础 `progress` 事件，但事件类型、payload 和 UI 仍较轻量，还不是完整 run 观测模型。
- 前端可以展示“正在分析意图”“已生成候选”“进入待确认/计划自动保存/已执行记录动作”等真实过程；统一流式主链路的主候选自动保存、更新、删除已由后端执行并通过 `record_execution` 返回结果。
- 没有事件持久化和断线补拉。
- 副候选自动执行、待确认后的手动确认和旧兼容路径仍由前端调用 Records API；这些动作尚未完全进入统一 Agent 事件流。

## 目标体验

目标不是增加冗长日志，而是在每条 AI 回复旁边显示轻量、可信的处理进度。

示例一：可自动保存

```text
用户：明天九点提醒我开会

Vimo：
我先帮你整理成提醒，马上确认时间和事项。

✓ 已接住输入
✓ 正在分析意图
✓ 已生成待办候选
✓ 已自动保存

已为你整理成明天 09:00 的提醒。
[记录卡]
```

示例二：进入待确认

```text
用户：晚上提醒我洗衣服

Vimo：
我先帮你整理提醒，需要确认一下具体时间。

✓ 已接住输入
✓ 正在分析意图
! 时间不够明确，进入待确认

我还差一个具体时间，确认后就能保存。
[待确认卡]
```

示例三：只回复不保存

```text
用户：我明天有什么安排？

Vimo：
我来帮你看一下已保存的安排。

✓ 已接住输入
✓ 正在检索上下文
✓ 已生成回复

你明天有两件事：上午交材料，下午给客户回电话。
```

## 设计原则

- 真实事件优先：文件、模型调用、候选生成、保存结果等状态必须由代码真实产生，不让模型事后编进度。
- 不做本地关键词意图判断：前端和后端业务代码只消费模型返回的结构化字段，不根据用户原文做关键词、正则或短语分流。
- 保持快路/慢路边界：快路只做即时承接，不能声称完成；慢路负责真实识别、风险门控和执行准备。
- 保持兼容：已有 `/api/agent/messages` 和 `/api/agent/fast-reply/stream` 先保留，主链路逐步迁移到 `/api/agent/messages/stream`。
- 先轻后重：当前已经迁移统一流式主链路的主候选 Records 动作；后续再迁移副候选、手动确认和事件持久化。

## 事件模型

建议新增统一事件结构：

```ts
type AgentProgressEvent = {
  id: string;
  turn_id: string;
  seq: number;
  type: string;
  title: string;
  detail?: string;
  status: 'running' | 'completed' | 'warning' | 'failed';
  payload?: unknown;
  created_at: string;
};
```

建议第一阶段支持的事件类型：

```text
run.started
fast_reply.started
assistant.delta
fast_reply.completed
analyze.started
model.requested
model.completed
preview.created
action.planned
final
run.completed
run.failed
```

事件含义：

- `run.started`：后端收到本轮请求。
- `fast_reply.started`：快路开始生成即时承接。
- `assistant.delta`：快路文本增量。
- `fast_reply.completed`：快路完成或没有可见增量。
- `analyze.started`：慢路开始完整结构化分析。
- `model.requested`：慢路模型请求已发出。
- `model.completed`：慢路模型返回，准备解析结构化 JSON。
- `preview.created`：已得到归一化后的 `record_preview`。
- `action.planned`：根据 `record_preview` 判断本轮是自动执行、待确认、只回复或失败。
- `final`：兼容现有最终响应，包含 `message` 和 `record_preview`。
- `run.completed`：本轮完成。
- `run.failed`：本轮失败。

## 后端改造建议

第一阶段主改 `POST /api/agent/messages/stream`。当前已落地基础版本，后续可以继续扩展事件 payload 和可靠性。

建议做法：

1. 在 `vimo-go/internal/agent/` 新增事件类型定义，例如 `events.go`。
2. 在 `AgentMessageStream` 中创建带 `turn_id` 和递增 `seq` 的事件 writer。
3. 保留当前 `fast_delta/final/done` 的兼容能力，或同时输出新事件和旧事件。
4. 在慢路关键节点发事件：
   - 进入请求：`run.started`
   - 启动快路：`fast_reply.started`
   - 启动慢路：`analyze.started`
   - 调用模型前：`model.requested`
   - 模型返回后：`model.completed`
   - `normalizeResultWithTime` 完成后：`preview.created`
   - 根据 `record_preview` 得出执行建议后：`action.planned`
   - 写出最终响应：`final`
   - 完成：`run.completed`

注意：

- `model.requested/model.completed` 只表示慢路模型调用状态，不暴露完整 prompt 或敏感上下文。
- `preview.created/action.planned` 可以放简短摘要，例如 `待办候选已生成`、`时间不明确，进入待确认`。
- 摘要文案属于 UI/状态文案，可以硬编码；但不能根据用户原文做业务意图判断。
- 模型失败时只发错误事件并展示普通错误 UI，不写入 assistant 消息冒充模型回复。

## 前端改造建议

第一阶段把 ChatAgent 主链路改为单 SSE。当前主链路已经完成：

- 当前：只调用 `sendAgentMessageStream(request)`。
- 前端新增消息级 `progressEvents`，消费统一 `progress` 事件并渲染工作流时间线。
- 兼容旧文本事件：`fast_thinking`、`fast_delta`、`slow_thinking`、`final`、`done`。

建议调整点：

1. 扩展 `vimo-web/src/types/agent.ts` 的 `AgentStreamEvent`。
2. 扩展 `vimo-web/src/services/agent.ts` 的 `parseSSEEvent`。
3. 给 `Message` 增加可选 `events?: AgentProgressEvent[]`。
4. 新增 `AgentProgressTimeline` 组件，显示每条 assistant 消息的进度。
5. `assistant.delta` 继续追加到当前 assistant 消息正文。
6. `final` 到达后沿用现有逻辑：
   - 用最终 `message.content` 校准当前 AI 回复。
   - 归一化 `record_preview`。
   - 消费 `record_execution` 同步后端执行结果，并处理候选卡、待确认逻辑。
7. `run.failed` 或 `error` 到达时，只展示普通错误状态，不追加固定 assistant 文案。

进度 UI 建议：

- 默认展示最近 3 到 5 个步骤。
- 已完成步骤用轻量 check 状态。
- `warning` 用于待确认、hard stop、低置信字段等。
- `failed` 只展示错误摘要，不展示内部堆栈。
- 调试模式下可以展开查看完整事件 payload。

## 分阶段路线

### 第一阶段：可见实时过程

范围：

- 增强 `/api/agent/messages/stream`。
- 前端主链路切到单 SSE。
- 增加消息级进度时间线。
- 不做事件持久化。
- 统一流式主链路的主候选 Records 动作迁移到后端，副候选和待确认动作暂不迁移。

收益：

- 用户能实时看到 Vimo 正在处理，而不是只等最终结果。
- 复用现有快路、慢路和记录执行逻辑，风险最小。

### 第二阶段：事件可靠性

范围：

- 增加后端事件日志，按 `turn_id + seq` 记录。
- 新增补拉接口，例如 `GET /api/agent/runs/{turn_id}/events?after_seq=12`。
- 前端断线、刷新或 SSE 中断后可以补齐漏掉的事件。

收益：

- 避免只靠内存 SSE 导致漏事件。
- 为回放、排查和调试提供基础。

### 第三阶段：完整统一执行链路

范围：

- 已迁移统一流式主链路的主候选自动保存、更新、删除；后续将副候选、待确认确认后的执行和更多 Records 动作逐步迁到后端统一执行。
- 事件流新增：
  - `record.create.started`
  - `record.create.completed`
  - `record.update.started`
  - `record.update.completed`
  - `record.delete.started`
  - `record.delete.completed`
- 前端从“执行者”逐步变成“事件订阅者和 UI 渲染者”。

收益：

- 更接近 Codex 风格的真实动作链路。
- 自动执行结果、失败原因、回滚边界更清晰。

## 与 PRD 的关系

`docs/vimo-user-prd.md` 的“8.11 识别结果反馈”已经明确要求：

- 用户提交后先启动快路生成即时承接并判断 `route`；只有 `continue_slow` 才进入慢路。
- 快路只能即时承接，不能提前声称完成。
- 慢路负责完整意图栈、候选记录、风险门控和执行计划。
- AI 回复需要流式渲染。
- 思考中状态要保持到慢路最终回复开始输出。

本方案是在该方向上的增强：把慢路内部状态也以结构化事件展示给用户。

如果未来正式实施并面向用户展示“过程时间线”，建议同步更新 PRD，补充“Vimo 可以展示轻量处理进度，但进度必须来自真实代码事件，不得由模型编造完成状态”。

## 验证建议

第一阶段完成后，至少验证：

- 快路仍能逐字出现。
- 慢路过程中能看到 `analyze/model/preview/action` 步骤。
- `ready` 自动保存仍按现有风险矩阵执行。
- `need_confirmation` 仍进入顶部待确认和确认卡。
- `answer_query/joke_response/config_update` 不展示记录卡。
- 模型失败时只展示普通错误 UI，不写入 assistant 固定回复。
- 旧接口 `/api/agent/messages` 和 `/api/agent/fast-reply/stream` 不受影响。

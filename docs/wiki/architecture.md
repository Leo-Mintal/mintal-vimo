# Architecture

## 当前阶段

Phase 1 实现文本版 Chat Agent Demo：

```text
用户文本输入 -> Go 后端加载 Agent prompt + runtime always skills -> 并行启动快路流式承接和慢路结构化分析 -> OpenAI-compatible 模型 -> 意图栈 + 结构化候选 + intent_trace -> 风险门控 -> 前端自动执行/候选预览/待确认 -> open_contexts 状态注入下一轮
```

## 模块边界

- `vimo-go/internal/agent`：负责把自然语言转为 Vimo 记录预览。
- `vimo-go/internal/agent`：支持快路即时承接和慢路结构化分析；HTTP 流式接口会并行启动两路，快路只生成流式自然语言承接，不执行保存、修改、删除或提醒动作。
- `vimo-go/internal/agent`：保留旧版单记录字段，同时归一化 `primary_intent`、`secondary_intents`、`record_candidates`、`execution_plan` 和 `reply_strategy`，供前端逐步迁移。
- `vimo-go/internal/agent`：归一化 `intent_trace` 和 `pending_state/context_state`，用于运行时诊断和下一轮未收口上下文注入。
- `vimo-go/internal/llm`：定义大模型通用请求、响应、非流式 Provider 和可选流式 Provider 接口。
- `vimo-go/internal/llm/qwen`：实现 OpenAI Compatible Chat Completions 调用，并支持 SSE 流式 delta 解析。
- `vimo-go/internal/records`：负责记录模型、内存存储和业务服务。
- `vimo-go/internal/http`：负责 REST 路由、请求解析和响应。
- `vimo-go/internal/config`：负责环境变量和模型配置加载。
- `vimo-go/prompts`：集中维护模型提示词，代码启动时读取并组合。
- `vimo-go/prompts/skills`：维护 Vimo 运行时 AI skills；`always/` 下的 Markdown 会加载到每次 Agent 模型调用中，当前用于统一聊天回复和可沉淀 `title/content` 的人话化约束。
- Runtime Skills 自主选择方案见 `docs/wiki/runtime-skills-autonomy-plan.md`。未来如果 Agent 需要未加载 skill，只能输出结构化 `skill_request`，由后端 Skill Registry 和 Safety Gate 决定是否注入或拒绝；模型不能自行下载、安装或执行 skill。
- `vimo-web/src/components`：负责移动端 Chat UI、记录卡片和页面骨架。
- `vimo-web/src/services`：负责调用后端 API。

## 存储

Phase 1 使用内存存储。进程重启后记录会丢失。

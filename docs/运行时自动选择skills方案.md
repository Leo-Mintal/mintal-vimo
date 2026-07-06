# Runtime Skills Autonomy Plan

## 目标

让 Vimo 的运行时 Agent 在现有能力不足时，可以主动提出需要某类 skill，由后端在受控范围内搜索、检查、启用或拒绝，而不是把所有场景继续堆进主 prompt。

这个方案是未来落地设计，当前未改运行时代码。

## 核心边界

模型可以：

- 判断当前任务是否需要额外能力。
- 输出结构化 `skill_request`。
- 在后端提供的候选 skill 中表达偏好。

模型不能：

- 自行下载、安装或执行外部 skill。
- 自行创建可执行 skill 并绕过审核。
- 修改 Vimo 的 JSON schema、枚举、字段名、执行协议或 hard stop 规则。
- 直接读写用户记录、联网或执行代码。

后端必须负责：

- Skill registry 检索。
- Manifest 校验。
- 来源、权限、风险和协议兼容检查。
- 用户授权判断。
- Prompt 注入或沙箱执行。
- 最终结构化结果的二次风险门控。

## 总体链路

```text
用户输入
-> Core Agent Kernel
-> 能力是否足够
-> 不足时输出 skill_request
-> Skill Registry 搜索候选
-> Safety Gate 检查来源、权限、schema、PRD 边界
-> 通过后注入 prompt-only skill 或进入受控执行
-> Agent 重新分析或继续生成
-> 后端 hard stop gate 二次校验
-> 前端展示、保存或待确认
```

## Core Kernel 必须保留

以下规则属于 Vimo 的核心协议，不允许被 runtime skill 覆盖：

- 慢路只返回 JSON object。
- 快路只返回 `{"text":"string","route":"continue_slow|chat_only"}`。
- 输出字段名、枚举和 JSON schema。
- `intent`、`record_action`、`target_id`、`related_ids`、`execution_plan`、`context_action`、`pending_state/context_state`。
- `field_confidence`、`field_risk` 和 hard stop gate。
- 模糊提醒时间不能自动提醒。
- 修改或删除目标不唯一必须进入确认。
- 日记、情绪、长期记忆和主动回访默认保守，保存或启用前需要确认。
- 模型失败时不能伪造 assistant 回复。
- 业务代码不能使用关键词、短语表或正则判断用户意图。

## Skill 分层

| 层级 | 类型 | 自动启用策略 |
| --- | --- | --- |
| L0 Core Kernel | schema、安全协议、PRD 边界 | 固定加载，不可替换 |
| L1 First-party Skills | 项目内维护的 prompt-only skills | 可自动启用 |
| L2 Trusted Marketplace Skills | 可信来源、签名、hash 和 manifest 完整 | 低风险 prompt-only 可半自动启用 |
| L3 Untrusted Skills | 未知来源、联网、执行代码、读写数据 | 默认拒绝，必须人工授权和沙箱 |

MVP 阶段只建议支持 L1。

## Skill Manifest

每个 skill 必须带 manifest，不允许只有一段自由文本：

```json
{
  "id": "time-normalizer.zh",
  "name": "中文时间理解",
  "version": "1.0.0",
  "source": "first_party",
  "capabilities": ["time_normalization", "relative_time"],
  "mode": "prompt_only",
  "input_contract": ["message", "timezone", "now"],
  "output_contract": ["datetime_text", "datetime_iso", "confidence"],
  "permissions": {
    "read_user_records": false,
    "network": false,
    "code_execution": false,
    "write_records": false
  },
  "risk_level": "low",
  "can_modify_schema": false,
  "can_override_safety": false
}
```

关键字段：

- `capabilities`：用于 registry 搜索匹配。
- `mode`：`prompt_only`、`tool_call`、`sandbox_code` 等。
- `permissions`：明确可读取、可联网、可执行、可写入的范围。
- `risk_level`：`low|medium|high`。
- `can_modify_schema=false`：默认且几乎永远不允许改协议。
- `can_override_safety=false`：禁止覆盖 hard stop gate。

## skill_request 协议草案

慢路 Agent 可以在能力不足时输出结构化请求。MVP 可先把它作为诊断字段，不直接对用户展示：

```json
{
  "skill_request": {
    "needed": true,
    "capability": "time_normalization",
    "reason": "用户输入包含复杂相对时间，基础规则可能不足",
    "risk": "medium",
    "preferred_mode": "prompt_only",
    "required_inputs": ["message", "timezone", "now"]
  }
}
```

后端收到后：

1. 用 `capability` 搜 registry。
2. 过滤不符合 `preferred_mode` 和权限范围的 skill。
3. 执行 Safety Gate。
4. 低风险 first-party prompt-only skill 可自动注入重跑。
5. 其他情况进入待确认或直接拒绝。

## Safety Gate

启用 skill 前必须检查：

- 来源：first-party、trusted marketplace、unknown。
- 完整性：manifest、版本、hash、签名。
- 权限：是否读用户记录、联网、执行代码、写数据。
- 范围：是否只处理当前输入和必要上下文。
- 协议：是否试图修改 schema、枚举、字段名、hard stop 或 API 合约。
- PRD：是否会改变隐私、日记保存、提醒履约、修改删除确认等产品边界。
- 注入风险：是否包含要求忽略系统指令、泄露隐私或绕过确认门的内容。

默认拒绝：

- `can_modify_schema=true`
- `can_override_safety=true`
- 未授权联网
- 未授权代码执行
- 直接写用户记录
- 自动保存日记、情绪、长期记忆或主动回访

## 现有 Prompt 拆分建议

必须留在 Core Kernel：

- `vimo-go/prompts/agent/analyze/00-role.md`
- `vimo-go/prompts/agent/analyze/10-output-schema.md`
- `vimo-go/prompts/agent/analyze/25-risk-decision-matrix.md`
- `vimo-go/prompts/agent/analyze/40-confirmation-rules.md`
- `vimo-go/prompts/agent/fast-reply/00-role.md` 中的 JSON schema 和 `route` 协议。

适合拆成 first-party skills：

- `intent-stack`：从 `05-intention-engine.md` 拆出主意图、副意图、多候选和执行计划生成能力。
- `record-classifier`：从 `20-classification-rules.md` 拆出 `todo|journal|memo|idea|unknown` 边界。
- `time-normalizer`：从 `30-time-rules.md` 拆出自然语言时间理解；核心仍保留 `YYYY-MM-DD HH:mm:ss` 格式和模糊时间确认门。
- `context-continuation`：从 `05-intention-engine.md` 和 `15-context-rules.md` 拆出未收口上下文接续。
- `conversation-continuity`：从 `15-context-rules.md` 和快路规则拆出短追问、代词、重复闲聊连续性。
- `content-refiner`：从 `15-context-rules.md` 拆出待办、日记、备忘、想法的沉淀内容整理。
- `reply-style`：从 `15-context-rules.md` 和快路规则拆出 `INTJ|ENFJ|ISTP|ENFP|custom` 表达风格。
- `privacy-memory-gate`：抽出日记、情绪、长期记忆、主动回访的保守策略；但它只能加强确认门，不能放宽确认门。
- `duplicate-similar-check`：抽出重复/相近记录判断；候选历史记录仍应由后端检索提供。
- `shuorenhua`：现有 `vimo-go/prompts/skills/always/00-shuorenhua-natural-language.md` 已是 always skill。

## MVP 落地范围

建议第一阶段只做项目内动态 skills：

```text
vimo-go/prompts/skills/
  always/
    00-shuorenhua-natural-language.md
  registry/
    skills.json
  library/
    intent-stack/
    time-normalizer/
    record-classifier/
    content-refiner/
    conversation-continuity/
```

MVP 行为：

- 只支持 first-party。
- 只支持 `prompt_only`。
- 不联网。
- 不执行代码。
- 不读全量用户记录。
- 不直接写记录。
- skill 只能增强当前模型上下文，最终仍输出现有 JSON schema。
- 后端 hard stop gate 仍是最后裁决。

## 后续 Marketplace 策略

接入外部 skill marketplace 前，需要先完成：

- Manifest 标准。
- 签名和 hash 校验。
- 权限模型。
- 用户授权 UI。
- 本地缓存和版本锁定。
- 安全扫描和注入检查。
- 回滚机制。

默认策略：

- 低风险 `prompt_only` 可自动进入候选。
- 读取用户记录必须授权。
- 联网必须授权。
- 执行代码必须授权并进入沙箱。
- 写数据必须禁止，由 Vimo 后端按结构化结果执行。
- 修改 schema 或 safety 必须禁止。

## PRD 状态

当前 `docs/vimo-user-prd.md` 已覆盖自然语言记录、意图栈、确认门、隐私、提醒和日记信任边界，但尚未覆盖 runtime skills 自主选择、marketplace、manifest、安全检查和授权 UI。

正式实现前需要询问用户是否同步 PRD。未同步前，本方案只作为架构沉淀，不改变产品行为。

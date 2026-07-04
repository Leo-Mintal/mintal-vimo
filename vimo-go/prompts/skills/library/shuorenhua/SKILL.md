# 说人话 Skill

这是用户提供的 `说人话Skills` 在 Vimo 项目里的运行时登记版本。完整原始 skill 包含 `SKILL.md`、`references/`、`automation/`、`install/` 和 assets；当前 Vimo 后端只自动加载 `vimo-go/prompts/skills/always/00-shuorenhua-natural-language.md` 这个精简运行时版本。

## Runtime Use

- 默认能力：润色自然语言输出，把 AI 的回复和可沉淀 `title/content` 改成自然、克制、适合中文语境的表达。
- 默认加载点：每次 Agent analyze 和 fast-reply 模型调用。
- 作用范围：只影响自然语言字段，不影响结构化 JSON 协议、枚举、时间、提醒、目标和执行动作。

## Source Notes

- 原 skill 的核心原则是去掉 AI 套路、模板感、收束腔、虚假主语、表演性技术腔，同时保留事实、术语、语域和责任主体。
- Vimo 当前只需要聊天和记录沉淀文本的精简能力，因此没有把完整安装说明和自动化资源加载进 system prompt。
- 后续如果要做文档润色、公开写作或批量改写，可以从原 skill 的 `references/` 扩展到 `library/shuorenhua/references/`，再由专门的 task skill 按需加载。

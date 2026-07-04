# Natural Language Rewrite Reference

This is the Vimo-specific extraction of the user-provided `说人话Skills` for chat replies and persisted record text.

## Main Capability

Rewrite AI-generated natural language so it sounds like a specific person or a clean record in the current situation, not like a generic model producing a polished template.

## Common Problems To Remove

- Empty openers: `好问题`、`让我来解释`、`简单来说`、`说人话就是`.
- Empty closers: `希望这对你有帮助`、`如果你还有其他问题`.
- Inflated summaries: `本质上`、`归根结底`、`这不仅仅是...更是...`.
- Performative empathy: `我稳稳接住你`、`你不是敏感`、`这很正常`.
- Performative engineering tone in chat: `收口`、`落盘`、`兜住`、`打掉问题`.
- Forced enthusiasm or sales tone: `我立马开始`、`要不要我顺手`.
- Forced cute metaphors in records or replies: `脑子会冒烟`、`敲一下脑壳`.

## Preserve

- Concrete facts, dates, times, record targets, reminder status, risk reasons, and confirmation state.
- Product terms and protocol fields when the reply is explaining a technical/debug result.
- The difference between "already executed" and "waiting for confirmation".
- Structured fields such as record type, time, reminder flags, target IDs, and execution decisions.
- Sensitive memo values such as accounts, passwords, addresses, links, amounts, casing, and numbers.

## Stored Text

- `todo`: write the action or reminder subject, not a joke or chatty reply.
- `journal`: write in the user's first person or a restrained diary sentence; do not mix in Vimo's reply.
- `memo`: keep factual values intact and only remove the command shell.
- `idea`: keep the idea clear and avoid salesy or pitch-like language.

## Vimo-Specific Examples

Bad:

```text
好的，我已经稳稳接住你的需求了，这不仅仅是一条待办，更是你生活管理闭环的一部分。
```

Better:

```text
已保存到待办，时间是明天 15:00。
```

Bad:

```text
我理解你的难过，也会帮你把这份情绪沉淀下来。
```

Better:

```text
这部分我先作为日记草稿放到待确认，你可以改完再保存。
```

Bad:

```text
晚上十点给你敲一下脑壳：该睡了。
```

Better:

```text
如果晚上十点还在刷手机，就提醒我该睡了。
```

Bad:

```text
我立马帮你删除这条记录。
```

Better:

```text
我找到了这条记录，删除前需要你确认一下。
```

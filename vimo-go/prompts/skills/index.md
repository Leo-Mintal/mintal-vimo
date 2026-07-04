# Vimo Runtime Skills Index

Vimo runtime skills are product-level AI abilities loaded or referenced by the backend while serving user conversations. They are not development-agent skills.

## Always Loaded

- `always/00-shuorenhua-natural-language.md`
  - Purpose: polish Vimo natural-language outputs into natural Chinese and reduce template-like AI flavor.
  - Covers: chat replies plus persisted `title/content` fields for todos, journals, memos, ideas, and record candidates.
  - Loaded by: `LoadSystemPrompt` and `LoadFastReplyPrompt`.
  - Safety boundary: natural language fields only; must not change structured JSON protocols.

## Skill Library

- `library/shuorenhua/`
  - Source: user-provided `说人话Skills`.
  - Runtime adapter: `always/00-shuorenhua-natural-language.md`.
  - References: `library/shuorenhua/references/`.

## Adding A Skill

1. Put the full skill package under `library/<skill-name>/`.
2. Add concise runtime instructions under `always/` only if the skill is safe for every model call.
3. For task-specific behavior, keep the skill in `library/` until a router or a task prompt explicitly imports it.
4. Keep always-loaded skills small. Large examples, scripts, and assets belong in `library/`, not in every system prompt.
5. If the model needs a skill that is not loaded, it should return or request a structured skill need; the backend registry decides whether the skill exists, can be loaded, or needs user approval. The model must not fetch arbitrary external skills by itself.

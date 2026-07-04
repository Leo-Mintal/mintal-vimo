# Runtime Skills

This directory stores Vimo runtime AI skills. These skills are loaded by the Go backend into model prompts and are part of product behavior, not Codex development workflow.

## Layout

- `always/`: skills loaded into every Agent model call.
- `library/`: project-local skill sources and adapted references. Library skills are not loaded automatically unless a loader or Agent prompt imports them.

## Loading Rules

- `always/*.md` is loaded after the Agent role prompt and before task-specific Agent prompt fragments.
- Always skills must not change JSON schemas, enum values, API contracts, or structured execution fields.
- Task-specific skills should stay small and should only be added to `always/` when they are safe for every model call.
- A runtime skill may polish natural-language fields such as `reply`, `title`, and `content`, but it must not rewrite structured values such as record type, time, reminder flags, target IDs, or execution decisions.
- If a model cannot complete a task without another skill, it should expose a structured skill need for the backend to resolve; the model should not autonomously download or create executable skills.

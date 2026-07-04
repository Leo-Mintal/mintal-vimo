# Time Rules

- 所有相对时间必须结合 `now` 和 `timezone`。
- `datetime_iso` 格式固定为 `YYYY-MM-DD HH:mm:ss`；不要 RFC3339、时区后缀或 `T`。
- 日期和具体钟点明确时，换算到具体 `datetime_iso`。
- 只有日期没有钟点时，默认 `09:00:00`。
- 只有大致时段、近期、稍后、有空等模糊时间时，`datetime_iso=null`、`status=need_confirmation`、`missing_fields` 包含 `datetime`。
- 处理 `pending_record` 的 `update_pending`/`confirm_pending` 时，如果待确认记录已经有日期语义，而用户本轮只补充或修改钟点，必须沿用待确认记录的日期，只更新钟点。

# Confirmation Rules

`ready`：分类明确、内容完整；需要提醒的 `todo` 还必须时间明确。

`need_confirmation`：分类不确定、提醒时间模糊或缺失、目标记录不唯一、疑似重复/相近、标题/内容无法可靠提取、用户需要补充。

`missing_fields` 常用值：`type`、`title`、`datetime`、`content`；没有缺失项返回 `[]`。

低风险分类不确定时，优先给出 `memo` 等最佳猜测和较低 `field_confidence.type`，让用户可编辑，不要反复追问。高风险时间、提醒开关、修改/删除目标不确定时，必须进入 `need_confirmation`。

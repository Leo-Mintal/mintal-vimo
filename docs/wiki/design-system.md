# Vimo Design System

## 设计定位

- `vimo-web` 面向 C 端个人记录场景，当前风格关键词是深色、圆润、轻快、陪伴感。
- 界面应像一个随手记录的小助手，而不是数据看板、管理后台或企业工具。
- 主路径保持简单：输入、快捷意图、确认保存、查看记录；避免堆叠说明文字和复杂筛选。
- 当前阶段优先功能闭环：PC 双栏聊天工作台、结构化预览、确认保存、右侧记录 CRUD；PC 端以紧凑密度为主，方便截图和快速查看。

## 色彩

- 主背景使用深色渐变和半透明深色面板：`paper`、`cream`、`white` 都已映射为深色 token。
- 主界面关键可见面板（顶部栏、会话区、输入区、右侧记录区、消息气泡、记录卡）使用显式深色值兜底，避免浅色 token 或旧样式回退导致浅色块。
- 主操作使用低亮暖色底配浅色文字/图标，例如 `butter` + `ink`。
- 文本使用浅色 `ink` 和 `cocoa`，图标、placeholder、禁用态也必须保持深色背景上的可见性。
- 信息色块保持多色但低压迫感：待办用 `mint/leaf`，日记用 `sky-soft/sky`，备忘用 `peach-soft/berry`，想法用 `lilac-soft/lilac`。
- 禁止把页面做成单一蓝灰、纯绿色工具风，深色主题也要保留多色状态区分。

## 圆角和边框

- PC 工作台主容器优先使用 16px-20px 圆角，避免页面元素过大。
- 主要卡片在 PC 端使用 12px-18px 圆角，确认卡保持紧凑；移动端如需更可爱风格可适当放大。
- Icon 按钮、头像、状态胶囊在 PC 端优先使用 10px-14px 圆角或 full radius。
- 8px 圆角只允许用于极小的视觉修饰，不用于主卡片、主按钮、输入框、抽屉或消息气泡。
- 边框使用 `white/70`、`line/70`、`peach/40` 等柔和透明边框，避免硬灰线。

## 组件

- 控件优先使用 lucide icon，按钮必须保留 `aria-label` 和 `title`。
- 主按钮可以带短文字，例如保存；次级操作尽量只保留 icon。
- 消息展示保持轻量：用户消息使用暖色圆润气泡和头像；AI 回复不显示头像或气泡，采用类似 Codex 的直排文本，并在正文上方保留默认收起的意图栈调试入口。
- 刷新、复制、设置、手动记录操作等即时通知使用顶部短暂 toast；与 AI 处理结果、待确认或记录自动执行相关的状态可显示在聊天流内，使用类似 Codex 上下文状态的灰色居中行和细分隔线。
- 输入区底部固定、快捷意图横向 icon 化；PC 端高度保持紧凑，语音按钮当前只作为 disabled 占位。
- 记录确认卡是轻量消费级确认面板，但必须数据化展示识别结果：类型、置信度、完整度、字段状态、缺失项都要能一眼扫到。
- 记录确认卡的编辑区应保持紧凑轻量，不要把主路径变成大表单；重点保留 AI 对话和确认。
- 桌面记录区使用右侧常驻面板，通过 tab 切换分类，并以列表形式展示记录；空状态、搜索、新增、编辑、删除都应在面板内完成。
- 用户消息气泡、记录列表条目和记录确认卡在深色主题下都必须使用深色底、浅色文字和浅色 icon，不能保留浅色卡片。
- 小屏可上下堆叠，但不以移动端拟物或拖拽画布作为当前主实现。

## 动效

- 常规交互使用 150ms-240ms transition。
- hover 只允许轻微上移、颜色变化或柔和阴影，不做大幅缩放。
- loading 使用小圆点或 icon 状态，不展示长说明。
- 必须尊重 `prefers-reduced-motion`，全局样式已做降级。

## 文案

- 页面文案要短，偏口语。
- 入口名称、toast 和聊天内状态提示控制在 2-5 个汉字优先。
- 不在界面内解释功能、设计意图或键盘快捷键。

## 当前实现入口

- 主题 token：`vimo-web/tailwind.config.js`
- 全局样式：`vimo-web/src/styles/index.css`
- 主聊天界面：`vimo-web/src/components/ChatAgent/ChatAgent.tsx`
- 输入区：`vimo-web/src/components/ChatAgent/Composer.tsx`
- 消息气泡：`vimo-web/src/components/ChatAgent/MessageBubble.tsx`
- 记录确认卡：`vimo-web/src/components/RecordCard/RecordCard.tsx`
- 移动端壳：`vimo-web/src/components/MobileShell/MobileShell.tsx`

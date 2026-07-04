# Mintal Vimo

Vimo / 微默 Phase 1 Demo：文本版 Chat Agent。

## 本地启动

### 后端

```bash
cd /Applications/File/WorkSpace/MyProject/mintal-vimo/vimo-go
cp .env.example .env
cp configs/models.example.yaml configs/models.yaml
go run ./cmd/server
```

默认后端地址：`http://localhost:8080`。

Records API 默认使用内存仓储，不配置 `DB_DRIVER` 也不会连接数据库；临时启用 MySQL 时需要显式设置 `DB_DRIVER=mysql` 和 `MYSQL_DSN`。

后端默认只监听 `127.0.0.1`，并只允许本机 Vite 开发源访问。如果要让其他设备访问，必须显式开启 API Token：

```bash
HTTP_HOST=0.0.0.0 REQUIRE_API_TOKEN=true API_TOKEN=<set-a-strong-token> go run ./cmd/server
```

如果 `8080` 已被占用，可以覆盖端口：

```bash
HTTP_PORT=18081 go run ./cmd/server
```

### 前端

```bash
cd /Applications/File/WorkSpace/MyProject/mintal-vimo/vimo-web
npm install
npm run dev
```

默认前端地址：`http://localhost:5173`。

如果后端使用了非默认端口，需要把前端 API 地址指过去：

```bash
cd /Applications/File/WorkSpace/MyProject/mintal-vimo/vimo-web
VITE_API_BASE=http://localhost:18081 npm run dev
```

如果后端开启了 `REQUIRE_API_TOKEN=true`，前端本地联调需要同时配置：

```bash
VITE_API_TOKEN=<same-token-as-backend> npm run dev
```

## 配置

- 模型配置示例：`vimo-go/configs/models.example.yaml`
- 环境变量示例：`vimo-go/.env.example`
- Agent analyze 系统提示词会固定加载 `vimo-go/prompts/agent/analyze/05-intention-engine.md` 作为意图分析前置 skill。
- 本地真实配置文件 `vimo-go/.env` 和 `vimo-go/configs/models.yaml` 不提交，真实 API Key 只放本地 env 或部署环境变量。
- 前端本地环境变量可参考 `vimo-web/.env.example`，不要提交真实 token。
- 上传 GitHub 前建议运行 secret scan，并确认 `vimo-go/.env`、`vimo-go/configs/models.yaml`、`vimo-web/node_modules/`、`vimo-web/dist/`、`.playwright-cli/`、`.learnings/`、`tmp/` 均被 ignore。

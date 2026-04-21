# Iris

**Claude Code → OpenRouter 代理，自带 cost-aware dashboard。**

把 Claude Code（或任何走 Anthropic Messages API 的客户端）的请求转发到 OpenRouter，同时把每次调用的 **token、实际花费、耗时、完整 payload** 落库，通过浏览器面板可视化你每一分钱花在了哪。

[English README](./README.en.md)

![license](https://img.shields.io/badge/license-ISC-blue.svg)
![node](https://img.shields.io/badge/node-%E2%89%A520-green.svg)

## 为什么是 Iris

市面上 Claude → OpenAI 兼容的代理已经不少。Iris 的差异化只有一个：**它知道每次调用花了多少钱**。

OpenRouter 在 SSE 响应的 `usage.cost` 字段里直接给出**实际扣费金额**（不是按 token 单价估算，是真扣了多少）。Iris 把这个字段抽出来落库，dashboard 直接告诉你：
- 今天/本周/本月总花费
- 哪个模型最烧钱
- 哪一次调用最贵、贵在 input 还是 output
- 跨模型对比每百万 token 的实际 cost

如果你用 Claude Code 每天跑很多 agent loop，对"钱都去哪了"这件事有好奇心，这个项目就是给你写的。

## 功能

- **Messages API 代理** — 兼容 Anthropic `POST /v1/messages`，流式 / 非流式都支持
- **自动模型映射** — 不带前缀的模型名（如 `claude-opus-4-7`）自动补成 `anthropic/claude-opus-4-7`
- **完整日志** — 每次请求的 headers / body、响应 headers / body、token 用量、cost 都写入 SQLite
- **Dashboard** — Overview（汇总）/ Logs（明细）/ Models（按模型聚合），支持 24h / 7d / 30d / all 时间范围筛选
- **Log detail 面板** — 查看单次调用的完整 payload，user 消息的 text 部分默认展开

## 技术栈

- **Backend** — Hono + `@hono/node-server` + better-sqlite3 + Drizzle ORM，用 tsx 直接跑 TypeScript 源码
- **Frontend** — React 19 + Vite + Tailwind CSS + TanStack Query + Recharts

## 快速开始

需要 Node.js ≥ 20 和 pnpm。

```bash
git clone https://github.com/hugochiu/iris.git
cd iris
pnpm bootstrap                   # 装依赖 + 建 .env + 初始化 DB

# 把 OpenRouter key 写进 shell profile（不要写进 .env）
echo 'export OPENROUTER_API_KEY=sk-or-...' >> ~/.zshrc && source ~/.zshrc

pnpm dev                         # 前后端同时启动
```

启动后：

- Backend proxy：http://localhost:3000
- Dashboard（dev 模式）：http://localhost:5173

生产模式下跑 `pnpm serve`，前端会 build 后由 backend 从 `/` 托管，只占一个 :3000 端口。

## 配置

`.env` 支持的字段（见 [.env.example](.env.example)）：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `OPENROUTER_API_KEY` | **必填** | OpenRouter API key。**从系统环境变量读取**，不要写进 `.env`（避免泄漏） |
| `PORT` | `3000` | 代理监听端口 |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | OpenRouter 上游地址 |
| `DEFAULT_MODEL` | `anthropic/claude-opus-4.6` | 客户端未指定模型时的默认模型 |
| `DB_PATH` | `./data/iris.db` | SQLite 数据库路径 |
| `LOG_PAYLOADS` | `true` | 是否记录完整请求/响应 payload（体积大可关） |

## 使用

### 指向 Claude Code

设置环境变量让 Claude Code 走这个代理：

```bash
export ANTHROPIC_BASE_URL=http://localhost:3000
# ANTHROPIC_API_KEY 可以随便填（代理用自己的 OPENROUTER_API_KEY 上游）
claude
```

### 直接调用

```bash
curl http://localhost:3000/v1/messages \
  -H 'content-type: application/json' \
  -d '{
    "model": "claude-opus-4-7",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "你好"}]
  }'
```

## 开发

| 命令 | 作用 |
|---|---|
| `pnpm bootstrap` | 首次安装（装依赖 + 建 .env + 初始化 DB） |
| `pnpm dev` | 开发模式：backend（:3000，`tsx watch` 热重载）+ frontend（:5173，vite HMR） |
| `pnpm dev:back` | 只启 backend |
| `pnpm serve` | 生产模式：前端 build 后由 backend 从 `/` 托管（单端口 :3000） |
| `pnpm db:push` | 应用 Drizzle schema 变更 |

开发模式下前端通过 Vite proxy 把 `/api/*` 转发到 :3000，所以只在 :5173 访问 dashboard 即可。

### 更新代码后

`git pull` 之后如果 `package.json` 或 schema 有变更，最省心的方式是再跑一次 `pnpm bootstrap`——它的每一步都是幂等的（已装的依赖跳过、`.env` 已存在不覆盖、`mkdir -p data` 无副作用）。

唯一要留意的是 `pnpm db:push` 会把 schema 同步到 SQLite，**破坏性变更**（删字段、改类型、加 NOT NULL 无默认值）可能导致数据丢失，注意看终端输出里的确认提示。

只想更新依赖、不碰数据库的话：

```bash
pnpm install && (cd frontend && pnpm install)
```

注意：`pnpm dev` 本身**不会**检查或安装依赖，依赖变动后不手动装一次会直接报 `Cannot find module`。

## 项目结构

```
src/
  index.ts              # Hono 入口，注册路由 + 托管前端产物
  config.ts             # 环境变量解析
  proxy/handler.ts      # /v1/messages 代理、流式响应解析、日志采集
  stats/                # dashboard 使用的统计 API（summary / timeseries / by-model / logs）
  db/                   # Drizzle schema + logger
frontend/
  src/
    App.tsx             # 主布局 + tab 切换
    pages/              # Overview / Logs / ByModel
    components/         # metric-card、json-tree、log-detail 等
    hooks/use-stats.ts  # React Query 封装
    lib/api.ts          # 前端 API client
scripts/
  setup.sh              # 首次安装
  dev.sh                # 开发模式并行启动
  build.sh              # 生产构建 + 启动
data/                   # SQLite 数据库（git ignore）
```

## FAQ

**能不能接 DeepSeek / Groq / ollama 这些 OpenAI 兼容的上游？**

代理层可以，但 dashboard 的 cost 字段会是空的——它依赖 OpenRouter 响应里独有的 `usage.cost`。如果上游只返回 token 数，你只能看 token 用量、看不到实际花费。这也是为什么 Iris 当前只强调 OpenRouter 一家。

**数据库会很大吗？**

默认 `LOG_PAYLOADS=true` 会把完整请求/响应体写入，长对话或大上下文下膨胀很快。嫌大可以关掉，只记 metadata（token、cost、耗时）。

**能多用户吗？**

不能，这是单机单用户工具。没有鉴权，别暴露到公网。

## License

ISC

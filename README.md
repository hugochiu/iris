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
- **模型路由映射** — 客户端请求里的 `opus` / `sonnet` / `haiku` 可以在 dashboard 里一键改为路由到任意 OpenRouter 模型（比如把 Claude Code 的 Opus 请求改跑 DeepSeek、GLM-4.6 或任何 OpenRouter 支持的模型），不改客户端配置
- **多上游切换** — 通过 `OPENROUTER_ALT_*` 配第二个上游（官方 key / 中转 key / 自建 gateway），在 dashboard 里随时切换，不改环境变量
- **Provider 限定** — 限制 OpenRouter 只路由到指定 provider（比如只走 DeepInfra、不走 Novita），避开特定 provider 的质量问题
- **完整日志** — 每次请求的 headers / body、响应 headers / body、token 用量、cost 都写入 SQLite
- **Dashboard** — 6 个 tab：
  - **Overview** — 总花费、请求数、token 用量、按时间分布的趋势图
  - **Sessions** — 按 Claude Code session 聚合，一眼看出某次 agent loop 烧了多少钱
  - **Logs** — 明细列表 + 详情面板，查看单次调用的完整 payload
  - **Models** — 按模型聚合 cost / token / 调用次数
  - **Cache** — 缓存命中率、cache read / cache write 花费拆分
  - **Settings** — 模型路由映射、Provider 限定、上游切换
- **时间范围** — today / 24h / 7d / 30d / all 全局筛选

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
| `OPENROUTER_API_KEY` | **必填** | 主上游 API key。**从系统环境变量读取**，不要写进 `.env`（避免泄漏） |
| `PORT` | `3000` | 代理监听端口 |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | 主上游地址 |
| `OPENROUTER_NAME` | `Primary` | 主上游在 dashboard 里的显示名 |
| `OPENROUTER_ALT_API_KEY` | — | 备用上游 key（可选；同时配 `ALT_BASE_URL` 才生效） |
| `OPENROUTER_ALT_BASE_URL` | — | 备用上游地址（可选；比如某个中转或自建 gateway） |
| `OPENROUTER_ALT_NAME` | `Alt` | 备用上游的显示名 |
| `DEFAULT_MODEL` | `anthropic/claude-opus-4.6` | 客户端未指定模型时的默认模型 |
| `DB_PATH` | `./data/iris.db` | SQLite 数据库路径 |
| `LOG_PAYLOADS` | `true` | 是否记录完整请求/响应 payload（体积大可关） |

> 只有 OpenRouter 官方上游会返回 `usage.cost` 字段。如果备用上游是其他 OpenAI 兼容网关，dashboard 还能算 token，但 cost 会是空的。

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

### 模型路由

请求里的 model 字段如果匹配到 `opus` / `sonnet` / `haiku` 关键词，会被替换成 Settings 页里配好的目标模型。比如配 `opus → deepseek/deepseek-v3.2-exp`，所有 `claude-opus-*` 的请求就会跑 DeepSeek。

没配映射的情况下走默认逻辑：带 `/` 的模型名（`openai/gpt-4o`）原样转发，不带的自动加 `anthropic/` 前缀。

## 开发

| 命令 | 作用 |
|---|---|
| `pnpm bootstrap` | 首次安装（装依赖 + 建 .env + 初始化 DB） |
| `pnpm dev` | 开发模式：backend（:3000，`tsx watch` 热重载）+ frontend（:5173，vite HMR） |
| `pnpm dev:back` | 只启 backend |
| `pnpm serve` | 生产模式：前端 build 后由 backend 从 `/` 托管（单端口 :3000） |

开发模式下前端通过 Vite proxy 把 `/api/*` 转发到 :3000，所以只在 :5173 访问 dashboard 即可。

### Schema 迁移

schema 变更通过启动时的幂等逻辑自动 reconcile：`request_logs` 靠 [src/index.ts](src/index.ts) 的 `migrateRequestLogs()`（建新表→拷数据→删旧表），其它表和索引由 [src/db/index.ts](src/db/index.ts) 的 `CREATE TABLE IF NOT EXISTS` / `ensureColumn` 保证。

**不要用 `drizzle-kit push`**，细节见 [CLAUDE.md](CLAUDE.md)。

### 更新代码后

`git pull` 后如果 `package.json` 有变更，最省心的方式是再跑一次 `pnpm bootstrap`——它的每一步都是幂等的（已装的依赖跳过、`.env` 已存在不覆盖）。schema 不需要手动动作，启动时自己会对齐。

只想更新依赖的话：

```bash
pnpm install && (cd frontend && pnpm install)
```

注意：`pnpm dev` 本身**不会**检查或安装依赖，依赖变动后不手动装一次会直接报 `Cannot find module`。

## 项目结构

```
src/
  index.ts                   # Hono 入口，注册路由 + 托管前端产物 + 启动时迁移
  config.ts                  # 环境变量解析，主/备上游组装
  upstream.ts                # 活跃上游的读写（活跃状态存 DB 里）
  proxy/handler.ts           # /v1/messages 代理、流式解析、模型路由、日志采集
  stats/                     # dashboard 的统计 API
    summary.ts               #   汇总（总花费、token、请求数）
    timeseries.ts            #   按时间分桶的趋势
    by-model.ts              #   按模型聚合
    logs.ts                  #   请求明细 + 单条详情
    sessions.ts              #   按 session 聚合 + 详情
    session-meta.ts          #   从 messages 里抽 preview / tool calls 的工具
    errors.ts, range.ts      #   错误码分类、时间范围解析
    settings.ts              #   模型映射 / Provider 限定 / 上游切换的读写 API
  db/
    index.ts                 #   better-sqlite3 + 启动时 invariant（CREATE TABLE / ensureColumn）
    schema.ts                #   Drizzle schema（ORM 类型推断用）
    logger.ts                #   写 request_logs / request_payloads
    settings.ts              #   KV 式 settings 表（模型映射、provider 路由、活跃上游）
    backfill-session-meta.ts #   启动后台 backfill：给老日志补 session_name / preview / tool_calls
frontend/
  src/
    App.tsx                  # 主布局 + tab 切换 + URL state
    pages/
      overview.tsx           #   汇总 + 趋势图
      sessions.tsx           #   session 列表
      session-detail.tsx     #   单个 session 的请求序列
      logs.tsx               #   请求明细
      by-model.tsx           #   按模型聚合
      cache.tsx              #   缓存命中率 / cache 花费
      settings.tsx           #   模型映射 / provider / 上游切换
    components/              # metric-card、json-tree、log-detail、range-picker 等
    lib/api.ts               # 前端 API client
scripts/
  setup.sh                   # 首次安装
  dev.sh                     # 开发模式并行启动
  build.sh                   # 生产构建 + 启动
  backfill-session-meta.sh   # 手动触发 session 元数据 backfill
  rebuild-tool-call-labels.sh # 重建 tool call 标签（历史日志）
data/                        # SQLite 数据库（git ignore）
```

## FAQ

**能不能接其他 OpenAI / Anthropic 兼容的上游（中转、自建 gateway、直连官方）？**

可以，把地址和 key 填到 `OPENROUTER_ALT_*` 就能在 Settings 页里切上游。但 dashboard 的 cost 字段依赖 OpenRouter 响应里独有的 `usage.cost`——换到其他上游后还能算 token、算耗时，但实际花费会是空的。

**我想让 Claude Code 的 Opus 请求跑 DeepSeek / GLM / 其他便宜的模型，可以吗？**

可以。Settings 页里把 `opus` 的目标改成你想要的 OpenRouter 模型 id（比如 `deepseek/deepseek-v3.2-exp`），Claude Code 那边什么都不用改。`sonnet` / `haiku` 同理。

**数据库会很大吗？**

默认 `LOG_PAYLOADS=true` 会把完整请求/响应体写入，长对话或大上下文下膨胀很快。嫌大可以关掉，只记 metadata（token、cost、耗时）。

**能多用户吗？**

不能，这是单机单用户工具。没有鉴权，别暴露到公网。

## License

ISC

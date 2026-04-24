# Iris 开发规则

## 数据库 schema 变更

**给 `request_logs` 表加/改列时，必须同步更新三处：**

1. [src/db/schema.ts](src/db/schema.ts) — drizzle schema（ORM 类型推断）
2. [src/index.ts](src/index.ts) 里的 `TARGET_CREATE_SQL` 和 `TARGET_COLUMNS` — 启动时的 `migrateRequestLogs()` 会按这个严格比对，不匹配就**重建表**
3. [src/db/index.ts](src/db/index.ts) 里的 `ensureColumn(...)` — 对已有库做幂等 `ALTER TABLE ADD COLUMN`

**为什么**：`migrateRequestLogs()` 用"建新表→拷数据→删旧表"的方式 reconcile schema。如果只在 `ensureColumn` 里加了新列而忘了更新 `TARGET_COLUMNS`，每次启动都会把新列冲掉——因为 migrate 发现实际列数和 `TARGET_COLUMNS` 不一致，就会重建表成 `TARGET_COLUMNS` 定义的样子。

**顺序**：`TARGET_COLUMNS` 的顺序必须和 `TARGET_CREATE_SQL` 的列定义顺序一致，比对是按 index 逐个检查的。

**不要用 `drizzle-kit push`** 同步 schema —— 它用 recreate-table 方式迁移，一旦中途失败（比如 WAL 锁冲突）会留下 `__new_request_logs` 残留表，后续所有 push 都会崩。统一走 `ensureColumn` + `migrateRequestLogs` 这套启动时幂等逻辑。

## 新增表时的执行顺序

**新增任何表（KV 类的 `settings`、辅助表等）的 `CREATE TABLE IF NOT EXISTS` 必须放在 [src/db/index.ts](src/db/index.ts) 里，紧跟 `sqlite.pragma('journal_mode = WAL')` 之后。不要放在 [src/index.ts](src/index.ts) 主脚本顶层。**

**为什么**：ESM module top-level 按 import 依赖图执行，主脚本顶层代码要等所有 import 跑完才运行。像 [src/db/settings.ts](src/db/settings.ts) 这种在模块顶层就 `sqlite.prepare('SELECT ... FROM settings ...')` 的模块，会**先于**主脚本的 `CREATE TABLE` 执行。建表如果放错位置，新 clone/空 DB 第一次启动就会崩 `SqliteError: no such table: XXX`。

**为什么老机器不复现**：历史上某次启动已经建过表了，DB 文件里留着，之后的启动都能正常 prepare。只有空 DB 初始化会暴露这个顺序 bug。

**推论**：`src/db/index.ts` 是"启动时 DB invariant 保证模块"——所有 `ensureColumn` / `CREATE INDEX IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` 都应该集中在这，读代码时一眼看得出"import 完这个模块 → DB 已经满足这些结构"。

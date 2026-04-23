# Iris 开发规则

## 数据库 schema 变更

**给 `request_logs` 表加/改列时，必须同步更新三处：**

1. [src/db/schema.ts](src/db/schema.ts) — drizzle schema（ORM 类型推断）
2. [src/index.ts](src/index.ts) 里的 `TARGET_CREATE_SQL` 和 `TARGET_COLUMNS` — 启动时的 `migrateRequestLogs()` 会按这个严格比对，不匹配就**重建表**
3. [src/db/index.ts](src/db/index.ts) 里的 `ensureColumn(...)` — 对已有库做幂等 `ALTER TABLE ADD COLUMN`

**为什么**：`migrateRequestLogs()` 用"建新表→拷数据→删旧表"的方式 reconcile schema。如果只在 `ensureColumn` 里加了新列而忘了更新 `TARGET_COLUMNS`，每次启动都会把新列冲掉——因为 migrate 发现实际列数和 `TARGET_COLUMNS` 不一致，就会重建表成 `TARGET_COLUMNS` 定义的样子。

**顺序**：`TARGET_COLUMNS` 的顺序必须和 `TARGET_CREATE_SQL` 的列定义顺序一致，比对是按 index 逐个检查的。

**不要用 `drizzle-kit push`** 同步 schema —— 它用 recreate-table 方式迁移，一旦中途失败（比如 WAL 锁冲突）会留下 `__new_request_logs` 残留表，后续所有 push 都会崩。统一走 `ensureColumn` + `migrateRequestLogs` 这套启动时幂等逻辑。

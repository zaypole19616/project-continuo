# Continuo

**A local folder Agent that keeps working.** Continuo opens a folder, reads it before touching anything, works inside it, verifies what it delivered, and leaves a work log in the folder so the next task — and the next person — can pick up from there.

Built on [Kimi Code](https://github.com/MoonshotAI/kimi-code): the engine, sessions, tools, permission chain and local server are reused unchanged; Continuo adds a workspace feature in the engine, a task manager and routes in the server, and its own workbench UI.

**一个住在本地文件夹里、把工作持续接住的 Agent。** 第一次打开先读懂这个文件夹再动手；每件事做完核对产物、在 `work-log/` 留一份日志；下次接着干靠的是文件夹本身，不是另一份看不见的记忆。

## Read first

| | |
|---|---|
| 说明文档（产品判断、功能点、Harness 改动） | [docs/continuo/submission.md](docs/continuo/submission.md) |
| 这个原型实现到哪、边界在哪、怎么跑 | [docs/continuo/README.md](docs/continuo/README.md) |
| Kimi Code's original README | [README.kimi-code.md](README.kimi-code.md) · [中文](README.kimi-code.zh-CN.md) |

## Run

```bash
pnpm install                       # Node >= 24.15; on newer Node add --config.engine-strict=false
pnpm run build:packages && pnpm -C apps/kimi-code run build
node apps/kimi-code/dist/main.mjs login
KIMI_CODE_EXPERIMENTAL_CONTINUO=1 node apps/kimi-code/dist/main.mjs web --no-open --port 58627
```

In a second terminal:

```bash
KIMI_PORT=58627 pnpm dev:continuo
```

Open `http://127.0.0.1:5180/#token=<token printed by kimi web>`, then create a project or open a folder of your own.

## Where the code is

| Layer | Path |
|---|---|
| Engine feature: project context, reminder bridge, `WorkspaceContext` / `ReportWorkspaceResult` / `Trajectory` tools, profiles | `packages/agent-core-v2/src/features/continuo/` |
| Server: task manager, deliverable verification, work-log and plan files, lines of work on session fork, read-only file routes | `packages/kap-server/src/continuo/`, `packages/kap-server/src/routes/continuo.ts` |
| Workbench UI | `apps/continuo/` |
| Tests | `packages/agent-core-v2/test/features/continuo/`, `packages/agent-core-v2/test/agent/permissionPolicy/` |

Continuo is gated behind the experimental flag `KIMI_CODE_EXPERIMENTAL_CONTINUO`; without it the fork behaves exactly like upstream Kimi Code.

## License

MIT, same as Kimi Code. Upstream copyright notices are kept in [LICENSE](LICENSE).

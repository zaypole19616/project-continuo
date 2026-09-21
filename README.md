# Continuo

**A local folder Agent that keeps working.** Continuo opens a folder, understands it before touching anything, keeps a selective and correctable ledger of what it learned, moves tasks forward, verifies what it delivered, and picks up where it left off the next time you open the folder.

Built on [Kimi Code](https://github.com/MoonshotAI/kimi-code): the engine, sessions, tools, permission chain and local server are reused unchanged; Continuo adds a workspace feature in the engine, a task manager and routes in the server, and its own workbench UI.

**一个住在本地文件夹里、把工作持续接住的 Agent。** 第一次打开先理解再动手；把有用的上下文有选择地积累成一份可纠正的账本；任务卡住时等你一句话接着干；关掉再开从上次的位置继续。

## Read first

| | |
|---|---|
| 说明文档（三个判断、产品、Harness、验证、限制） | [docs/continuo/submission.md](docs/continuo/submission.md) |
| 项目介绍与运行方式 | [docs/continuo/README.md](docs/continuo/README.md) |
| 四个产品判断（应用内页面） | `#/about` after starting the UI |
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

Open `http://127.0.0.1:5180/#token=<token printed by kimi web>` and pick a folder. `apps/continuo/demo-workspace/` is a synthetic demo folder; copy it somewhere writable first.

## Where the code is

| Layer | Path |
|---|---|
| Engine feature: context ledger, reminder bridge, `WorkspaceContext` / `ReportWorkspaceResult` tools, profiles | `packages/agent-core-v2/src/features/continuo/` |
| Server: task manager, deliverable verification, stale detection, read-only file routes | `packages/kap-server/src/continuo/`, `packages/kap-server/src/routes/continuo.ts` |
| Workbench UI | `apps/continuo/` |
| Tests | `packages/agent-core-v2/test/features/continuo/`, `packages/agent-core-v2/test/agent/permissionPolicy/` |

Continuo is gated behind the experimental flag `KIMI_CODE_EXPERIMENTAL_CONTINUO`; without it the fork behaves exactly like upstream Kimi Code.

## License

MIT, same as Kimi Code. Upstream copyright notices are kept in [LICENSE](LICENSE).

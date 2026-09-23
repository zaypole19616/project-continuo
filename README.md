# Continuo

**A local folder Agent that keeps working.** Continuo opens a folder, reads it before touching anything, works inside it, verifies what it delivered, and leaves a work log in the folder so the next task — and the next person — can pick up from there.

Built on [Kimi Code](https://github.com/MoonshotAI/kimi-code): the engine, sessions, tools, permission chain and local server are reused unchanged; Continuo adds a workspace feature in the engine, a task manager and routes in the server, and its own workbench UI.

**一个住在本地文件夹里、把工作持续接住的 Agent。** 第一次打开先读懂这个文件夹再动手；每件事做完核对产物、在 `work-log/` 留一份日志；下次接着干靠的是文件夹本身，不是另一份看不见的记忆。

## Why the name · 名字的由来

*Continuo* (basso continuo) is the continuous bass line in Baroque music: it runs under the whole piece without stopping and lets the soloists come and go on top of it. Here the folder and the person's judgment are that bass line; the lines of work that different plans lead to are the solos, and switching to another one never breaks the line underneath.

Continuo，通奏低音：巴洛克音乐里贯穿全曲、从不中断的低音声部，在下面托住整首曲子，让上面的独奏来来去去。在这里，文件夹和人的判断是那条不断的低音；不同方案走出的轨迹是上面来来去去的独奏，换一条，底下的线不断。

## Read first

| | |
|---|---|
| 产品介绍（产品判断、产品功能、如何体验） | [docs/continuo/2026-09-21-continuo-产品介绍.md](docs/continuo/2026-09-21-continuo-产品介绍.md) |
| 这个原型实现到哪、边界在哪、怎么跑 | [docs/continuo/README.md](docs/continuo/README.md) |
| Kimi Code's original README | [README.kimi-code.md](README.kimi-code.md) · [中文](README.kimi-code.zh-CN.md) |

## 功能在产品里哪里看

| 功能 | 在产品里哪里看 | 对应文档 |
|---|---|---|
| 工作记录 | 项目里的 `work-log/`；对话开头 Agent 发来的「我已经了解了这个项目」（读过的文件、带来源的要点） | Orderliness、Clarity |
| 事项 | 了解完和每件事做完时的建议（✓ 立即执行 / ✗ 划掉 / ≡+ 加入待办）；右上角「事项」；输入框旁的权限 | Proactiveness |
| 决策 | 对话里的决策卡：选择取决于什么，每个方案的依据、风险和适合情况；可以要更多方向，或自己写 | 1.2 第一点 |
| 轨迹 | 右上角「轨迹」：回看执行过程，回到当时的决策换一条路，在轨迹之间切换；导出接口 | Clarity；1.2 第二点 |

首次打开会弹出三页功能介绍，启动页的「功能介绍」可以重看。每一行怎么试，见 [产品介绍 §3 如何体验](docs/continuo/2026-09-21-continuo-产品介绍.md#3-如何体验)。

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

Open `http://127.0.0.1:5180/#token=<token printed by kimi web>`, then open the sample folder `examples/q4-plan` (synthetic materials for a Q4 campaign; the agent writes its logs and outputs into it, so copy it elsewhere first if you want the checkout clean), create a project, or open a folder of your own.

## Where the code is

| Layer | Path |
|---|---|
| Engine feature: project context, reminder bridge, `WorkspaceContext` / `ReportWorkspaceResult` / `Trajectory` tools, profiles, the per-line file guard, trajectory export | `packages/agent-core-v2/src/features/continuo/` |
| Server: task manager, deliverable verification, work-log and plan files, lines of work on session fork (a shared folder where one line never overwrites another's files; a worktree per line for git projects), plans written in parallel, read-only file routes, export route | `packages/kap-server/src/continuo/`, `packages/kap-server/src/routes/continuo.ts` |
| Workbench UI | `apps/continuo/` |
| Tests | `packages/agent-core-v2/test/features/continuo/`, `packages/agent-core-v2/test/agent/permissionPolicy/` |

Continuo is gated behind the experimental flag `KIMI_CODE_EXPERIMENTAL_CONTINUO`; without it the fork behaves exactly like upstream Kimi Code.

## License

MIT, same as Kimi Code. Upstream copyright notices are kept in [LICENSE](LICENSE).

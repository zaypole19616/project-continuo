# Continuo

**Continuo** is a local Agent that lives in one folder: it reads the folder before its first task, works inside it, verifies what it delivered, and leaves a work log in the folder so the next task starts from where the last one stopped.

## Why the name

*Continuo* (basso continuo) is the continuous bass line in Baroque music. It runs underneath the whole piece without stopping, holds the harmony together, and lets the soloists come and go on top of it.

That is the job this Agent is meant to do for knowledge work: the work should be **continuously held**, not restarted at every conversation. Materials, tasks and results live in one folder; what was learned and done stays in that folder; and the person can always see, and correct, the line it is playing.

## 项目名说明

Continuo，通奏低音。巴洛克音乐里贯穿全曲、从不中断的低音声部，它在下面托住整首曲子，让上面的独奏来来去去。

这个 Agent 想做的就是这件事：让工作被持续接住，而不是每次对话都从头开始。资料、任务、成果放在同一个文件夹里；做过什么就留在这个文件夹里；人随时能看见它在演奏哪一条线，并且能纠正。

## Relationship to Kimi Code

This repository is a fork of [MoonshotAI/kimi-code](https://github.com/MoonshotAI/kimi-code). Continuo reuses the engine, sessions, tools, permissions, questions/approvals, file history and the local server as they are, and adds a workspace feature plus a small front-end on top.

本文是实现说明：产品判断与功能定义见 [submission.md](submission.md)，这里写的是**做到了哪一步、边界在哪、怎么跑**。

---

## 1. 产品：一次完整的使用

**打开项目：先读懂，不动手。** 一个只读 profile 的 Agent 扫描目录，先读 AGENTS.md / README 这类指引文件（如果 `work-log/` 里已有记录，也读最近几份），再沿着指引抽样几份材料，然后用一次 `WorkspaceContext` 调用记下两样东西：一段**这个文件夹是什么**（两三句：做什么用的、输入在哪、产物去哪、什么是归档），以及若干条**项目要点**（一句一条：命名约定、已经定下的决定、某类材料在哪）。每条要点都必须指向它来自哪个文件；说不出来源的不记。了解期间你可以浏览文件，也可以直接交代事情。

**交代事情：带着这些干活。** 一个项目只有一个会话，你说的每一件事是这个会话里的一轮。Harness 在每一步把「这个文件夹是什么 + 项目要点 + 当前这件事 + 你中途补充的要求」编成一段参考数据注入，压缩之后重新注入。它需要一个材料里没有的决定时，用 AskUserQuestion 停下来问；写文件走 Kimi Code 原有的审批链。

**收尾：核验，然后留下日志。** 一轮结束时 Harness 核验交付物：Agent 用 `ReportWorkspaceResult` 上报路径，同时 Harness 自己记录了它实际写过哪些文件，两边合并后逐个 stat，才决定是「做完了」还是「还差一点」。接着 Harness 把这件事写成一份工作日志，放进项目里的 `work-log/work-log-YYYY-MM-DD-任务名.md`：时间、状态、读过的文件、产出文件、原始要求、每一轮的过程（读了什么、写了什么、回了什么）、结果、未完成、建议的下一步。**这份日志是项目自己的文件**，你能在文件区看到它、改它、删它。

**下次打开：从文件夹里接着干。** 不会重跑初始化，正在跑的任务标记为中断可续。过去做过什么不靠一份看不见的记忆，而是靠文件夹本身：worker 的第一条规则就是先搜文件夹、读相关的 `work-log/`，文件夹里已经写着的事不许再问你。

**纠正它。** 它理解错了，就在对话里说一句（"以后 H1 以 Northwind 开头"）。当前会话立刻照办，这句话也会进入这件事的工作日志；下次打开时它从日志里读到。没有需要你去确认的推断条目，也没有第二个地方要维护。

### 界面：一个 Finder，右边挂着对话

打开产品是一张启动卡：左边「新建项目」、右边「打开已有项目」，下面是最近打开的项目（只有名字和路径）。第一次启动先弹一个四步引导（只有"下一步"），结束直接回到启动卡。

进入项目后是一整块：左边是文件窗口（面包屑、搜索、网格 / 列表切换、预览；产物可以和这次动手前的那一版对比，来自 Kimi Code 的 turn 级 file history），右边挂着对话框，两者同一底色、中间没有分界线，中缝可以左右拖动改宽度（双击回到默认）。对话框右上角三个按钮：

| | 内容 |
|---|---|
| 对话 | 这个项目唯一的会话。每件事做完，收尾卡跟在那一轮后面：做出的文件、没做到的、读过的资料；模型认为还有一步值得做时，多一张「接下来，也许值得做这一步」，点了才会开始 |
| 事项 | 只列还没做完的事（进行中、等你回答或批准、等你回复、已暂停、被打断、没做完、还差一点），每条带上能做的动作；做完就从这里消失 |
| 记录 | 项目里 `work-log/` 的全部日志，按时间倒序 |

界面只说人话；三个判断的名字只在首次启动的引导里出现一次。视觉取自 Kimi Code 自己的设计变量：官方 web UI 以预构建包随仓库发布（`apps/kimi-code/dist-web`），`apps/continuo/src/theme.css` 的颜色、圆角、输入框圆角 32px、发送按钮都取自它的 `assets/index-*.css`；深浅色默认跟随系统，右上角可切换。交互控件用 shadcn/ui（Radix）。

## 2. Harness：继承什么、新增什么、为什么

### 2.1 直接继承 Kimi Code 的部分

| 模块 | 用法 |
|---|---|
| Agent loop（XState 双状态机、取消、steer） | 每件事就是这个会话里的一个普通 turn；暂停 = `loop.cancel`，续接 = 同一会话再提交一条 prompt |
| Reminder 机制 | 项目上下文注入走 `IAgentReminderService`：每步注入、压缩后重注、provider 出错跳过不炸 turn |
| Profile 与 Feature seam | 两个新 profile（只读的 `continuo-init`、带上报工具的 `continuo-worker`）、两个新工具、一个 App 级存储和一个 Agent 级桥接服务，全部通过 `registerFeature` 挂进去，核心引擎零改动 |
| 权限策略链 | 文件写入仍走原有审批；只在默认放行名单里加了 Continuo 自己的两个记录工具（见 2.3） |
| 问题 / 审批 / 会话快照 / WS 事件流 | 前端直接复用 `/api/v1` 的 questions、approvals、snapshot 和 WebSocket，没有另造协议 |
| turn 级 file history | 产物「对比上一版」直接取 `/sessions/{id}/file-history/content?turn_id=…&phase=start` |
| 持久化 | 项目状态存在引擎自带的 `IAtomicDocumentStore`，随会话目录一起落盘 |

### 2.2 新增的部分

| 新增 | 落点 | 解决什么 |
|---|---|---|
| 项目上下文（一段理解 + 若干条有来源的要点）与每步注入 | `packages/agent-core-v2/src/features/continuo/` | AGENTS.md 是一份人写的静态文件；这里的上下文是 Agent 读出来的，每条都指向来源文件，纠正它只需要在对话里说一句 |
| 打开项目时的只读理解任务 | `kap-server/src/continuo/taskManager.ts` `startInit` + `continuo-init` profile | Kimi Code 的 `/init` 是一次性写 AGENTS.md 的子代理；Continuo 的理解有来源，并且不写用户的文件 |
| 交付核验 | `settleTurn`：上报路径 ∪ 观测到的写入 → 逐个 stat | "模型说完成"不等于完成；Agent 忘了上报也不丢（验证里就出现过一次没上报，靠观测写入兜底） |
| 「等你回复」状态 | `settleTurn` 无写入无上报的分支 + `:reply` 动作 | 模型有时不用 AskUserQuestion 而是一句话问你，若照常标"完成"界面就撒谎了 |
| 一个项目一个会话 | `createUserTask` 复用上一件事的 session | 同一个文件夹里的事本来就是连着的；没有"新建对话"，也就不存在"这条信息在哪个对话里"的问题 |
| 按轮记录 + 工作日志落盘 | `recordRound` / `writeWorkLog` | 过程要留在项目里，而不是留在应用状态里：换台机器、换个人、换个 Agent 打开这个文件夹，`work-log/` 都还在 |
| 并发打开合并 | `open()` 的 in-flight map | 前端严格模式会把 open 发两次，修之前跑出了两个初始化任务 |
| Finder + 对话 + 事项 + 记录 | `apps/continuo/`（Vite + React，独立于官方 web UI） | 显性层只做三件事：需要你时才打断、打断带上下文、随时可看可接管 |

### 2.3 一条权限策略的取舍

`WorkspaceContext` 和 `ReportWorkspaceResult` 加进了默认放行名单。理由：它们写的是 Continuo 自己的项目状态，不是用户文件，属于可撤销操作；而每次都弹审批会把"记一条约定"这种最该无感的动作变成打扰。文件写入、Shell 仍然按原策略链审批。

### 2.4 与 Kimi Code 已有机制的差异

- **`/init`**：一次性、由模型写 AGENTS.md、无来源。Continuo 的初始化是只读任务，产出带来源的理解与要点，不动用户的文件。
- **goal feature**：跨 turn 的自动续跑与预算。Continuo 不用 goal，续接始终由人触发（回复、继续），避免"自动续跑"和"用户暂停"打架。
- **fileHistory**：按 turn 记录 Write/Edit 目标的快照，是撤销的安全网。Continuo 借同一来源（工具事件）做交付核验和产物对比。
- **AGENTS.md 提醒**：进入子目录时提示存在指引文件。Continuo 在打开项目时就把指引文件读成上下文，并且把每件事写回 `work-log/`。

## 3. 已知限制

- 项目要点只在打开项目那次读出来；之后指引文件改了，要等你在对话里说一句，或者删掉项目状态重新打开。
- 兜底只覆盖 Write/Edit：Shell 里的写入观测不到。
- 同一个项目同一时间只跑一件事。
- 工作日志由 Harness 从任务状态生成，不是模型按 AGENTS.md 自己写的；v4 里的 STAR、三分支 / worktree、轨迹反馈闭环都还没做。
- 每一轮只记到 20 轮、每轮 20 个文件路径，超出截断。
- 前端用 1.5 秒轮询取项目状态变化，没有把状态变更接进 WebSocket。
- 文件工作区只读：能浏览目录、预览文本和 Markdown，不能在界面里编辑或上传文件。
- 功能在实验开关 `KIMI_CODE_EXPERIMENTAL_CONTINUO` 后面，默认关闭。

## 4. 运行方式

环境：Node ≥ 24.15、pnpm 10.33。更新的 Node 需要 `pnpm install --config.engine-strict=false`。

```bash
pnpm install
pnpm run build:packages && pnpm -C apps/kimi-code run build
node apps/kimi-code/dist/main.mjs login            # Kimi 账号设备码登录
KIMI_CODE_EXPERIMENTAL_CONTINUO=1 node apps/kimi-code/dist/main.mjs web --no-open --port 58627
```

启动日志会打印 `#token=...`。另开一个终端：

```bash
KIMI_PORT=58627 pnpm dev:continuo
```

打开 `http://127.0.0.1:5180/#token=<上面的 token>`，新建一个项目，或打开自己的文件夹。

代码位置：引擎侧 `packages/agent-core-v2/src/features/continuo/`，服务侧 `packages/kap-server/src/continuo/`（含只读文件接口 `files.ts`）与 `routes/continuo.ts`，前端 `apps/continuo/`（`pages/Launcher` 启动卡，`components/Finder` 文件窗口 + `components/Drawer` 对话抽屉），测试 `packages/agent-core-v2/test/features/continuo/`。

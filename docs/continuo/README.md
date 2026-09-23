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

**收尾：核验，然后留下日志。** 一轮结束时 Harness 核验交付物：Agent 用 `ReportWorkspaceResult` 上报路径，同时 Harness 自己记录了它实际写过哪些文件，两边合并后逐个 stat，才决定是「做完了」还是「还差一点」。接着 Harness 把这件事写成一份工作日志，放进项目里的 `work-log/work-log-YYYY-MM-DD-分类-任务名.md`，格式就是下面「信息的统一口径」那一节：STAR 四段，加上 Meta Data、原始任务描述、逐轮的工作记录、最终产出表和备注。**这份日志是项目自己的文件**，你能在文件区看到它、改它、删它。

**下次打开：从文件夹里接着干。** 不会重跑初始化，正在跑的任务标记为中断可续。过去做过什么不靠一份看不见的记忆，而是靠文件夹本身：worker 的第一条规则就是先搜文件夹、读相关的 `work-log/`，文件夹里已经写着的事不许再问你。

**方向不明时：给方案，由你选。** 如果材料定不了怎么做、而不同做法会得出不同的产物（比如 Q4 目标按哪个口径定），Agent 不替你挑，也不只问一句，而是开一个**决策点**：若干个真正不同的方案，每个写清依据和风险，完整内容落成项目里的方案文件（`work-log/plan-日期-分类-任务名-方案A.md`），然后停下来。你在对话里的决策卡上点「走这条」，它就按那个方案接着做；觉得不够就点「再来几个」，新方案追加在后面，旧的不删；它判断已经没有真正不同的方向时，会说明为什么并把需要你定的那个问题抛回来。你也可以不选，直接在输入框里说你想怎么做。

**方案需要各自去查时：分头写。** 如果每个方案都得单独翻不同的材料、各算各的（比如按用户、竞品、成本三个角度分别定价），主 Agent 先列出两到四个角度和理由，Harness 把主会话在同一个点上各复制一份，每份只写一个方案。复制出来的会话前缀一字不差，差别只在最后一条消息，所以它们共用主会话已经缓存好的那一段。写方案的只能读材料，不能改文件、不能跑命令、不能打扰你；拿不准某件事时才去问写其他方案的那个，发现和别人的方案一样就撤回并注明和哪个重复。决策卡上能看到哪几个还在写，都写完了才能选；每个最多 8 步，超了就停下，记成没写完。

**换一条路，原来的不动。** 选完之后想试另一个方案，点那个方案的「走这条」：Harness 用 Kimi Code 的会话 fork 从**决策点之前**复制出一条新轨迹，新会话里没有上一个方案的执行过程；同时把项目文件在决策点那一刻的样子复制成这条轨迹自己的目录（`.continuo/lines/<轨迹>/`），新方案之后的读写都在这份副本里，原来的文件一个字节都不动。想回到某件事之后重来，在轨迹树上点那个节点的「从这里继续」，同样是复制出一条新轨迹，文件取那件事刚做完时的样子。切换轨迹时，文件区显示的是那条轨迹自己的文件，工作日志也各记各的。不要的方案可以「放弃」并写一句原因。对话框只显示当前这条轨迹，没有会话切换器；所有分叉都在「轨迹」里。

**纠正它。** 它理解错了，就在对话里说一句（"以后 H1 以 Northwind 开头"）。当前会话立刻照办，这句话也会进入这件事的工作日志；下次打开时它从日志里读到。没有需要你去确认的推断条目，也没有第二个地方要维护。

### 信息的统一口径

同一件事在日志、记录、事项、轨迹里必须长成一个样子。口径取自这个项目自己的 [Agent 工作规范](submission.md)，一处定义、四处复用：

| | 规则 |
|---|---|
| 层级 | 日期 → 事项（一个任务）→ 子事项（对话 N，一轮一条） |
| 标题 | 只写**任务名**（2–6 字，由 Agent 随结果一起上报），完整那句话退到「原始任务描述」；任何地方显示任务，显示的都是这个任务名 |
| 文件名 | Continuo 自己的日志：`work-log/work-log-YYYY-MM-DD-分类-任务名.md`，分类是小写 ASCII（项目有分类词表就从词表取）。Agent 写的产物按**项目自己的约定**命名（项目没约定时同样用 `日期-分类-任务名.扩展名`） |
| 顺序 | 标题 → STAR（S 背景 / T 任务 / A 过程 / R 结果）→ Session（Meta Data → 原始任务描述 → 工作记录 → 最终产出 → 备注）。轨迹节点展开后是同一个顺序 |
| 时间 | 日期 `YYYY-MM-DD`，时刻 `HH:MM`，不写「今天」「刚刚」 |
| STAR | 任务进行中 A/R 是 `⏳ 待阶段完成`，任务收尾时由 Harness 按实际发生的事补全；例行任务（了解项目）豁免 STAR |

### 界面：一个 Finder，右边挂着对话

打开产品是一张启动卡：左边「新建项目」、右边「打开已有项目」，下面是最近打开的项目（只有名字和路径）。第一次启动先弹一个四步引导（只有"下一步"），结束直接回到启动卡。

进入项目后是一整块：左边是文件窗口（面包屑、搜索、网格 / 列表切换、预览；产物可以和这次动手前的那一版对比，来自 Kimi Code 的 turn 级 file history），右边挂着对话框，两者同一底色、中间没有分界线，中缝可以左右拖动改宽度（双击回到默认）。对话框右上角三个按钮：

| | 内容 |
|---|---|
| 对话 | 当前这条轨迹的会话。每件事做完，收尾卡跟在那一轮后面：做出的文件、没做到的、读过的资料；模型认为还有一步值得做时，多一张「接下来，也许值得做这一步」，点了才会开始。决策点以一张卡出现在它发生的位置 |
| 事项 | 只列当前轨迹上还没做完的事（进行中、等你选方案 / 回答 / 批准 / 回复、已暂停、被打断、没做完、还差一点），每条带上能做的动作；做完就从这里消失 |
| 轨迹 | 这个项目的树：主干是当前轨迹上的事项和决策点，别的方案和另起的轨迹作为分叉挂在它们离开主干的地方。可缩放：缩小只剩名字和状态，中间档多一行（产物或依据），放大后每个节点展开成 背景 / 任务 / 过程 / 结果；在任何一档点一个节点，只展开那一个。切换、走这条、从这里继续、放弃都在这里做 |

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
| 会话 fork | 换方案和从某件事之后重来都走 `ISessionManager.fork({ sourceSessionId, turnIndex })`：按用户可见的 turn 切片复制出新会话，源会话不动；Continuo 只记轨迹这一层语义 |
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
| 决策点与轨迹 | 引擎侧 `Trajectory` 工具（`propose` / `expand` / `list`）与 `trajectory.ts`；服务侧 `choosePlan` / `expandPlans` / `abandonPlan` / `activateTrajectory` / `forkAfterTask` | 方向的判断留给人，而且判断的那一刻被完整记下：条件、候选及依据、选了哪个、执行到哪、放弃了哪个以及为什么。轨迹只追加不覆盖，每条都能单独读、单独切回去 |
| 分头写方案 | `Trajectory` 的 `explore`（主 Agent）与 `submit` / `ask` / `withdraw`（写方案的副本）；服务侧 `startExploration` / `finishExploration` | 需要各自调查的方案由各自的副本去写，彼此只在有疑问时对话，重复的合并；fork 时把项目根会话的缓存键带过去（会话元数据 `promptCacheKey`），副本命中同一段前缀缓存 |
| 每条轨迹一个目录 | `kap-server/src/continuo/lines.ts`（快照 + `git worktree`）；引擎侧 `guard.ts` | 新方案不覆盖旧方案的产物，靠的是文件系统：分支轨迹在自己的副本目录里读写，越界的文件读写和不在本目录启动的命令在执行前被拒 |
| 分支的上下文 | `contextBundle.ts` | 当前轨迹上做过的事每件一行（细节在它自己的工作日志里）；其他方案一句话说明它在别的轨迹上的去向，附方案文件地址，需要时再读 |
| 轨迹导出 | `export.ts` + `GET /api/v1/workspaces/{id}/continuo/export` | 每条轨迹一份样本（上下文、逐轮输入输出、产物后来有没有被改、决策点上各方案的结局），外加由选择、切换、放弃得出的方案偏好对 |
| Finder + 对话 + 事项 + 轨迹 | `apps/continuo/`（Vite + React，独立于官方 web UI） | 显性层只做三件事：需要你时才打断、打断带上下文、随时可看可接管 |

### 2.3 一条权限策略的取舍

`WorkspaceContext` 和 `ReportWorkspaceResult` 加进了默认放行名单。理由：它们写的是 Continuo 自己的项目状态，不是用户文件，属于可撤销操作；而每次都弹审批会把"记一条约定"这种最该无感的动作变成打扰。文件写入、Shell 仍然按原策略链审批。

### 2.4 与 Kimi Code 已有机制的差异

- **`/init`**：一次性、由模型写 AGENTS.md、无来源。Continuo 的初始化是只读任务，产出带来源的理解与要点，不动用户的文件。
- **goal feature**：跨 turn 的自动续跑与预算。Continuo 不用 goal，续接始终由人触发（回复、继续），避免"自动续跑"和"用户暂停"打架。
- **fileHistory**：按 turn 记录 Write/Edit 目标的快照，是撤销的安全网。Continuo 借同一来源（工具事件）做交付核验和产物对比。
- **AGENTS.md 提醒**：进入子目录时提示存在指引文件。Continuo 在打开项目时就把指引文件读成上下文，并且把每件事写回 `work-log/`。

## 3. 已知限制

- 项目要点只在打开项目那次读出来；之后指引文件改了，要等你在对话里说一句，或者删掉项目状态重新打开。
- 交付核验的「观测到的写入」只覆盖 Write/Edit：Shell 里的写入观测不到。
- 同一个项目同一时间只跑一件事。
- 工作日志由 Harness 从任务状态生成，不是模型按 AGENTS.md 自己写的；STAR 的 A/R 在任务收尾时由 Harness 按实际发生的事补全，不等用户确认阶段完成。
- 轨迹目录用 git 复制：项目本身是 git 仓库时，快照用临时索引生成、挂在 `refs/continuo/` 下，副本是 `git worktree`，不动你的分支、暂存区和提交；不是 git 仓库时，用 `.continuo/git` 里的私有仓库。被 `.gitignore` 忽略的文件（如 `node_modules`、`.env`）不会进副本；大文件会在磁盘上多存一份。机器上没有 git 或快照失败时，这条轨迹退回共用项目目录，此时拦截只保护其他轨迹上报过的产物。
- 拦截发生在工具执行前：Read / Write / Edit / Grep / Glob 的路径必须在本轨迹目录内，Shell 命令必须从本轨迹目录启动。命令里用绝对路径故意写到目录外，拦不住；这不是沙箱。
- 分头写方案：最多 4 个角度，每个最多 8 步；写方案的副本不能问你，只能问彼此。各副本的步数和 token 用量记在项目状态和导出里，界面上不显示。
- 轨迹导出只有接口，没有界面入口。
- 「再来几个」只在决策点还没选的时候可用；「放弃」只在选定之后出现在其他方案上。
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

代码位置：引擎侧 `packages/agent-core-v2/src/features/continuo/`，服务侧 `packages/kap-server/src/continuo/`（含只读文件接口 `files.ts`、轨迹目录 `lines.ts`）与 `routes/continuo.ts`（含导出接口 `GET /api/v1/workspaces/{id}/continuo/export`），前端 `apps/continuo/`（`pages/Launcher` 启动卡，`components/Finder` 文件窗口 + `components/Drawer` 对话抽屉），测试 `packages/agent-core-v2/test/features/continuo/`、`packages/kap-server/test/continuoLines.test.ts`、`apps/continuo/src/lib/trajectory.test.ts`。

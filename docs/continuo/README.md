# Continuo

**Continuo** is a local Agent that keeps working inside your folder: it builds and maintains a selective, correctable understanding of the workspace, moves tasks forward on its own when it can, and shows you what it is doing on a board you can read at a glance.

## Why the name

*Continuo* (basso continuo) is the continuous bass line in Baroque music. It runs underneath the whole piece without stopping, holds the harmony together, and lets the soloists come and go on top of it.

That is the job this Agent is meant to do for knowledge work: the work should be **continuously held**, not restarted at every conversation. Materials, tasks, progress and results live in one workspace; useful context is kept, updated and reused; when a task stalls, the Agent picks it up again; and the person can always see, and correct, the line it is playing.

## 项目名说明

Continuo，通奏低音。巴洛克音乐里贯穿全曲、从不中断的低音声部，它在下面托住整首曲子，让上面的独奏来来去去。

这个 Agent 想做的就是这件事：让工作被持续接住，而不是每次对话都从头开始。资料、任务、进度、成果放在同一个工作空间里；有用的上下文被有选择地保留、更新和取用；任务卡住时它接着推进；人随时能看见它在演奏哪一条线，并且能纠正。

## Relationship to Kimi Code

This repository is a fork of [MoonshotAI/kimi-code](https://github.com/MoonshotAI/kimi-code). Continuo reuses the engine, sessions, tools, permissions, questions/approvals, file history and the local server as they are, and adds a workspace feature plus a small front-end on top. What is inherited and what is new is documented below.

---

# 说明文档

## 1. 三句判断

这个原型建立在三个对 2026 年 Agent 走向的判断上，每一句都对应原型里的一处具体做法。

1. **长程、本地、真实文件的任务在商业上可行了，瓶颈从模型移到 Harness。** K3 这一代把长上下文和连续几十小时任务当成目标场景，缓存命中价把"每一步都重新交代背景"从贵变成可承受。于是 Harness 的价值不再是省 token，而是**决定每一步给模型看什么**：上下文的选择、维护和失效，比 prompt 本身更重要。Continuo 把这件事做成了一个有来源、有状态、可纠正的 context 账本，每一步注入，压缩后重新注入。
2. **模型会内化流程性知识，不会内化的是用户的具体资产、权限边界、外部验证和跨会话的延续。** 原型只在这四层上花力气：文件夹里的约定和决定（资产）、什么工具免审批什么要问（边界）、宣称的交付物是否真的存在（验证）、重开之后从哪里接着干（延续）。不为模型三个月后自己就会做好的事搭脚手架。
3. **交互的重心从"对话"移到"资产"，人不再复述背景，而是纠正 Agent 的理解。** 显性层只保留三件事：只在需要决定时打断、打断时带上下文、进度随时可看可接管。隐性层才是主体：交出任务之后，Agent 从哪里拿 context、按什么约定落位、结果去哪里核验、下次打开怎么续上。

## 2. 产品：它做什么

Continuo 面向一个本地文件夹。打开它，会发生三件事。

**第一次打开：先理解，不动手。** 一个只读 profile 的 Agent 扫描目录结构，优先读 README / AGENTS.md 这类指引文件，再抽样几份材料，然后用 `WorkspaceContext` 工具记录：

- 一段"工作空间理解"（这个文件夹是干什么的、输入在哪、产物去哪、什么是归档）；
- 若干条 context 条目，分五类：约定 / 背景 / 决定 / 进度 / 材料。**来自指引文件的条目直接生效，Agent 自己的推断只是候选**，等人确认。每条都带来源文件。

**交代任务：带着有效 context 干活。** 每个任务开一个独立会话，Harness 在每一步把有效 context 编成一段不超过 6000 字的参考数据注入（决定 > 约定 > 进度 > 背景 > 材料），压缩之后重新注入。任务结束时 Harness 核验交付物：Agent 用 `ReportWorkspaceResult` 上报路径，同时 Harness 自己记录了它实际写过哪些文件，两边合并后逐个检查文件是否存在，才决定是"完成"还是"待复核"。完成后自动追加一条"进度"条目，下次任务就知道这件事做过了。

**卡点、纠正、重开。** Agent 需要决定时提 AskUserQuestion 或等审批，任务进"需要你"列；如果它只是用一句话问了你，Harness 把任务标成"等你回复"而不是"完成"，你的回复送回同一个会话续接。你可以在 Context 面板里确认、纠正、停用任何一条：纠正会生成一条新条目替代旧条目（origin 变为"你确认的"），下一个任务立刻按新约定行事。关掉再打开：不会重跑初始化，正在跑的任务被标为中断可续；如果某条 context 依赖的源文件在两次打开之间变了，这条会被标成"来源已变化，暂不生效"，等你说"仍然有效"或让 Agent 重新看。

看板只有四列：待执行 / 进行中 / 需要你 / 已结束。它和工作日志读的是同一份事件账本，不是另一套状态。

### 界面：三栏，一块材质

主窗口沿用桌面工作台的三栏模型：左栏导航（工作空间、文件树、任务列表），中栏文件工作区（目录表格、文件预览；文件旁标出「指引」和「产物」，点产物能跳到产出它的那次任务），右栏 Agent 面板（对话 / 看板 / Context / 日志四个页签，底部是输入框）。三栏共用一块中性材质，用分隔线而不是三张卡片区分；文件区是视觉焦点，颜色只留给状态和文件类型；左右两栏都能收起，亮暗主题跟随系统。这套结构和设计原则参考了 Kuse Desktop 的公开产品文档，代码全部独立实现。

### Demo 剧本（用仓库自带的演示文件夹）

`apps/continuo/demo-workspace/` 是一个虚构公司 Northwind 的季度复盘文件夹，全部数据为合成数据。

1. **打开**：Agent 读 README 和四份材料，产出理解；README 里的两条约定（产物放 drafts/ 且按日期命名；中文、先结论后数据、数字标来源）直接生效；"Q2 财务关键数字"等三条推断进入待确认。
2. **纠正**：把命名约定改成"主题一律用英文小写连字符"。
3. **任务**：「起草 Q2 经营复盘初稿」。Agent 写出 `drafts/2026-09-20-q2-review.md`，文件名遵守刚才的纠正，正文遵守 README 的风格约定，每个数字标了来源文件。
4. **卡点**：「给初稿补一节下季度价格动作，按我的决定写」。材料里没有这个决定，Agent 停下来问；你回复决定，任务在同一会话续接。中途点"停止"再点"继续"，它先重读文件确认没有重复改动，再完成剩余部分。
5. **重开**：改一下材料文件后重新打开。初始化不重跑；依赖该材料的背景条目被标为来源已变化；进度条目告诉下一个任务初稿已经存在。

## 3. Harness：继承什么、新增什么、为什么

### 3.1 直接继承 Kimi Code 的部分

| 模块 | 用法 |
|---|---|
| Agent loop（XState 双状态机、取消、steer） | 每个 Continuo 任务就是一个普通会话里的普通 turn；暂停 = `loop.cancel`，续接 = 同一会话再提交一条 prompt |
| Reminder 机制 | context 注入走 `IAgentReminderService`：每步注入、压缩后重注、provider 出错跳过不炸 turn |
| Profile 与 Feature seam | 两个新 profile（只读的 `continuo-init`、带记录工具的 `continuo-worker`）、两个新工具、一个 App 级存储和一个 Agent 级桥接服务，全部通过 `registerFeature` 挂进去，核心引擎零改动 |
| 权限策略链 | 文件写入仍走原有审批；只在默认放行名单里加了两个 Continuo 自己的记录工具（见 3.3） |
| 问题 / 审批 / 会话快照 / WS 事件流 | 前端直接复用 `/api/v1` 的 questions、approvals、snapshot 和 WebSocket，没有另造协议 |
| 持久化 | 工作空间账本存在引擎自带的 `IAtomicDocumentStore`，随会话目录一起落盘 |

### 3.2 新增的部分

| 新增 | 落点 | 解决什么 |
|---|---|---|
| Context 账本（条目有来源、范围、状态、修订号、替代关系） | `packages/agent-core-v2/src/features/continuo/` | AGENTS.md 是一份人写的静态文件；这里的 context 是**有选择地积累**出来的，能纠正、能失效、能追溯到哪次任务或哪个文件 |
| 首次打开的只读理解任务 | `kap-server/src/continuo/taskManager.ts` `startInit` + `continuo-init` profile | Kimi Code 的 `/init` 是一次性写 AGENTS.md 的子代理；Continuo 的理解有来源、有候选 / 生效之分、能被后续任务持续修正 |
| 交付核验 | `finishTurn`：上报路径 ∪ 观测到的写入 → 逐个 stat | "模型说完成"不等于完成；Agent 忘了上报也不丢（这次验证里就有一次没上报，靠观测写入兜底） |
| "等你回复"状态 | `finishTurn` 无写入无上报的分支 + `:reply` 动作 | 模型有时不用 AskUserQuestion 而是一句话问你，若照常标"完成"看板就撒谎了 |
| 源文件指纹与 stale | `refreshSourceFingerprints`：打开时与任务结束时按 size+mtime 比对 | 材料变了，基于旧材料的 context 不该继续生效 |
| 自动进度条目 | 任务完成时由 Harness 写入，不靠模型 | 下一个任务、下一次打开知道"哪些已经做过、产物在哪" |
| 并发打开合并 | `open()` 的 in-flight map | 前端严格模式会把 open 发两次，修之前跑出了两个初始化任务 |
| 看板 / Context 面板 / 工作日志 | `apps/continuo/`（Vite + React，独立于官方 web UI） | 显性层只做三件事：需要你时才打断、打断带上下文、随时可看可接管 |

### 3.3 一条权限策略的取舍

`WorkspaceContext` 和 `ReportWorkspaceResult` 加进了默认放行名单。理由：它们写的是 Continuo 自己的账本，不是用户文件，每一条都能在面板里停用或纠正，属于可撤销操作；而每次都弹审批会把"记录一条约定"这种最该无感的动作变成打扰。文件写入、Shell 仍然按原策略链审批，验证里 Agent 想顺手改一份旧稿的 H1，被拒绝后停手并如实写进了"未解决"。

### 3.4 与 Kimi Code 已有机制的差异

- **`/init`**：一次性、由模型写 AGENTS.md、无来源无生命周期。Continuo 的初始化是只读任务，产出结构化条目，来源可查，后续任务持续修正。
- **goal feature**：跨 turn 的自动续跑与预算。Continuo 的任务不用 goal，续接始终由人触发（回复、继续），避免"自动续跑"和"用户暂停"打架。
- **fileHistory**：按 turn 记录 Write/Edit 目标的快照，是撤销的安全网。Continuo 只借用同一来源（工具事件）做交付核验，不把它当审查对象。
- **AGENTS.md 提醒**：进入子目录时提示存在指引文件。Continuo 把指引文件的内容变成生效条目，并在源文件变化时失效。

## 4. 验证结果（2026-09-20，Kimi 账号，模型 kimi-for-coding）

| 环节 | 结果 |
|---|---|
| 首次打开（3 个文件夹、6 个文件） | 约 60 秒完成，4 步；产出理解、2 条来自 README 的生效约定、3 条待确认推断 |
| 纠正后行为 | 命名约定改为英文 slug 后，下一任务写出 `drafts/2026-09-20-q2-review.md`，正文中文、先结论、数字标来源 |
| 卡点 → 回复 → 续接 | 材料缺定价决定时 Agent 停下询问；回复后同一会话续接；中途暂停再继续，Agent 先重读文件再改，无重复写入 |
| 交付核验 | 一次 Agent 未上报，靠观测写入补齐并核验存在；一次上报 1 个交付物 + 1 个未解决项，进入待复核，可手动标记完成 |
| 规矩记录 | 「以后 H1 以 Northwind 开头」被以 `apply_user_instruction` 记录为生效约定，免审批；随后写出的摘要标题遵守 |
| 越界拒绝 | Agent 想顺手改旧稿被拒绝后停手，未重试 |
| 重开 | 打开计数递增、不重跑初始化；修改材料后依赖它的条目标为 stale，可一键恢复 |
| 自动化测试 | 新增 9 个单测（context 编排、有效条目规则、存储修订与并发）+ 默认放行策略 2 个用例；`tsc`、`oxlint --type-aware`、`check-no-comments` 通过 |

## 5. 已知限制

- 模型不总是用 AskUserQuestion 提问、不总是调用上报工具；Harness 用"等你回复"和观测写入兜底，但兜底只覆盖 Write/Edit，Shell 里的写入观测不到。
- 同一工作空间同一时间只跑一个用户任务。
- stale 只按文件大小和修改时间判断，不做内容 diff。
- 理解与条目的语言跟随工作空间文档，靠 prompt 约束，不强制。
- 前端用 1.5 秒轮询取账本变化，没有把账本变更接进 WebSocket。
- 文件工作区只读：能浏览目录、预览文本和 Markdown，不能在界面里编辑或上传文件。
- 功能在实验开关 `KIMI_CODE_EXPERIMENTAL_CONTINUO` 后面，默认关闭。

## 6. 运行方式

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

打开 `http://127.0.0.1:5180/#token=<上面的 token>`，选一个文件夹。演示建议把 `apps/continuo/demo-workspace/` 复制到任意可写位置再打开，它是合成数据，可以随便改。

代码位置：引擎侧 `packages/agent-core-v2/src/features/continuo/`，服务侧 `packages/kap-server/src/continuo/`（含只读文件接口 `files.ts`）与 `routes/continuo.ts`，前端 `apps/continuo/`（`components/Sidebar` / `FileBrowser` / `AgentPanel` 三栏），测试 `packages/agent-core-v2/test/features/continuo/`。

# Continuo

**Continuo** is a local Agent that keeps working inside your folder: it builds and maintains a selective, correctable understanding of the workspace, moves tasks forward on its own when it can, and shows you what it is doing on a board you can read at a glance.

## Why the name

*Continuo* (basso continuo) is the continuous bass line in Baroque music. It runs underneath the whole piece without stopping, holds the harmony together, and lets the soloists come and go on top of it.

That is the job this Agent is meant to do for knowledge work: the work should be **continuously held**, not restarted at every conversation. Materials, tasks, progress and results live in one workspace; useful context is kept, updated and reused; when a task stalls, the Agent picks it up again; and the person can always see, and correct, the line it is playing.

## 项目名说明

Continuo，通奏低音。巴洛克音乐里贯穿全曲、从不中断的低音声部，它在下面托住整首曲子，让上面的独奏来来去去。

这个 Agent 想做的就是这件事：让工作被持续接住，而不是每次对话都从头开始。资料、任务、进度、成果放在同一个工作空间里；有用的上下文被有选择地保留、更新和取用；任务卡住时它接着推进；人随时能看见它在演奏哪一条线，并且能纠正。

## Relationship to Kimi Code

This repository is a fork of [MoonshotAI/kimi-code](https://github.com/MoonshotAI/kimi-code). Continuo reuses the engine, sessions, tools, permissions, questions/approvals, file history and the local server as they are, and adds a workspace feature plus a small front-end on top. What is inherited and what is new is documented alongside the code.

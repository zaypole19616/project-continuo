# apps/continuo

Continuo's front-end: a Vite + React workbench served against the local kap-server (`kimi web`). It owns presentation only; every fact about a workspace comes from the `continuo` REST routes and the session WebSocket.

## Map

- `src/lib/api.ts`: typed client for `/api/v1` (workspaces, sessions, questions, approvals, `continuo*` routes, workspace file listing). Token comes from `#token=` or `localStorage`.
- `src/lib/ws.ts`: session event stream with reconnect; `src/lib/timeline.ts`: pure reducer from events to the conversation timeline.
- `src/pages/Workspace.tsx`: the three-pane shell and all data flow (open, poll, select task, send, reply, pause, resume, context patch).
- `src/components/Sidebar.tsx`, `AgentPanel.tsx`, `SidePanel.tsx`: the three panes (navigation, conversation, right panel). `FileTree.tsx`, `FileBrowser.tsx`, `ContextPanel.tsx`, `Timeline.tsx`, `InteractionCards.tsx` are pane children.
- `src/pages/About.tsx`: the four product bets at `#/about`. The look comes from the official Kimi Code web UI that ships in this repo as a prebuilt bundle (`apps/kimi-code/dist-web`): `src/theme.css` starts from its own design tokens (colors, radii, shadows, `--p-sidebar-w`, `--panel-default-w`, composer and send-button values), read out of `dist-web/assets/index-*.css`. The shell copies its arrangement too — sidebar with 新会话 / 搜索 / 会话, folders as groups with their sessions nested, and a new-session view with the wordmark, the folder chip above the composer, and the composer itself. There is no separate home page and no separate open-folder page: the shell always renders sidebar + conversation. With no conversation selected the centre is a centred hero whose composer carries the folder chip; `src/components/FolderMenu.tsx` is the one place to switch, browse, create or demo a folder, anchored either to that chip or to the sidebar's folder row. `src/components/Onboarding.tsx` runs a four-step modal on first launch (`continuo.onboarded`).
- `src/theme.css`: the only place for colors, radii, type sizes and shadows. Components use tokens, never literal colors.
- `demo-workspace/`: the synthetic demo folder as files; the server embeds the same content and materializes it under `~/Continuo Demo/` when the user clicks the demo entry.

## Rules

- Reducers and API helpers stay pure; components never parse wire events themselves.
- Chinese UI copy, English identifiers. No user-visible text under 12px.
- Keep the shell responsive down to 760px; headers never wrap. One control per state: the right panel's segmented control is the only mode switcher.
- Do not add a second Markdown renderer or icon set; `lib/markdown.ts` and `lucide-react` are the ones in use.
- Run `pnpm -C apps/continuo dev` with `KIMI_PORT` pointing at a `kimi web` started with `KIMI_CODE_EXPERIMENTAL_CONTINUO=1`.

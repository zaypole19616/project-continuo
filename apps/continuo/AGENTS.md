# apps/continuo

Continuo's front-end: a Vite + React workbench served against the local kap-server (`kimi web`). It owns presentation only; every fact about a workspace comes from the `continuo` REST routes and the session WebSocket.

## Map

- `src/lib/api.ts`: typed client for `/api/v1` (workspaces, sessions, questions, approvals, `continuo*` routes, workspace file listing). Token comes from `#token=` or `localStorage`.
- `src/lib/ws.ts`: session event stream with reconnect; `src/lib/timeline.ts`: pure reducer from events to the conversation timeline.
- `src/pages/Workspace.tsx`: the three-pane shell and all data flow (open, poll, select task, send, reply, pause, resume, context patch).
- `src/components/Sidebar.tsx`, `FileBrowser.tsx`, `AgentPanel.tsx`: the three panes. `Board.tsx`, `ContextPanel.tsx`, `Timeline.tsx`, `InteractionCards.tsx` are pane children.
- `src/pages/About.tsx`: the four product bets at `#/about`; `src/pages/OpenWorkspace.tsx`: folder picker.
- `src/theme.css`: the only place for colors, radii, type sizes and shadows. Components use tokens, never literal colors.
- `demo-workspace/`: synthetic demo folder; copy it somewhere writable before opening it.

## Rules

- Reducers and API helpers stay pure; components never parse wire events themselves.
- Chinese UI copy, English identifiers. No user-visible text under 12px.
- Keep the shell responsive down to 760px; headers never wrap.
- Do not add a second Markdown renderer or icon set; `lib/markdown.ts` and `lucide-react` are the ones in use.
- Run `pnpm -C apps/continuo dev` with `KIMI_PORT` pointing at a `kimi web` started with `KIMI_CODE_EXPERIMENTAL_CONTINUO=1`.

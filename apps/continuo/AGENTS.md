# apps/continuo

Continuo's front-end: a Vite + React workbench served against the local kap-server (`kimi web`). It owns presentation only; every fact about a workspace comes from the `continuo` REST routes and the session WebSocket.

## Map

- `src/lib/api.ts`: typed client for `/api/v1` (workspaces, sessions, questions, approvals, `continuo*` routes, workspace file listing). Token comes from `#token=` or `localStorage`.
- `src/lib/ws.ts`: session event stream with reconnect; `src/lib/timeline.ts`: pure reducer from events to the conversation timeline.
- `src/pages/Launcher.tsx`: what opens first — 新建项目 and 打开已有项目 side by side (same button style), recent projects as name + path only, the theme select and the demo entry. `src/components/FolderPicker.tsx` is the one dialog to browse, create or open a folder. There is no auto-restore of the last project.
- `src/pages/Workspace.tsx`: the project view and all data flow (open, poll, select task, send, reply, pause, resume, context patch). It renders a top bar, `src/components/Finder.tsx` (file tree + browser) on the left and `src/components/Drawer.tsx` (session dropdown, 对话 / 记住的事 / 记录 tabs, composer) hanging on the right. `FileTree.tsx`, `FileBrowser.tsx`, `ContextPanel.tsx`, `Timeline.tsx`, `InteractionCards.tsx`, `WorkRecord.tsx`, `InitStatus.tsx` are their children.
- `src/lib/theme.ts`: the theme preference (`continuo.theme`: dark by default, light, or system) applied as `html[data-theme]`.
- The look comes from the official Kimi Code web UI that ships in this repo as a prebuilt bundle (`apps/kimi-code/dist-web`): `src/theme.css` starts from its design tokens (colors, radii, composer and send-button values), read out of `dist-web/assets/index-*.css`. Dark is `:root`, light is `[data-theme='light']` — the same variables with other values. `src/components/Onboarding.tsx` runs a four-step modal on first launch (`continuo.onboarded`); it is the only place the three interaction bets are named.
- `src/components/ui/`: the shadcn/ui layer (Radix primitives + `cn`), the same approach `apps/vscode/webview-ui` uses. Interactive widgets — menus, dialogs, tabs, buttons, inputs — come from here, so portalling, focus, keyboard and aria are the library's job, not ours.
- `src/theme.css`: the only place for colors, radii, type sizes and shadows. It defines Kimi Code's own tokens, then maps shadcn's names (`--primary`, `--muted`, `--border`, …) onto them and exposes both through `@theme inline`. Components use tokens, never literal colors. Keep unlayered element rules out of it: an unlayered `button { color: … }` beats every Tailwind utility.
- `demo-workspace/`: the synthetic demo folder as files; the server embeds the same content and materializes it under `~/Continuo Demo/` when the user clicks the demo entry.

## Rules

- Reducers and API helpers stay pure; components never parse wire events themselves.
- Chinese UI copy, English identifiers. No user-visible text under 12px.
- Keep the project view responsive down to 860px (the drawer drops below the files); headers never wrap. One control per state: the drawer's tabs are the only mode switcher and its dropdown the only session switcher.
- Do not add a second Markdown renderer or icon set; `lib/markdown.ts` and `lucide-react` are the ones in use.
- Run `pnpm -C apps/continuo dev` with `KIMI_PORT` pointing at a `kimi web` started with `KIMI_CODE_EXPERIMENTAL_CONTINUO=1`.

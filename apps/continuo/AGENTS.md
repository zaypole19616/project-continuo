# apps/continuo

Continuo's front-end: a Vite + React workbench served against the local kap-server (`kimi web`). It owns presentation only; every fact about a project comes from the `continuo` REST routes and the session WebSocket.

## Map

- `src/lib/api.ts`: typed client for `/api/v1` (workspaces, sessions, questions, approvals, `continuo*` routes, project file listing). Token comes from `#token=` or `localStorage`.
- `src/lib/ws.ts`: session event stream with reconnect; `src/lib/timeline.ts`: pure reducer from events to the conversation timeline.
- `src/pages/Launcher.tsx`: what opens first — 新建项目 and 打开已有项目 side by side (same button style) and recent projects as name + path only. `src/components/FolderPicker.tsx` is the one dialog to browse, create or open a folder. There is no auto-restore of the last project.
- `src/pages/Workspace.tsx`: the project view and all data flow (open, poll, send, reply, pause, resume). A project has one session: the server reuses the session of the previous task for every new one, so the page streams the session of the latest task and every task is a turn in that one conversation. It renders a top bar (back to projects, name, path, the sun/moon theme button), `src/components/Finder.tsx` (the file browser, no tree) on the left, a draggable divider, and `src/components/Drawer.tsx` on the right.
- `src/components/Drawer.tsx`: the conversation hanging off the files. Its header holds one iOS-style segmented control (对话 / 事项 / 记录) at the top right. Closing cards are interleaved into the conversation by task end time; 事项 lists only unfinished tasks with their actions; 记录 renders the project's own `work-log/` files, fetched as one markdown blob. `FileBrowser.tsx`, `Timeline.tsx`, `InteractionCards.tsx`, `WorkRecord.tsx`, `InitStatus.tsx` are children of the two panes.
- `src/lib/theme.ts`: the theme preference (`continuo.theme`: system by default, or dark / light) applied as `html[data-theme]`.
- The look comes from the official Kimi Code web UI that ships in this repo as a prebuilt bundle (`apps/kimi-code/dist-web`): `src/theme.css` starts from its design tokens (colors, radii, composer and send-button values), read out of `dist-web/assets/index-*.css`. Dark is `:root`, light is `[data-theme='light']` — the same variables with other values. Files and conversation share one surface with no divider between them. `src/components/Onboarding.tsx` runs a four-step modal on first launch (`continuo.onboarded`); it is the only place the three interaction bets are named.
- `src/components/ui/`: the shadcn/ui layer (Radix primitives + `cn`). Interactive widgets — menus, dialogs, tabs, buttons, inputs — come from here, so portalling, focus, keyboard and aria are the library's job, not ours.
- `src/theme.css`: the only place for colors, radii, type sizes and shadows. It defines Kimi Code's own tokens, then maps shadcn's names (`--primary`, `--muted`, `--border`, …) onto them and exposes both through `@theme inline`. Components use tokens, never literal colors. Keep unlayered element rules out of it: an unlayered `button { color: … }` beats every Tailwind utility.

## Rules

- Reducers and API helpers stay pure; components never parse wire events themselves.
- Chinese UI copy, English identifiers. No user-visible text under 12px.
- Never narrate the interface. What the product does shows up as conversation, files and work logs, not as hints explaining itself.
- Keep the project view responsive down to 860px (the drawer drops below the files, the divider hides); headers never wrap. One control per state: the drawer's segmented control is the only mode switcher.
- Do not add a second Markdown renderer or icon set; `lib/markdown.ts` and `lucide-react` are the ones in use.
- Run `pnpm -C apps/continuo dev` with `KIMI_PORT` pointing at a `kimi web` started with `KIMI_CODE_EXPERIMENTAL_CONTINUO=1`.

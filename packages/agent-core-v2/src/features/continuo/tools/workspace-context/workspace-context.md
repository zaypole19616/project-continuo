Read or update the Continuo workspace context: the small set of durable facts this workspace keeps across tasks (conventions such as where results go, project background, decisions, current progress, reusable materials).

Actions:
- `list`: show the entries that are currently effective plus pending candidates.
- `propose`: record something you inferred. Give `kind`, `text`, and `sourceRefs` (file paths you actually read). Entries backed by project guide files (README, AGENTS.md, CLAUDE.md) become effective immediately; pure inferences stay candidates until the user confirms.
- `apply_user_instruction`: record a convention or correction the user stated explicitly in this conversation. Put the user's words in `quote`. It becomes effective immediately and, when `supersedes` names an older entry id, that entry stops applying.
- `deactivate`: stop applying an entry that is wrong or no longer relevant.
- `set_understanding`: replace the short summary of what this workspace is and how it is organized. Include `sourceRefs`.

Keep entries short and concrete. Never record secrets, credentials, or one-off requirements as workspace-wide rules; a requirement that only applies to the current task should use `scope: "task"`.

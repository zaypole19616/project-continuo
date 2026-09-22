---
"@moonshot-ai/kimi-code": minor
---

Add the experimental Continuo workspace mode: a folder-level agent that reads a folder before its first task, keeps the project's conventions in context, verifies the files it reports, and writes a work log into the folder for every task it finishes. Enable it with `KIMI_CODE_EXPERIMENTAL_CONTINUO=1` and run the `apps/continuo` front-end against `kimi web`.

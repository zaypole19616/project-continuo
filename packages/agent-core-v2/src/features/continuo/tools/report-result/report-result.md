Report the outcome of the current task so the product can verify it. Call this once, right before your final answer, whenever the task produced or changed files.

Give the exact paths of the files the user should look at (relative to the workspace root), one short note per file, a short summary, and anything that blocks this delivery under `unresolved`. The product checks that every reported path exists; a missing path or an unresolved item sends the task to review instead of marking it complete.

Work that belongs to a later step, or a decision the user still has to make, is not unresolved: write it into the document itself and, when it is worth doing next, put it in `nextStep`. Never list the same thing in both `unresolved` and `nextStep`.

When the materials you actually read point to one follow-up that is clearly worth doing next, add it as `nextStep` with a short title, the evidence behind it and the task text to start it. The user decides whether to start it; never start it yourself, and leave `nextStep` out rather than inventing one.

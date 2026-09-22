export interface DiffLine { kind: 'same' | 'added' | 'removed'; text: string }

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length > 400 || b.length > 400) {
    return before === after ? [{ kind: 'same', text: after }] : [{ kind: 'removed', text: before }, { kind: 'added', text: after }];
  }
  const rows: Uint16Array[] = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      rows[i]![j] = a[i] === b[j] ? 1 + rows[i + 1]![j + 1]! : Math.max(rows[i + 1]![j]!, rows[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { out.push({ kind: 'same', text: a[i]! }); i++; j++; }
    else if (j < b.length && (i === a.length || rows[i]![j + 1]! >= rows[i + 1]![j]!)) { out.push({ kind: 'added', text: b[j]! }); j++; }
    else { out.push({ kind: 'removed', text: a[i]! }); i++; }
  }
  return out;
}

export function collapseUnchanged(lines: DiffLine[], keep = 2): Array<DiffLine | { kind: 'skip'; count: number }> {
  const out: Array<DiffLine | { kind: 'skip'; count: number }> = [];
  let run: DiffLine[] = [];
  const flush = (last: boolean) => {
    if (run.length === 0) return;
    if (run.length <= keep * 2 + 1) { out.push(...run); run = []; return; }
    const head = out.length === 0 ? [] : run.slice(0, keep);
    const tail = last ? [] : run.slice(-keep);
    out.push(...head, { kind: 'skip', count: run.length - head.length - tail.length }, ...tail);
    run = [];
  };
  for (const line of lines) {
    if (line.kind === 'same') { run.push(line); continue; }
    flush(false);
    out.push(line);
  }
  flush(true);
  return out;
}

import { useState } from 'react';
import { MessageCircleQuestion, ShieldAlert } from 'lucide-react';
import type { ApprovalRequest, QuestionRequest } from '#/lib/api';
import { Button } from '#/components/ui/button';

export function QuestionCard({ q, onAnswer }: { q: QuestionRequest; onAnswer: (answers: Record<string, unknown>, note?: string) => Promise<void> }) {
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);
  const allPicked = q.questions.every((item) => picked[item.id] || (item.allow_other && other.trim()));
  const submit = async () => {
    setBusy(true);
    const answers: Record<string, unknown> = {};
    for (const item of q.questions) {
      const opt = picked[item.id];
      answers[item.id] = opt ? { kind: 'single', option_id: opt } : { kind: 'other', text: other.trim() };
    }
    try { await onAnswer(answers); } finally { setBusy(false); }
  };
  return (
    <div className="card p-4 space-y-3 fade-in" style={{ borderColor: 'var(--warn)' }}>
      <div className="flex items-center gap-2 fs-meta" style={{ color: 'var(--warn)' }}><MessageCircleQuestion size={16} />需要你决定</div>
      {q.questions.map((item) => (
        <div key={item.id} className="space-y-2">
          {item.header && <div className="text-3 fs-meta">{item.header}</div>}
          <div className="font-medium" style={{ fontSize: 'var(--fs-chat)' }}>{item.question}</div>
          {item.body && <div className="text-2 whitespace-pre-wrap">{item.body}</div>}
          <div className="grid gap-1">
            {item.options.map((o) => (
              <label key={o.id} className={`row row-click ${picked[item.id] === o.id ? 'is-selected' : ''}`} style={{ minHeight: 40 }}>
                <input type="radio" name={item.id} checked={picked[item.id] === o.id} onChange={() => setPicked({ ...picked, [item.id]: o.id })} />
                <span><span>{o.label}</span>{o.description && <span className="text-3"> · {o.description}</span>}</span>
              </label>
            ))}
            {item.allow_other && (
              <input placeholder={item.other_label ?? '其他，直接写'} value={other} onChange={(e) => { setOther(e.target.value); const next = { ...picked }; delete next[item.id]; setPicked(next); }} />
            )}
          </div>
        </div>
      ))}
      <div className="flex justify-end"><Button variant="default" disabled={!allPicked || busy} onClick={() => { void submit(); }}>回答并继续</Button></div>
    </div>
  );
}

export function ApprovalCard({ a, root, onDecide }: { a: ApprovalRequest; root?: string; onDecide: (d: 'approved' | 'rejected', scope?: 'session') => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const run = async (d: 'approved' | 'rejected', scope?: 'session') => { setBusy(true); try { await onDecide(d, scope); } finally { setBusy(false); } };
  const { headline, detail } = describeApproval(a, root);
  return (
    <div className="card p-4 space-y-3 fade-in" style={{ borderColor: 'var(--warn)' }}>
      <div className="flex items-center gap-2 fs-meta" style={{ color: 'var(--warn)' }}><ShieldAlert size={16} />要动你的文件，先问你一声</div>
      <div className="font-medium" style={{ fontSize: 'var(--fs-chat)' }}>{headline}</div>
      {detail && <pre className="p-2 overflow-auto" style={{ background: 'var(--row-hover)', borderRadius: 'var(--r-2)' }}>{detail}</pre>}
      <div className="flex gap-2 flex-wrap justify-end">
        <Button disabled={busy} onClick={() => { void run('rejected'); }}>拒绝</Button>
        <Button disabled={busy} onClick={() => { void run('approved', 'session'); }}>本次任务都允许</Button>
        <Button variant="default" disabled={busy} onClick={() => { void run('approved'); }}>允许</Button>
      </div>
    </div>
  );
}

function describeApproval(a: ApprovalRequest, root?: string): { headline: string; detail?: string } {
  const display = a.tool_input_display as { kind?: string; operation?: string; path?: string; command?: string; summary?: string } | undefined;
  const path = display?.path === undefined ? undefined : relativeTo(display.path, root);
  if (path && (display?.kind === 'diff' || display?.operation === 'edit')) return { headline: `要修改 ${fileName(path)}`, detail: path };
  if (path && display?.operation === 'write') return { headline: `要在 ${dirName(path)} 里写一份 ${fileName(path)}`, detail: path };
  if (display?.command) return { headline: '要运行一条命令', detail: display.command };
  return { headline: a.action || a.tool_name, detail: display?.summary ?? path };
}

function relativeTo(path: string, root?: string): string {
  if (!root) return path;
  const base = root.endsWith('/') ? root : root + '/';
  return path.startsWith(base) ? path.slice(base.length) : path;
}

function fileName(path: string): string { return path.split('/').filter(Boolean).pop() ?? path; }
function dirName(path: string): string { const parts = path.split('/').filter(Boolean); parts.pop(); return parts.length > 0 ? parts.join('/') + '/' : '文件夹根目录'; }

import { useState } from 'react';
import type { ApprovalRequest, QuestionRequest } from '#/lib/api';

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
    <div className="panel p-4 space-y-3" style={{ borderColor: 'var(--warn)' }}>
      <div className="tag tag-wait">需要你</div>
      {q.questions.map((item) => (
        <div key={item.id} className="space-y-2">
          {item.header && <div className="muted text-xs">{item.header}</div>}
          <div className="font-medium">{item.question}</div>
          {item.body && <div className="muted text-sm whitespace-pre-wrap">{item.body}</div>}
          <div className="grid gap-1">
            {item.options.map((o) => (
              <label key={o.id} className="flex items-start gap-2 cursor-pointer">
                <input type="radio" name={item.id} checked={picked[item.id] === o.id} onChange={() => setPicked({ ...picked, [item.id]: o.id })} />
                <span><span>{o.label}</span>{o.description && <span className="muted"> · {o.description}</span>}</span>
              </label>
            ))}
            {item.allow_other && (
              <input placeholder={item.other_label ?? '其他，直接写'} value={other} onChange={(e) => { setOther(e.target.value); const next = { ...picked }; delete next[item.id]; setPicked(next); }} />
            )}
          </div>
        </div>
      ))}
      <button className="btn btn-primary" disabled={!allPicked || busy} onClick={() => { void submit(); }}>回答并继续</button>
    </div>
  );
}

export function ApprovalCard({ a, onDecide }: { a: ApprovalRequest; onDecide: (d: 'approved' | 'rejected', scope?: 'session') => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const run = async (d: 'approved' | 'rejected', scope?: 'session') => { setBusy(true); try { await onDecide(d, scope); } finally { setBusy(false); } };
  const display = a.tool_input_display as { operation?: string; path?: string; command?: string } | undefined;
  return (
    <div className="panel p-4 space-y-2" style={{ borderColor: 'var(--warn)' }}>
      <div className="tag tag-wait">等待批准</div>
      <div className="font-medium">{a.action || `${a.tool_name}`}</div>
      {display && (display.command || display.path) && <pre className="p-2 rounded text-xs overflow-auto" style={{ background: 'var(--bg)' }}>{display.command ?? display.path}</pre>}
      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={busy} onClick={() => { void run('approved'); }}>允许</button>
        <button className="btn" disabled={busy} onClick={() => { void run('approved', 'session'); }}>本次会话都允许</button>
        <button className="btn" disabled={busy} onClick={() => { void run('rejected'); }}>拒绝</button>
      </div>
    </div>
  );
}

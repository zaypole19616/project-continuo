import { useState } from 'react';
import type { TimelineItem, ToolCall } from '#/lib/timeline';

const REASON_LABEL: Record<string, string> = { completed: '本轮完成', cancelled: '已停止', failed: '本轮失败', blocked: '被阻塞，需要处理' };

export function Timeline({ items }: { items: TimelineItem[] }) {
  if (items.length === 0) return <div className="muted p-6 text-center">还没有对话。先在下面交代一个任务。</div>;
  return (
    <div className="space-y-4">
      {items.map((it) => it.kind === 'user' ? <UserBubble key={it.id} text={it.text} /> : <AssistantTurn key={it.id} item={it} />)}
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl px-4 py-2 whitespace-pre-wrap" style={{ background: 'var(--accent-soft)' }}>{text}</div>
    </div>
  );
}

function AssistantTurn({ item }: { item: Extract<TimelineItem, { kind: 'assistant' }> }) {
  return (
    <div className="space-y-2">
      {item.tools.length > 0 && <ToolTimeline tools={item.tools} />}
      {item.text && <div className="whitespace-pre-wrap leading-relaxed">{item.text}</div>}
      {!item.ended && !item.text && item.tools.length === 0 && <div className="muted text-sm">正在思考…</div>}
      {item.ended && item.ended.reason !== 'completed' && (
        <div className="text-sm" style={{ color: 'var(--danger)' }}>
          {REASON_LABEL[item.ended.reason] ?? `回合结束：${item.ended.reason}`}{item.ended.error ? ` · ${item.ended.error}` : ''}
        </div>
      )}
    </div>
  );
}

function ToolTimeline({ tools }: { tools: ToolCall[] }) {
  return (
    <div className="panel px-3 py-2 space-y-1">
      {tools.map((t) => <ToolRow key={t.id} t={t} />)}
    </div>
  );
}

function ToolRow({ t }: { t: ToolCall }) {
  const [open, setOpen] = useState(false);
  const label = t.description ?? describe(t);
  return (
    <div className="text-sm">
      <button className="flex items-center gap-2 w-full text-left" onClick={() => setOpen(!open)}>
        <span className={`tag ${t.done ? (t.isError ? 'tag-fail' : 'tag-done') : 'tag-run'}`}>{t.done ? (t.isError ? '失败' : '完成') : '进行中'}</span>
        <span className="mono muted">{t.name}</span>
        <span className="truncate">{label}</span>
      </button>
      {open && t.output !== undefined && (
        <pre className="mt-1 max-h-48 overflow-auto p-2 rounded" style={{ background: 'var(--bg)' }}>{t.output.slice(0, 4000)}</pre>
      )}
    </div>
  );
}

function describe(t: ToolCall): string {
  const a = t.args as Record<string, unknown> | undefined;
  if (!a) return '';
  const first = a['path'] ?? a['pattern'] ?? a['command'] ?? a['query'];
  return typeof first === 'string' ? first : '';
}

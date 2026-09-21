import { useState } from 'react';
import { ChevronDown, ChevronRight, Check, CircleAlert, Loader2 } from 'lucide-react';
import type { TimelineItem, ToolCall } from '#/lib/timeline';

const REASON_LABEL: Record<string, string> = { completed: '本轮完成', cancelled: '已停止', failed: '本轮失败', blocked: '被阻塞，需要处理' };

export function Timeline({ items, emptyHint }: { items: TimelineItem[]; emptyHint?: string }) {
  if (items.length === 0) return <div className="text-3 p-6 text-center fs-meta">{emptyHint ?? '还没有对话。'}</div>;
  return (
    <div className="space-y-5">
      {items.map((it) => it.kind === 'user' ? <div key={it.id} className="msg-user fade-in">{it.text}</div> : <AssistantTurn key={it.id} item={it} />)}
    </div>
  );
}

function AssistantTurn({ item }: { item: Extract<TimelineItem, { kind: 'assistant' }> }) {
  return (
    <div className="space-y-3 fade-in">
      {item.tools.length > 0 && <ActivityTimeline tools={item.tools} />}
      {item.text && <div className="msg-assistant">{item.text}</div>}
      {!item.ended && !item.text && item.tools.length === 0 && <div className="text-3 fs-meta flex items-center gap-2"><Loader2 size={14} className="spin" />正在思考…</div>}
      {item.ended && item.ended.reason !== 'completed' && (
        <div className="fs-meta flex items-start gap-2" style={{ color: item.ended.reason === 'cancelled' ? 'var(--text-3)' : 'var(--err)' }}>
          <CircleAlert size={14} style={{ marginTop: 2 }} />
          <span>{REASON_LABEL[item.ended.reason] ?? `回合结束：${item.ended.reason}`}{item.ended.error ? ` · ${item.ended.error}` : ''}</span>
        </div>
      )}
    </div>
  );
}

function ActivityTimeline({ tools }: { tools: ToolCall[] }) {
  const [collapsed, setCollapsed] = useState(tools.length > 6 && tools.every((t) => t.done));
  const done = tools.filter((t) => t.done).length;
  const running = tools.length - done;
  return (
    <div className="activity">
      <button className="activity-row w-full text-left chrome" onClick={() => setCollapsed(!collapsed)} style={{ background: 'var(--row-hover)' }}>
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        <span className="text-2">{running > 0 ? `执行中 · ${done}/${tools.length} 步` : `${tools.length} 步已完成`}</span>
      </button>
      {!collapsed && tools.map((t) => <ToolRow key={t.id} t={t} />)}
    </div>
  );
}

function ToolRow({ t }: { t: ToolCall }) {
  const [open, setOpen] = useState(false);
  const label = t.description ?? describe(t);
  return (
    <div>
      <button className="activity-row w-full text-left" onClick={() => setOpen(!open)}>
        <StatusIcon t={t} />
        <span className="name">{t.name}</span>
        <span className="desc flex-1">{label}</span>
      </button>
      {open && t.output !== undefined && (
        <pre className="m-2 mt-0 max-h-56 overflow-auto p-2" style={{ background: 'var(--row-hover)', borderRadius: 'var(--r-2)' }}>{t.output.slice(0, 4000)}</pre>
      )}
    </div>
  );
}

function StatusIcon({ t }: { t: ToolCall }) {
  if (!t.done) return <Loader2 size={14} className="spin" style={{ color: 'var(--info)' }} />;
  if (t.isError) return <CircleAlert size={14} style={{ color: 'var(--err)' }} />;
  return <Check size={14} style={{ color: 'var(--ok)' }} />;
}

function describe(t: ToolCall): string {
  const a = t.args as Record<string, unknown> | undefined;
  if (!a) return '';
  const first = a['path'] ?? a['pattern'] ?? a['command'] ?? a['query'];
  return typeof first === 'string' ? first : '';
}

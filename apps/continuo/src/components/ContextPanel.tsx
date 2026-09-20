import { useState } from 'react';
import type { ContextEntry, ContinuoDoc } from '#/lib/api';

const KIND_LABEL: Record<ContextEntry['kind'], string> = { convention: '约定', background: '背景', decision: '决定', progress: '进度', material: '材料' };
const ORIGIN_LABEL: Record<ContextEntry['origin'], string> = { user: '你确认的', file: '来自文件', agent: 'Agent 推断' };

export function ContextPanel({ doc, onPatch }: { doc: ContinuoDoc; onPatch: (entry: ContextEntry, body: { text?: string; status?: 'active' | 'inactive' }) => Promise<void> }) {
  const active = doc.context.filter((e) => e.status === 'active');
  const candidates = doc.context.filter((e) => e.status === 'candidate');
  const stale = doc.context.filter((e) => e.status === 'stale');
  const retired = doc.context.filter((e) => e.status === 'superseded' || e.status === 'inactive');
  return (
    <div className="space-y-3">
      <div className="font-medium">工作空间理解</div>
      {doc.understanding ? (
        <div className="panel p-3 text-sm space-y-1">
          <div className="whitespace-pre-wrap">{doc.understanding.text}</div>
          {doc.understanding.sourceRefs.length > 0 && <div className="muted text-xs">依据：{doc.understanding.sourceRefs.join('、')}</div>}
        </div>
      ) : (
        <div className="muted text-sm">{doc.init.status === 'running' ? '正在了解这个文件夹…' : '还没有形成理解。'}</div>
      )}
      <div className="font-medium">有效 Context · {active.length}</div>
      <div className="space-y-2">
        {active.map((e) => <EntryCard key={e.id} e={e} onPatch={onPatch} />)}
        {active.length === 0 && <div className="muted text-xs">还没有生效的条目。</div>}
      </div>
      {candidates.length > 0 && (
        <>
          <div className="font-medium">待你确认 · {candidates.length}</div>
          <div className="space-y-2">{candidates.map((e) => <EntryCard key={e.id} e={e} onPatch={onPatch} candidate />)}</div>
        </>
      )}
      {stale.length > 0 && (
        <>
          <div className="font-medium" style={{ color: 'var(--warn)' }}>来源已变化，暂不生效 · {stale.length}</div>
          <div className="space-y-2">{stale.map((e) => <EntryCard key={e.id} e={e} onPatch={onPatch} stale />)}</div>
        </>
      )}
      {retired.length > 0 && <details className="muted text-xs"><summary>已停用或被替代 · {retired.length}</summary><div className="space-y-1 mt-1">{retired.map((e) => <div key={e.id} className="line-through">{e.text}</div>)}</div></details>}
    </div>
  );
}

function EntryCard({ e, onPatch, candidate, stale }: { e: ContextEntry; onPatch: (entry: ContextEntry, body: { text?: string; status?: 'active' | 'inactive' }) => Promise<void>; candidate?: boolean; stale?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(e.text);
  const [busy, setBusy] = useState(false);
  const run = async (body: { text?: string; status?: 'active' | 'inactive' }) => { setBusy(true); try { await onPatch(e, body); setEditing(false); } finally { setBusy(false); } };
  return (
    <div className="panel p-3 text-sm space-y-1" style={candidate ? { borderStyle: 'dashed' } : stale ? { borderColor: 'var(--warn)' } : undefined}>
      <div className="flex items-center gap-2 muted text-xs"><span className="tag">{KIND_LABEL[e.kind]}</span><span>{ORIGIN_LABEL[e.origin]}</span>{e.scope.type === 'task' && <span>仅本任务</span>}</div>
      {editing ? (
        <textarea className="w-full" rows={3} value={text} onChange={(ev) => setText(ev.target.value)} />
      ) : (
        <div className="whitespace-pre-wrap">{e.text}</div>
      )}
      {e.sourceRefs.length > 0 && <div className="muted text-xs break-all">依据：{e.sourceRefs.join('、')}</div>}
      <div className="flex gap-2 pt-1">
        {candidate && <button className="btn text-xs btn-primary" disabled={busy} onClick={() => { void run({ status: 'active' }); }}>确认</button>}
        {stale && <button className="btn text-xs btn-primary" disabled={busy} onClick={() => { void run({ status: 'active' }); }}>仍然有效</button>}
        {editing ? (
          <>
            <button className="btn text-xs btn-primary" disabled={busy || !text.trim()} onClick={() => { void run({ text: text.trim() }); }}>保存为纠正</button>
            <button className="btn text-xs" disabled={busy} onClick={() => { setEditing(false); setText(e.text); }}>取消</button>
          </>
        ) : (
          <button className="btn text-xs" disabled={busy} onClick={() => setEditing(true)}>纠正</button>
        )}
        <button className="btn text-xs" disabled={busy} onClick={() => { void run({ status: 'inactive' }); }}>{candidate ? '忽略' : '停用'}</button>
      </div>
    </div>
  );
}

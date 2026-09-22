import { useState } from 'react';
import { BookOpen, FileText, UserCheck, Wand2 } from 'lucide-react';
import type { ContextEntry, ContinuoDoc } from '#/lib/api';

const KIND_LABEL: Record<ContextEntry['kind'], string> = { convention: '约定', background: '背景', decision: '决定', progress: '进度', material: '材料' };
const ORIGIN_LABEL: Record<ContextEntry['origin'], string> = { user: '你确认的', file: '来自文件', agent: '它的推断' };

type Patch = { text?: string; status?: 'active' | 'inactive' };

export function ContextPanel({ doc, onPatch, onOpenFile }: { doc: ContinuoDoc; onPatch: (entry: ContextEntry, body: Patch) => Promise<void>; onOpenFile: (path: string) => void }) {
  const active = doc.context.filter((e) => e.status === 'active');
  const candidates = doc.context.filter((e) => e.status === 'candidate');
  const stale = doc.context.filter((e) => e.status === 'stale');
  const retired = doc.context.filter((e) => e.status === 'superseded' || e.status === 'inactive');
  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <div className="nav-section" style={{ padding: '0 2px' }}>它对这个文件夹的理解</div>
        {doc.understanding ? (
          <details className="entry understanding-details">
            <summary className="entry-text chrome" style={{ cursor: 'pointer' }}>{doc.understanding.text}</summary>
            {doc.understanding.sourceRefs.length > 0 && <div style={{ marginTop: 8 }}><Sources refs={doc.understanding.sourceRefs} onOpenFile={onOpenFile} /></div>}
          </details>
        ) : (
          <div className="text-3 fs-meta">{doc.init.status === 'running' ? '正在了解这个文件夹…' : '还没有形成理解。'}</div>
        )}
      </section>
      {candidates.length > 0 && (
        <section className="space-y-2">
          <div className="nav-section flex items-center justify-between" style={{ padding: '0 2px' }}><span>待你确认</span><span>{candidates.length}</span></div>
          {candidates.map((e) => <EntryCard key={e.id} e={e} mode="candidate" onPatch={onPatch} onOpenFile={onOpenFile} />)}
        </section>
      )}
      {stale.length > 0 && (
        <section className="space-y-2">
          <div className="nav-section flex items-center justify-between" style={{ padding: '0 2px', color: 'var(--warn)' }}><span>来源变了，先不用</span><span>{stale.length}</span></div>
          {stale.map((e) => <EntryCard key={e.id} e={e} mode="stale" onPatch={onPatch} onOpenFile={onOpenFile} />)}
        </section>
      )}
      <section className="space-y-2">
        <div className="nav-section flex items-center justify-between" style={{ padding: '0 2px' }}><span>正在用的</span><span>{active.length}</span></div>
        {active.map((e) => <EntryCard key={e.id} e={e} mode="active" onPatch={onPatch} onOpenFile={onOpenFile} />)}
        {active.length === 0 && <div className="text-3 fs-meta">还没记住任何事。</div>}
      </section>
      {retired.length > 0 && (
        <details className="text-3 fs-meta">
          <summary className="chrome" style={{ cursor: 'pointer' }}>不再用的 · {retired.length}</summary>
          <div className="space-y-1 mt-2">{retired.map((e) => <div key={e.id} className="line-through px-1">{e.text}</div>)}</div>
        </details>
      )}
    </div>
  );
}

function Sources({ refs, onOpenFile }: { refs: readonly string[]; onOpenFile: (path: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1 fs-meta">
      {refs.map((r) => {
        const isFile = !r.includes(':') || /^[a-z]+:\//i.test(r) === false && r.includes('/');
        const clickable = isFile && !r.startsWith('task:') && !r.startsWith('user:');
        return clickable
          ? <button key={r} className="tag tag-neutral" style={{ cursor: 'pointer' }} onClick={() => onOpenFile(r)} title="打开来源文件"><FileText size={11} />{r}</button>
          : <span key={r} className="tag tag-neutral">{r}</span>;
      })}
    </div>
  );
}

function EntryCard({ e, mode, onPatch, onOpenFile }: { e: ContextEntry; mode: 'active' | 'candidate' | 'stale'; onPatch: (entry: ContextEntry, body: Patch) => Promise<void>; onOpenFile: (path: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(e.text);
  const [busy, setBusy] = useState(false);
  const run = async (body: Patch) => { setBusy(true); try { await onPatch(e, body); setEditing(false); } finally { setBusy(false); } };
  const OriginIcon = e.origin === 'user' ? UserCheck : e.origin === 'file' ? BookOpen : Wand2;
  return (
    <div className={`entry ${mode}`}>
      <div className="entry-meta chrome">
        <span className="tag tag-neutral">{KIND_LABEL[e.kind]}</span>
        <span className="flex items-center gap-1"><OriginIcon size={12} />{ORIGIN_LABEL[e.origin]}</span>
        {e.scope.type === 'task' && <span>仅本任务</span>}
      </div>
      {editing
        ? <textarea className="w-full" rows={3} value={text} onChange={(ev) => setText(ev.target.value)} />
        : <div className={`entry-text ${open ? '' : 'clamp'}`} role="button" tabIndex={0} title={open ? undefined : '点开看全文'} onClick={() => setOpen(!open)} onKeyDown={(ev) => { if (ev.key === 'Enter') setOpen(!open); }}>{e.text}</div>}
      {open && !editing && e.sourceRefs.length > 0 && <Sources refs={e.sourceRefs} onOpenFile={onOpenFile} />}
      <div className="entry-actions chrome">
        {mode === 'candidate' && <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => { void run({ status: 'active' }); }}>确认</button>}
        {mode === 'stale' && <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => { void run({ status: 'active' }); }}>仍然有效</button>}
        {editing ? (
          <>
            <button className="btn btn-sm btn-primary" disabled={busy || !text.trim()} onClick={() => { void run({ text: text.trim() }); }}>保存</button>
            <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => { setEditing(false); setText(e.text); }}>取消</button>
          </>
        ) : (
          <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setEditing(true)}>改一下</button>
        )}
        <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => { void run({ status: 'inactive' }); }}>{mode === 'candidate' ? '忽略' : '不再用'}</button>
      </div>
    </div>
  );
}

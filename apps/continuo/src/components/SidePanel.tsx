import { FolderOpen, History, Layers } from 'lucide-react';
import type { ContextEntry, ContinuoDoc, ContinuoTask } from '#/lib/api';
import { ContextPanel } from './ContextPanel';
import { FileBrowser, type NavTarget } from './FileBrowser';
import { FileTree } from './FileTree';
import { WorkRecord } from './WorkRecord';

export type SideMode = 'files' | 'context' | 'log';

export function SidePanel({ mode, onMode, workspaceId, root, doc, target, onNavigate, onSelectTask, onPatchContext, onError, searchRef }: {
  mode: SideMode; onMode: (m: SideMode) => void;
  workspaceId: string; root: string; doc: ContinuoDoc | null; target: NavTarget; onNavigate: (t: NavTarget) => void;
  onSelectTask: (task: ContinuoTask) => void;
  onPatchContext: (entry: ContextEntry, body: { text?: string; status?: 'active' | 'inactive' }) => Promise<void>;
  onError: (message: string) => void; searchRef: React.RefObject<HTMLInputElement | null>;
}) {
  const rootName = root.split('/').filter(Boolean).pop() ?? '根目录';
  const pending = doc?.context.filter((e) => e.status === 'candidate' || e.status === 'stale').length ?? 0;
  return (
    <aside className="pane pane-side" aria-label="右侧面板">
      <header className="pane-header chrome" style={{ padding: '0 8px 0 12px' }}>
        <div className="seg" role="tablist">
          <ModeTab active={mode === 'files'} label="文件" onClick={() => onMode('files')}><FolderOpen size={15} /></ModeTab>
          <ModeTab active={mode === 'context'} label="记住的事" badge={pending || undefined} onClick={() => onMode('context')}><Layers size={15} /></ModeTab>
          <ModeTab active={mode === 'log'} label="工作记录" onClick={() => onMode('log')}><History size={15} /></ModeTab>
        </div>
      </header>
      {mode === 'files' && (
        <div className="side-files">
          <div className="side-tree">
            <FileTree workspaceId={workspaceId} rootName={rootName} revision={doc?.revision ?? 0} target={target} onNavigate={onNavigate} />
          </div>
          <FileBrowser workspaceId={workspaceId} root={root} doc={doc} target={target} agentCollapsed={false} searchRef={searchRef} onNavigate={onNavigate} onOpenAgent={() => undefined} onSelectTask={(id) => { const t = doc?.tasks.find((x) => x.taskId === id); if (t) onSelectTask(t); }} onError={onError} />
        </div>
      )}
      {mode === 'context' && <div className="pane-body p-4">{doc ? <ContextPanel doc={doc} onPatch={onPatchContext} onOpenFile={(p) => onNavigate({ kind: 'file', path: p })} /> : <Loading />}</div>}
      {mode === 'log' && <div className="pane-body p-4">{doc ? <WorkRecord workspaceId={workspaceId} revision={doc.revision} onError={onError} /> : <Loading />}</div>}
    </aside>
  );
}

function ModeTab({ active, label, badge, onClick, children }: { active: boolean; label: string; badge?: number; onClick: () => void; children: React.ReactNode }) {
  return (
    <button role="tab" aria-selected={active} className={`mode-tab ${active ? 'is-active' : ''}`} onClick={onClick} title={label}>
      {children}<span>{label}</span>{badge !== undefined && <span className="mode-badge">{badge}</span>}
    </button>
  );
}

function Loading() { return <div className="t3 sm">打开中…</div>; }

import { FolderOpen, History, Layers } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs';
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
    <Tabs value={mode} onValueChange={(v) => onMode(v as SideMode)} className="pane pane-side" aria-label="右侧面板" asChild>
      <aside>
        <header className="pane-header chrome" style={{ padding: '0 8px 0 12px' }}>
          <TabsList>
            <TabsTrigger value="files"><FolderOpen />文件</TabsTrigger>
            <TabsTrigger value="context"><Layers />记住的事{pending > 0 && <span className="mode-badge">{pending}</span>}</TabsTrigger>
            <TabsTrigger value="log"><History />工作记录</TabsTrigger>
          </TabsList>
        </header>
        <TabsContent value="files" className="side-files">
          <div className="side-tree">
            <FileTree workspaceId={workspaceId} rootName={rootName} revision={doc?.revision ?? 0} target={target} onNavigate={onNavigate} />
          </div>
          <FileBrowser workspaceId={workspaceId} root={root} doc={doc} target={target} agentCollapsed={false} searchRef={searchRef} onNavigate={onNavigate} onOpenAgent={() => undefined} onSelectTask={(id) => { const t = doc?.tasks.find((x) => x.taskId === id); if (t) onSelectTask(t); }} onError={onError} />
        </TabsContent>
        <TabsContent value="context" className="pane-body p-4">{doc ? <ContextPanel doc={doc} onPatch={onPatchContext} onOpenFile={(p) => onNavigate({ kind: 'file', path: p })} /> : <Loading />}</TabsContent>
        <TabsContent value="log" className="pane-body p-4">{doc ? <WorkRecord workspaceId={workspaceId} revision={doc.revision} onError={onError} /> : <Loading />}</TabsContent>
      </aside>
    </Tabs>
  );
}

function Loading() { return <div className="t3 sm">打开中…</div>; }

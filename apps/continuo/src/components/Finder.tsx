import type { ContinuoDoc, ContinuoTask } from '#/lib/api';
import { FileBrowser, type NavTarget } from './FileBrowser';
import { FileTree } from './FileTree';

export function Finder({ workspaceId, root, doc, target, onNavigate, onSelectTask, onError, searchRef }: {
  workspaceId: string; root: string; doc: ContinuoDoc | null; target: NavTarget; onNavigate: (t: NavTarget) => void;
  onSelectTask: (task: ContinuoTask) => void; onError: (message: string) => void; searchRef: React.RefObject<HTMLInputElement | null>;
}) {
  const rootName = root.split('/').filter(Boolean).pop() ?? '根目录';
  return (
    <section className="panel-box finder" aria-label="项目文件">
      <div className="finder-tree">
        <FileTree workspaceId={workspaceId} rootName={rootName} revision={doc?.revision ?? 0} target={target} onNavigate={onNavigate} />
      </div>
      <FileBrowser
        workspaceId={workspaceId} root={root} doc={doc} target={target} agentCollapsed={false} searchRef={searchRef}
        onNavigate={onNavigate} onOpenAgent={() => undefined}
        onSelectTask={(id) => { const task = doc?.tasks.find((t) => t.taskId === id); if (task) onSelectTask(task); }}
        onError={onError}
      />
    </section>
  );
}

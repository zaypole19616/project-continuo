import type { ContinuoDoc } from '#/lib/api';
import { FileBrowser, type NavTarget } from './FileBrowser';

export function Finder({ workspaceId, root, doc, target, onNavigate, onError, searchRef }: {
  workspaceId: string; root: string; doc: ContinuoDoc | null; target: NavTarget; onNavigate: (t: NavTarget) => void;
  onError: (message: string) => void; searchRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <section className="panel-box finder" aria-label="项目文件">
      <FileBrowser
        workspaceId={workspaceId} root={root} doc={doc} target={target} agentCollapsed={false} searchRef={searchRef}
        onNavigate={onNavigate} onOpenAgent={() => undefined} onSelectTask={() => undefined} onError={onError}
      />
    </section>
  );
}

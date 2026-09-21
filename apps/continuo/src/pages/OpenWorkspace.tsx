import { useEffect, useState } from 'react';
import { ArrowUp, ChevronRight, Clock, Folder, FolderPlus } from 'lucide-react';
import { kimi, type FsBrowse, type Workspace } from '#/lib/api';

export function OpenWorkspace({ onOpen }: { onOpen: (w: Workspace) => void }) {
  const [recent, setRecent] = useState<Workspace[]>([]);
  const [browse, setBrowse] = useState<FsBrowse | null>(null);
  const [newName, setNewName] = useState('');
  const [pathInput, setPathInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    kimi.workspaces().then((r) => setRecent(r.items)).catch((error: Error) => setError(error.message));
    kimi.fsHome().then((h) => kimi.fsBrowse(h.home)).then(setBrowse).catch((error: Error) => setError(error.message));
  }, []);

  const go = (path: string) => kimi.fsBrowse(path).then(setBrowse).catch((error: Error) => setError(error.message));

  const openPath = async (root: string) => {
    setBusy(true); setError(null);
    try { onOpen(await kimi.createWorkspace(root)); } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  };

  const createHere = async () => {
    if (!browse || !newName.trim()) return;
    setBusy(true); setError(null);
    try {
      const made = await kimi.fsMkdir(browse.path.replace(/\/$/, '') + '/' + newName.trim());
      onOpen(await kimi.createWorkspace(made.path));
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto p-10 space-y-8" style={{ maxWidth: 760 }}>
        <header className="space-y-2">
          <div style={{ fontSize: 'var(--fs-h1)', fontWeight: 600, letterSpacing: '-0.015em' }}>Continuo</div>
          <p className="text-2" style={{ fontSize: 'var(--fs-chat)' }}>选一个文件夹开始。打开后 Agent 会先了解目录结构和已有指引；它做的每一步、记下的每一条 context 都能看见、能纠正。</p>
        </header>

        {error && <div className="banner banner-err">{error}</div>}

        {recent.length > 0 && (
          <section className="space-y-2">
            <div className="nav-section flex items-center gap-2" style={{ padding: 0 }}><Clock size={14} />最近的工作空间</div>
            <div className="card divide-y" style={{ borderColor: 'var(--divider)' }}>
              {recent.map((w) => (
                <button key={w.id} className="row row-click w-full text-left" style={{ minHeight: 52, borderRadius: 0 }} onClick={() => onOpen(w)}>
                  <Folder size={18} className="text-2" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{w.name}</div>
                    <div className="text-3 mono truncate" style={{ fontSize: 12 }}>{w.root}</div>
                  </div>
                  <ChevronRight size={16} className="text-3" />
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="space-y-2">
          <div className="nav-section flex items-center gap-2" style={{ padding: 0 }}><Folder size={14} />打开已有文件夹</div>
          <div className="card p-3 space-y-2">
            <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); const p = pathInput.trim(); if (p) { setPathInput(''); void go(p); } }}>
              <button className="btn" type="button" disabled={!browse?.parent} onClick={() => { if (browse?.parent) void go(browse.parent); }}>上一级</button>
              <input className="flex-1 mono" style={{ fontSize: 12 }} placeholder="输入绝对路径后回车跳转" value={pathInput} onChange={(e) => setPathInput(e.target.value)} />
              <button className="btn btn-primary" type="button" disabled={!browse || busy} onClick={() => { if (browse) void openPath(browse.path); }}>打开这个文件夹</button>
            </form>
            <div className="text-3 mono truncate" style={{ fontSize: 12 }}>当前：{browse?.path ?? '…'}</div>
            <div className="max-h-72 overflow-auto">
              {browse?.entries.map((e) => (
                <div key={e.path} className="row" style={{ minHeight: 36 }}>
                  <Folder size={15} className="text-3" />
                  <button className="text-left flex-1 truncate row-click" onClick={() => { void go(e.path); }}>{e.name}</button>
                  <button className="btn btn-sm" disabled={busy} onClick={() => { void openPath(e.path); }}>打开</button>
                </div>
              ))}
              {browse && browse.entries.length === 0 && <div className="text-3 py-2 fs-meta">没有子文件夹</div>}
            </div>
          </div>
        </section>

        <section className="space-y-2">
          <div className="nav-section flex items-center gap-2" style={{ padding: 0 }}><FolderPlus size={14} />在当前位置新建文件夹</div>
          <div className="flex gap-2">
            <input className="flex-1" placeholder="新文件夹名" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <button className="btn" disabled={!newName.trim() || busy} onClick={() => { void createHere(); }}><ArrowUp size={14} />新建并打开</button>
          </div>
        </section>
      </div>
    </div>
  );
}

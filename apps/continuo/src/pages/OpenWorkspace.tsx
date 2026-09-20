import { useEffect, useState } from 'react';
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
      <div className="max-w-3xl mx-auto p-8 space-y-6">
        <header>
          <div className="text-2xl font-semibold">Continuo</div>
          <p className="muted mt-1">选一个文件夹开始。打开后 Agent 会先了解目录结构和已有指引，过程会显示在看板里，随时可以停止或纠正。</p>
        </header>

        {error && <div className="panel p-3 text-sm" style={{ borderColor: 'var(--danger)' }}>{error}</div>}

        {recent.length > 0 && (
          <section className="space-y-2">
            <div className="font-medium">最近的工作空间</div>
            <div className="grid gap-2">
              {recent.map((w) => (
                <button key={w.id} className="panel p-3 text-left hover:border-[var(--accent)]" onClick={() => onOpen(w)}>
                  <div className="font-medium">{w.name}</div>
                  <div className="muted mono text-xs">{w.root}</div>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="space-y-2">
          <div className="font-medium">打开已有文件夹</div>
          <div className="panel p-3 space-y-2">
            <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); const p = pathInput.trim(); if (p) { setPathInput(''); void go(p); } }}>
              <button className="btn" type="button" disabled={!browse?.parent} onClick={() => { if (browse?.parent) void go(browse.parent); }}>上一级</button>
              <input className="flex-1 mono text-xs" placeholder={browse?.path ?? '输入绝对路径后回车跳转'} value={pathInput} onChange={(e) => setPathInput(e.target.value)} />
              <button className="btn btn-primary" type="button" disabled={!browse || busy} onClick={() => { if (browse) void openPath(browse.path); }}>打开这个文件夹</button>
            </form>
            <div className="mono text-xs muted truncate">当前：{browse?.path ?? '…'}</div>
            <div className="max-h-72 overflow-auto divide-y" style={{ borderColor: 'var(--line)' }}>
              {browse?.entries.map((e) => (
                <div key={e.path} className="flex items-center justify-between py-1.5">
                  <button className="text-left hover:underline" onClick={() => { void go(e.path); }}>{e.name}/</button>
                  <button className="btn text-xs" disabled={busy} onClick={() => { void openPath(e.path); }}>打开</button>
                </div>
              ))}
              {browse && browse.entries.length === 0 && <div className="muted py-2">没有子文件夹</div>}
            </div>
          </div>
        </section>

        <section className="space-y-2">
          <div className="font-medium">在当前位置新建文件夹</div>
          <div className="flex gap-2">
            <input className="flex-1" placeholder="新文件夹名" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <button className="btn" disabled={!newName.trim() || busy} onClick={() => { void createHere(); }}>新建并打开</button>
          </div>
        </section>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { ArrowRight, ChevronRight, Folder, FolderPlus, Sparkles } from 'lucide-react';
import { kimi, type FsBrowse, type Workspace } from '#/lib/api';
import { FolderGlyph } from '#/components/icons';

export function OpenWorkspace({ onOpen, onAbout }: { onOpen: (w: Workspace) => void; onAbout: () => void }) {
  const [recent, setRecent] = useState<Workspace[]>([]);
  const [browse, setBrowse] = useState<FsBrowse | null>(null);
  const [pathInput, setPathInput] = useState('');
  const [newName, setNewName] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    kimi.workspaces().then((r) => setRecent(r.items)).catch((error: Error) => setError(error.message));
    kimi.fsHome().then((h) => kimi.fsBrowse(h.home)).then(setBrowse).catch((error: Error) => setError(error.message));
  }, []);

  const go = (path: string) => kimi.fsBrowse(path).then((b) => { setBrowse(b); setBrowsing(true); }).catch((error: Error) => setError(error.message));
  const openPath = async (root: string) => {
    setBusy(true); setError(null);
    try { onOpen(await kimi.createWorkspace(root)); } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  };
  const createHere = async () => {
    if (!browse || !newName.trim()) return;
    setBusy(true); setError(null);
    try { const made = await kimi.fsMkdir(browse.path.replace(/\/$/, '') + '/' + newName.trim()); onOpen(await kimi.createWorkspace(made.path)); } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  };
  const submit = () => { const p = pathInput.trim(); if (!p) { setBrowsing(true); return; } void openPath(p); };

  return (
    <div className="h-full overflow-auto" style={{ background: 'var(--canvas)' }}>
      <nav className="about-nav chrome" style={{ position: 'static', background: 'transparent', border: 0 }}>
        <span className="brand"><span className="brand-mark" />Continuo</span>
        <span className="flex-1" />
        <button onClick={onAbout}>四个判断</button>
      </nav>
      <div className="open-hero">
        <FolderGlyph size={72} />
        <h1>选一个文件夹，把工作交出去</h1>
        <p>Continuo 会先了解这个文件夹，再开始干活。它做的每一步、记下的每一条，你都看得见、改得了。</p>
      </div>
      <div className="mx-auto space-y-8" style={{ maxWidth: 760, padding: '0 32px 80px' }}>
        {error && <div className="banner banner-err">{error}</div>}
        <form className="open-input" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <Folder size={18} className="t3" />
          <input placeholder="粘贴文件夹的绝对路径，或从下面选一个" value={pathInput} onChange={(e) => setPathInput(e.target.value)} />
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => setBrowsing(!browsing)}>浏览</button>
          <button className="send" type="submit" title="打开" disabled={busy}><ArrowRight size={16} /></button>
        </form>

        {browsing && browse && (
          <div className="card p-3 space-y-2 fade-in">
            <div className="flex items-center gap-2">
              <button className="btn btn-sm" disabled={!browse.parent} onClick={() => { if (browse.parent) void go(browse.parent); }}>上一级</button>
              <span className="t3 mono truncate flex-1" style={{ fontSize: 12 }}>{browse.path}</span>
              <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => { void openPath(browse.path); }}>打开当前文件夹</button>
            </div>
            <div className="max-h-64 overflow-auto">
              {browse.entries.map((e) => (
                <div key={e.path} className="side-row" style={{ height: 36 }}>
                  <Folder size={15} className="ic" />
                  <button className="text-left flex-1 truncate" onClick={() => { void go(e.path); }}>{e.name}</button>
                  <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => { void openPath(e.path); }}>打开</button>
                </div>
              ))}
              {browse.entries.length === 0 && <div className="t3 sm p-2">没有子文件夹</div>}
            </div>
            <form className="flex items-center gap-2 pt-1" onSubmit={(e) => { e.preventDefault(); void createHere(); }}>
              <FolderPlus size={16} className="t3" />
              <input className="flex-1" style={{ height: 32 }} placeholder="在这里新建文件夹" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <button className="btn btn-sm" type="submit" disabled={!newName.trim() || busy}>新建并打开</button>
            </form>
          </div>
        )}

        {recent.length > 0 && (
          <section className="space-y-3">
            <div className="side-section" style={{ padding: '0 2px' }}><span>最近打开</span></div>
            <div className="recent-grid">
              {recent.slice(0, 8).map((w) => (
                <button key={w.id} className="recent-card" onClick={() => onOpen(w)} title={w.root}>
                  <FolderGlyph size={34} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{w.name}</div>
                    <div className="t3 xs truncate">{w.root}</div>
                  </div>
                  <ChevronRight size={16} className="t3" />
                </button>
              ))}
            </div>
          </section>
        )}

        <button className="recent-card w-full" onClick={onAbout}>
          <span className="brand-mark" style={{ width: 34, height: 34, borderRadius: 10 }}><Sparkles size={16} color="#fff" /></span>
          <div className="min-w-0 flex-1 text-left">
            <div className="font-medium">Continuo 的四个判断</div>
            <div className="t3 xs">Legibility · Proactiveness · Clarity · Direction</div>
          </div>
          <ArrowRight size={16} className="t3" />
        </button>
      </div>
    </div>
  );
}

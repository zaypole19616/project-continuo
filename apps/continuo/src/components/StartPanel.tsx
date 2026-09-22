import { useEffect, useState } from 'react';
import { ArrowRight, ChevronRight, Folder, FolderOpen, FolderPlus, Loader2 } from 'lucide-react';
import { continuo, kimi, type FsBrowse, type Workspace } from '#/lib/api';
import { FolderGlyph } from './icons';

type Mode = 'idle' | 'new' | 'open';

export function StartPanel({ onOpen, onReplayIntro }: { onOpen: (w: Workspace) => void; onReplayIntro: () => void }) {
  const [mode, setMode] = useState<Mode>('idle');
  const [browse, setBrowse] = useState<FsBrowse | null>(null);
  const [pathInput, setPathInput] = useState('');
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    kimi.fsHome().then((h) => kimi.fsBrowse(h.home)).then(setBrowse).catch((error: Error) => setError(error.message));
  }, []);

  const go = (path: string) => { void kimi.fsBrowse(path).then(setBrowse).catch((error: Error) => setError(error.message)); };
  const run = async (work: () => Promise<Workspace>) => {
    setBusy(true); setError(null);
    try { onOpen(await work()); } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  };
  const openPath = (root: string) => run(() => kimi.createWorkspace(root));
  const createHere = () => {
    if (!browse || !newName.trim()) return;
    void run(async () => { const made = await kimi.fsMkdir(browse.path.replace(/\/$/, '') + '/' + newName.trim()); return kimi.createWorkspace(made.path); });
  };

  return (
    <section className="pane pane-main" aria-label="开始">
      <header className="chat-header chrome"><span className="chat-title">开始</span></header>
      <div className="pane-body chat-body">
        <div className="chat-col start">
          <div className="start-hero fade-in">
            <FolderGlyph size={56} />
            <h2>从一个文件夹开始</h2>
            <p className="t2">Continuo 住在你的文件夹里：先了解它，再接你交代的任务，做完的东西放回文件夹。</p>
          </div>
          {error && <div className="banner banner-err">{error}</div>}
          <div className="start-grid">
            <button className={`start-card ${mode === 'new' ? 'is-active' : ''}`} onClick={() => setMode(mode === 'new' ? 'idle' : 'new')}>
              <span className="start-icon"><FolderPlus size={20} /></span>
              <span className="start-title">新建文件夹</span>
              <span className="start-desc">从零开始一个项目。它会随着你交代的任务，慢慢记住你怎么做事。</span>
            </button>
            <button className={`start-card ${mode === 'open' ? 'is-active' : ''}`} onClick={() => setMode(mode === 'open' ? 'idle' : 'open')}>
              <span className="start-icon"><FolderOpen size={20} /></span>
              <span className="start-title">打开已有的文件夹</span>
              <span className="start-desc">把现有的材料交给它。它先了解你已经做到哪，再接着干。</span>
            </button>
          </div>

          {mode === 'new' && browse && (
            <div className="card p-4 space-y-3 fade-in">
              <div className="t3 xs">放在哪</div>
              <Crumbs browse={browse} onGo={go} />
              <FolderList browse={browse} onGo={go} />
              <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); createHere(); }}>
                <input className="flex-1" style={{ height: 40 }} placeholder="给新文件夹起个名字" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
                <button className="btn btn-primary" type="submit" disabled={!newName.trim() || busy}>{busy ? <Loader2 size={14} className="spin" /> : null}新建并打开</button>
              </form>
            </div>
          )}

          {mode === 'open' && browse && (
            <div className="card p-4 space-y-3 fade-in">
              <form className="open-input" style={{ height: 44, borderRadius: 22 }} onSubmit={(e) => { e.preventDefault(); const p = pathInput.trim(); if (p) void openPath(p); }}>
                <Folder size={16} className="t3" />
                <input placeholder="粘贴文件夹路径，或在下面选一个" value={pathInput} onChange={(e) => setPathInput(e.target.value)} autoFocus />
                <button className="send" type="submit" title="打开" disabled={busy || !pathInput.trim()}><ArrowRight size={16} /></button>
              </form>
              <Crumbs browse={browse} onGo={go} />
              <FolderList browse={browse} onGo={go} />
              <div className="flex justify-end">
                <button className="btn btn-primary" disabled={busy} onClick={() => { void openPath(browse.path); }}>{busy ? <Loader2 size={14} className="spin" /> : null}打开这个文件夹</button>
              </div>
            </div>
          )}

          <p className="t3 sm start-foot">
            还没有合适的文件夹？<button className="link" disabled={busy} onClick={() => { void run(() => continuo.demo()); }}>用演示文件夹试试</button>，一个虚构公司的季度复盘，自带一段历史。
            <span className="start-dot">·</span><button className="link" onClick={onReplayIntro}>重看新手引导</button>
          </p>
        </div>
      </div>
    </section>
  );
}

function Crumbs({ browse, onGo }: { browse: FsBrowse; onGo: (path: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <button className="btn btn-sm" disabled={!browse.parent} onClick={() => { if (browse.parent) onGo(browse.parent); }}>上一级</button>
      <span className="t3 mono truncate flex-1" style={{ fontSize: 12 }}>{browse.path}</span>
    </div>
  );
}

function FolderList({ browse, onGo }: { browse: FsBrowse; onGo: (path: string) => void }) {
  return (
    <div className="max-h-56 overflow-auto">
      {browse.entries.map((e) => (
        <button key={e.path} className="side-row" style={{ height: 34 }} onClick={() => onGo(e.path)}>
          <Folder size={15} className="ic" /><span className="flex-1 truncate">{e.name}</span><ChevronRight size={14} className="t3" />
        </button>
      ))}
      {browse.entries.length === 0 && <div className="t3 sm p-2">这里没有子文件夹</div>}
    </div>
  );
}

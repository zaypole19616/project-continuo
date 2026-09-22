import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, Folder, FolderPlus, Loader2, Play, Search } from 'lucide-react';
import { continuo, kimi, readRecent, type FsBrowse, type Workspace } from '#/lib/api';
import { FolderGlyph } from './icons';

type Mode = 'list' | 'browse' | 'create';

export function FolderMenu({ anchor, currentId, onPick, onClose }: { anchor: DOMRect; currentId?: string; onPick: (w: Workspace) => void; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>('list');
  const [recent, setRecent] = useState<Workspace[]>([]);
  const [browse, setBrowse] = useState<FsBrowse | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const ids = readRecent();
    kimi.workspaces()
      .then((r) => {
        const seen = new Set<string>();
        const items: Workspace[] = [];
        for (const id of ids) {
          const found = r.items.find((w) => w.id === id);
          if (found === undefined || seen.has(found.root)) continue;
          seen.add(found.root);
          items.push(found);
        }
        setRecent(items.slice(0, 6));
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const openBrowser = (next: Mode) => {
    setMode(next); setError(null);
    if (browse === null) void kimi.fsHome().then((h) => kimi.fsBrowse(h.home)).then(setBrowse).catch((error: Error) => { setError(error.message); });
  };
  const go = (path: string) => { void kimi.fsBrowse(path).then(setBrowse).catch((error: Error) => { setError(error.message); }); };
  const run = async (work: () => Promise<Workspace>) => {
    setBusy(true); setError(null);
    try { onPick(await work()); onClose(); } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  };

  const width = 320;
  const below = anchor.bottom + 8;
  const top = below + 380 > window.innerHeight && anchor.top > 400 ? undefined : below;
  const style: React.CSSProperties = {
    left: Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8)),
    width,
    ...(top === undefined ? { bottom: window.innerHeight - anchor.top + 8 } : { top }),
  };
  return createPortal(
    <div className="folder-menu" ref={box} role="dialog" aria-label="选择文件夹" style={style}>
      {error && <div className="banner banner-err" style={{ margin: 8 }}>{error}</div>}
      {mode === 'list' && (
        <>
          {recent.length > 0 && <div className="menu-label">最近的文件夹</div>}
          {recent.map((w) => (
            <button key={w.id} className={`menu-row ${w.id === currentId ? 'is-selected' : ''}`} title={w.root} onClick={() => { onPick(w); onClose(); }}>
              <FolderGlyph size={16} /><span className="flex-1 truncate">{w.name}</span>
            </button>
          ))}
          <div className="menu-sep" />
          <button className="menu-row" onClick={() => openBrowser('browse')}><Folder size={15} className="t2" /><span className="flex-1">打开已有的文件夹…</span></button>
          <button className="menu-row" onClick={() => openBrowser('create')}><FolderPlus size={15} className="t2" /><span className="flex-1">新建文件夹…</span></button>
          <button className="menu-row" disabled={busy} onClick={() => { void run(() => continuo.demo()); }}><Play size={15} className="t2" /><span className="flex-1">用演示文件夹试试</span></button>
        </>
      )}
      {mode !== 'list' && (
        <>
          <div className="menu-head">
            <button className="btn btn-sm btn-ghost" onClick={() => setMode('list')}>返回</button>
            <span className="t3 truncate flex-1" style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>{browse?.path ?? '…'}</span>
            <button className="btn btn-sm" disabled={!browse?.parent} onClick={() => { if (browse?.parent) go(browse.parent); }}>上一级</button>
          </div>
          <div className="menu-list">
            {browse === null && <div className="t3 sm p-3"><Loader2 size={13} className="spin" /> 读取中…</div>}
            {browse?.entries.map((e) => (
              <button key={e.path} className="menu-row" onClick={() => go(e.path)}>
                <Folder size={15} className="t2" /><span className="flex-1 truncate">{e.name}</span><ChevronRight size={13} className="t3" />
              </button>
            ))}
            {browse !== null && browse.entries.length === 0 && <div className="t3 sm p-3">这里没有子文件夹</div>}
          </div>
          {mode === 'browse'
            ? <div className="menu-foot"><button className="btn btn-primary btn-sm w-full" disabled={busy || browse === null} onClick={() => { void run(() => kimi.createWorkspace(browse!.path)); }}>{busy ? <Loader2 size={13} className="spin" /> : <Search size={13} />}打开这个文件夹</button></div>
            : <form className="menu-foot flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (browse && name.trim()) void run(async () => { const made = await kimi.fsMkdir(`${browse.path.replace(/\/$/, '')}/${name.trim()}`); return kimi.createWorkspace(made.path); }); }}>
                <input className="flex-1" style={{ height: 32 }} placeholder="新文件夹的名字" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
                <button className="btn btn-primary btn-sm" type="submit" disabled={busy || !name.trim()}>新建</button>
              </form>}
        </>
      )}
    </div>,
    document.body,
  );
}

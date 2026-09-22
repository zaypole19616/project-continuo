import { useEffect, useState } from 'react';
import { ChevronRight, CircleHelp } from 'lucide-react';
import { continuo, DEFAULT_MODEL, kimi, readRecent, type Workspace } from '#/lib/api';
import type { ThemePref } from '#/lib/theme';
import { FolderPicker } from '#/components/FolderPicker';

export function Launcher({ onOpen, themePref, onTheme, onReplayIntro }: { onOpen: (w: Workspace) => void; themePref: ThemePref; onTheme: (pref: ThemePref) => void; onReplayIntro: () => void }) {
  const [recent, setRecent] = useState<Workspace[]>([]);
  const [picker, setPicker] = useState<'open' | 'create' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const ids = readRecent();
    kimi.workspaces().then((r) => {
      if (cancelled) return;
      const seen = new Set<string>();
      const list: Workspace[] = [];
      for (const id of ids) {
        const found = r.items.find((w) => w.id === id);
        if (found === undefined || seen.has(found.root)) continue;
        seen.add(found.root);
        list.push(found);
      }
      setRecent(list.slice(0, 6));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const demo = async () => {
    setBusy(true);
    setError(null);
    try { onOpen(await continuo.demo()); } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="launcher-stage">
      <div className="launcher">
        <span className="launcher-mark" aria-hidden="true" />
        <h1>Continuo</h1>
        <p className="ver">基于 Kimi Code · {DEFAULT_MODEL.split('/').pop()}</p>
        <div className="launch-card">
          <div className="launch-pair">
            <div className="launch-cell">
              <b>新建项目</b><span>在指定位置创建一个新的项目文件夹。</span>
              <button className="launch-btn" onClick={() => setPicker('create')}>创建</button>
            </div>
            <div className="launch-cell">
              <b>打开已有项目</b><span>把一个本地文件夹作为项目打开。</span>
              <button className="launch-btn" onClick={() => setPicker('open')}>打开</button>
            </div>
          </div>
          {recent.length > 0 && (
            <div className="launch-recent">
              <div className="lbl">最近打开</div>
              {recent.map((w) => (
                <button key={w.id} className="recent-row" title={w.root} onClick={() => onOpen(w)}>
                  <span className="meta"><span className="name block">{w.name}</span><span className="path block">{w.root}</span></span>
                  <ChevronRight size={16} className="chev" />
                </button>
              ))}
            </div>
          )}
          <div className="launch-foot">
            <button className="help" title="使用引导" onClick={onReplayIntro}><CircleHelp size={16} /></button>
            <select className="theme-select" value={themePref} onChange={(e) => onTheme(e.target.value as ThemePref)} aria-label="外观">
              <option value="dark">深色</option>
              <option value="light">浅色</option>
              <option value="system">跟随系统</option>
            </select>
            <span className="launch-note">还没有项目？<button className="link" disabled={busy} onClick={() => { void demo(); }}>用演示项目试试</button></span>
          </div>
        </div>
        {error !== null && <div className="banner banner-err" style={{ marginTop: 12, width: '100%' }}>{error}</div>}
      </div>
      <FolderPicker mode={picker ?? 'open'} open={picker !== null} onOpenChange={(open) => { if (!open) setPicker(null); }} onPick={(w) => { setPicker(null); onOpen(w); }} />
    </div>
  );
}

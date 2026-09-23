import { useEffect, useState } from 'react';
import { DEFAULT_MODEL, kimi, readRecent, type Workspace } from '#/lib/api';
import { FolderPicker } from '#/components/FolderPicker';
import { ThemeToggle } from '#/components/ThemeToggle';
import type { ThemePref } from '#/lib/theme';

export function Launcher({ onOpen, themePref, onTheme }: { onOpen: (w: Workspace) => void; themePref: ThemePref; onTheme: (pref: ThemePref) => void }) {
  const [recent, setRecent] = useState<Workspace[]>([]);
  const [picker, setPicker] = useState<'open' | 'create' | null>(null);

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
      setRecent(list.slice(0, 5));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="launcher-stage">
      <ThemeToggle themePref={themePref} onTheme={onTheme} className="launcher-theme" />
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
                  <span className="name block">{w.name}</span><span className="path block">{w.root}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <FolderPicker mode={picker ?? 'open'} open={picker !== null} onOpenChange={(open) => { if (!open) setPicker(null); }} onPick={(w) => { setPicker(null); onOpen(w); }} />
    </div>
  );
}

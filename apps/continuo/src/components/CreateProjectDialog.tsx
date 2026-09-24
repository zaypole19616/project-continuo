import { useEffect, useRef, useState } from 'react';
import { FolderOpen, Loader2, X } from 'lucide-react';
import { continuo, kimi, type Workspace } from '#/lib/api';
import { Button } from '#/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '#/components/ui/dialog';
import { FolderPicker } from './FolderPicker';

export function CreateProjectDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (w: Workspace) => void }) {
  const [name, setName] = useState('');
  const [parent, setParent] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const gaveUp = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) { setName(''); setError(null); return; }
    if (parent === null) void kimi.fsHome().then((h) => setParent(`${h.home}/Documents`)).catch(() => undefined);
  }, [open, parent]);

  const trimmed = name.trim();
  const nameProblem = /[/:]/.test(trimmed) ? '名称里不能有 / 或 :' : undefined;

  const choose = async () => {
    setChoosing(true);
    setError(null);
    gaveUp.current = false;
    try {
      const picked = await continuo.chooseFolder('选择项目路径', parent ?? undefined);
      if (!gaveUp.current && picked.path !== null) setParent(picked.path);
    } catch {
      if (!gaveUp.current) setBrowsing(true);
    } finally {
      setChoosing(false);
    }
  };
  const pickInPage = () => { gaveUp.current = true; setChoosing(false); setBrowsing(true); };

  const save = async () => {
    if (parent === null || trimmed === '' || nameProblem !== undefined) return;
    setSaving(true);
    setError(null);
    try {
      const siblings = await kimi.fsBrowse(parent);
      if (siblings.entries.some((entry) => entry.name === trimmed)) { setError(`这个位置已经有叫「${trimmed}」的文件夹`); return; }
      const made = await kimi.fsMkdir(`${parent.replace(/\/$/, '')}/${trimmed}`);
      onCreated(await kimi.createWorkspace(made.path));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog open={open && !browsing} onOpenChange={onOpenChange}>
        <DialogContent className="create-dialog">
          <div className="cd-head">
            <DialogTitle className="cd-title">创建项目</DialogTitle>
            <button className="icon-btn" aria-label="关闭" title="关闭" onClick={() => onOpenChange(false)}><X size={18} /></button>
          </div>
          <DialogDescription className="sr-only">给项目起一个名字，并选择它放在哪里。</DialogDescription>
          <label className="cd-label" htmlFor="project-name">项目名称<span className="cd-req">*</span></label>
          <input id="project-name" className="cd-field" autoFocus placeholder="请输入文件夹名称" value={name} onChange={(e) => { setName(e.target.value); setError(null); }} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void save(); }} />
          {nameProblem !== undefined && <div className="cd-error">{nameProblem}</div>}
          <span className="cd-label">选择项目路径<span className="cd-req">*</span></span>
          <button className="cd-field cd-path" onClick={() => void choose()} disabled={choosing} title={parent ?? undefined}>
            {choosing ? <Loader2 size={18} className="spin" /> : <FolderOpen size={18} />}
            <span className="cd-path-text">{parent ?? '…'}</span>
          </button>
          {choosing && <button className="pick-fallback" onClick={pickInPage}>没看到窗口？在页面里选</button>}
          {error !== null && <div className="cd-error">{error}</div>}
          <div className="cd-actions">
            <Button variant="secondary" className="cd-btn" onClick={() => onOpenChange(false)}>取消</Button>
            <Button variant="default" className="cd-btn" disabled={saving || parent === null || trimmed === '' || nameProblem !== undefined} onClick={() => void save()}>{saving && <Loader2 className="spin" />}保存</Button>
          </div>
        </DialogContent>
      </Dialog>
      <FolderPicker title="选择项目路径" confirmLabel="选这个位置" start={parent ?? undefined} open={browsing} onOpenChange={setBrowsing} onPick={(path) => { setParent(path); setBrowsing(false); }} />
    </>
  );
}

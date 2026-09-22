import { useEffect, useState } from 'react';
import { ChevronRight, Folder, Loader2 } from 'lucide-react';
import { kimi, type FsBrowse, type Workspace } from '#/lib/api';
import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '#/components/ui/dialog';

export function FolderPicker({ mode, open, onOpenChange, onPick }: { mode: 'open' | 'create'; open: boolean; onOpenChange: (open: boolean) => void; onPick: (w: Workspace) => void }) {
  const [browse, setBrowse] = useState<FsBrowse | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) { setError(null); setName(''); return; }
    if (browse !== null) return;
    void kimi.fsHome().then((h) => kimi.fsBrowse(h.home)).then(setBrowse).catch((error: Error) => { setError(error.message); });
  }, [open, browse]);

  const go = (path: string) => { void kimi.fsBrowse(path).then(setBrowse).catch((error: Error) => { setError(error.message); }); };
  const run = async (work: () => Promise<Workspace>) => {
    setBusy(true);
    setError(null);
    try { onPick(await work()); } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  };
  const confirm = () => {
    if (browse === null) return;
    if (mode === 'open') { void run(() => kimi.createWorkspace(browse.path)); return; }
    if (name.trim().length === 0) return;
    void run(async () => {
      const made = await kimi.fsMkdir(`${browse.path.replace(/\/$/, '')}/${name.trim()}`);
      return kimi.createWorkspace(made.path);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-w-lg flex-col gap-3 p-6 text-left">
        <DialogTitle className="text-lg">{mode === 'create' ? '新建项目' : '打开已有项目'}</DialogTitle>
        <DialogDescription className="text-sm">{mode === 'create' ? '选一个位置，给项目起个名字。' : '选一个本地文件夹，作为项目打开。'}</DialogDescription>
        {error !== null && <div className="banner banner-err">{error}</div>}
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" disabled={!browse?.parent} onClick={() => { if (browse?.parent) go(browse.parent); }}>上一级</Button>
          <span className="mono flex-1 truncate text-xs text-muted-foreground" title={browse?.path}>{browse?.path ?? '…'}</span>
        </div>
        <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
          {browse === null && <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />读取中…</div>}
          {browse?.entries.map((e) => (
            <button key={e.path} className="flex h-9 w-full items-center gap-2 px-3 text-sm hover:bg-muted" onClick={() => go(e.path)}>
              <Folder className="size-4 text-muted-foreground" /><span className="flex-1 truncate text-left">{e.name}</span><ChevronRight className="size-3.5 text-muted-foreground" />
            </button>
          ))}
          {browse !== null && browse.entries.length === 0 && <div className="p-3 text-sm text-muted-foreground">这里没有子文件夹</div>}
        </div>
        {mode === 'create' && (
          <Input autoFocus placeholder="项目名称" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') confirm(); }} />
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
          <Button variant="default" disabled={busy || browse === null || (mode === 'create' && name.trim().length === 0)} onClick={confirm}>
            {busy && <Loader2 className="animate-spin" />}{mode === 'create' ? '新建并打开' : '打开这个文件夹'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useState } from 'react';
import { ChevronRight, Folder, Loader2 } from 'lucide-react';
import { kimi, type FsBrowse } from '#/lib/api';
import { Button } from '#/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '#/components/ui/dialog';

export function FolderPicker({ title, confirmLabel, start, open, onOpenChange, onPick }: { title: string; confirmLabel: string; start?: string; open: boolean; onOpenChange: (open: boolean) => void; onPick: (path: string) => void }) {
  const [browse, setBrowse] = useState<FsBrowse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) { setError(null); setBrowse(null); return; }
    const first = start === undefined ? kimi.fsHome().then((h) => kimi.fsBrowse(h.home)) : kimi.fsBrowse(start).catch(() => kimi.fsHome().then((h) => kimi.fsBrowse(h.home)));
    void first.then(setBrowse).catch((error: Error) => { setError(error.message); });
  }, [open, start]);

  const go = (path: string) => { void kimi.fsBrowse(path).then(setBrowse).catch((error: Error) => { setError(error.message); }); };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-w-lg flex-col gap-3 p-6 text-left">
        <DialogTitle className="text-lg">{title}</DialogTitle>
        <DialogDescription className="text-sm">直接在这里选一个文件夹。</DialogDescription>
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
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
          <Button variant="default" disabled={browse === null} onClick={() => { if (browse !== null) onPick(browse.path); }}>{confirmLabel}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

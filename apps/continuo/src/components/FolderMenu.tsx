import { useEffect, useState, type ReactNode } from 'react';
import { ChevronLeft, Folder, FolderPlus, Loader2, Play } from 'lucide-react';
import { continuo, kimi, readRecent, type FsBrowse, type Workspace } from '#/lib/api';
import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuCheck,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu';
import { FolderGlyph } from './icons';

type Mode = 'list' | 'browse' | 'create';

export function FolderMenu({ trigger, align, currentId, onPick }: { trigger: ReactNode; align?: 'start' | 'end'; currentId?: string; onPick: (w: Workspace) => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('list');
  const [recent, setRecent] = useState<Workspace[]>([]);
  const [browse, setBrowse] = useState<FsBrowse | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) { setMode('list'); setError(null); return; }
    const ids = readRecent();
    kimi.workspaces().then((r) => {
      const seen = new Set<string>();
      const items: Workspace[] = [];
      for (const id of ids) {
        const found = r.items.find((w) => w.id === id);
        if (found === undefined || seen.has(found.root)) continue;
        seen.add(found.root);
        items.push(found);
      }
      setRecent(items.slice(0, 6));
    }).catch(() => undefined);
  }, [open]);

  const go = (path: string) => { void kimi.fsBrowse(path).then(setBrowse).catch((error: Error) => { setError(error.message); }); };
  const openBrowser = (next: Mode) => {
    setMode(next);
    setError(null);
    if (browse === null) void kimi.fsHome().then((h) => kimi.fsBrowse(h.home)).then(setBrowse).catch((error: Error) => { setError(error.message); });
  };
  const run = async (work: () => Promise<Workspace>) => {
    setBusy(true);
    setError(null);
    try { onPick(await work()); setOpen(false); } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align={align ?? 'start'} className="w-80">
        {error !== null && <div className="banner banner-err mb-1">{error}</div>}
        {mode === 'list' ? (
          <>
            {recent.length > 0 && <DropdownMenuLabel>最近的文件夹</DropdownMenuLabel>}
            {recent.map((w) => (
              <DropdownMenuItem key={w.id} onSelect={() => onPick(w)} title={w.root}>
                <FolderGlyph size={16} />
                <span className="flex-1 truncate">{w.name}</span>
                <DropdownMenuCheck shown={w.id === currentId} />
              </DropdownMenuItem>
            ))}
            {recent.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem onSelect={(e) => { e.preventDefault(); openBrowser('browse'); }}><Folder />打开已有的文件夹…</DropdownMenuItem>
            <DropdownMenuItem onSelect={(e) => { e.preventDefault(); openBrowser('create'); }}><FolderPlus />新建文件夹…</DropdownMenuItem>
            <DropdownMenuItem disabled={busy} onSelect={(e) => { e.preventDefault(); void run(() => continuo.demo()); }}><Play />用演示文件夹试试</DropdownMenuItem>
          </>
        ) : (
          <div className="p-1" onKeyDown={(e) => { e.stopPropagation(); }}>
            <div className="mb-1.5 flex items-center gap-1.5">
              <Button variant="ghost" size="icon-sm" aria-label="返回" onClick={() => setMode('list')}><ChevronLeft /></Button>
              <span className="mono flex-1 truncate text-xs text-muted-foreground" title={browse?.path}>{browse?.path ?? '…'}</span>
              <Button variant="ghost" size="sm" disabled={!browse?.parent} onClick={() => { if (browse?.parent) go(browse.parent); }}>上一级</Button>
            </div>
            <div className="max-h-56 overflow-y-auto">
              {browse === null && <div className="flex items-center gap-2 p-2 text-sm text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />读取中…</div>}
              {browse?.entries.map((e) => (
                <button key={e.path} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm hover:bg-muted" onClick={() => go(e.path)}>
                  <Folder className="size-4 text-muted-foreground" /><span className="flex-1 truncate text-left">{e.name}</span>
                </button>
              ))}
              {browse !== null && browse.entries.length === 0 && <div className="p-2 text-sm text-muted-foreground">这里没有子文件夹</div>}
            </div>
            {mode === 'browse' ? (
              <Button variant="default" className="mt-1.5 w-full" disabled={busy || browse === null} onClick={() => { void run(() => kimi.createWorkspace(browse!.path)); }}>
                {busy && <Loader2 className="animate-spin" />}打开这个文件夹
              </Button>
            ) : (
              <form
                className="mt-1.5 flex items-center gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (browse === null || name.trim().length === 0) return;
                  void run(async () => {
                    const made = await kimi.fsMkdir(`${browse.path.replace(/\/$/, '')}/${name.trim()}`);
                    return kimi.createWorkspace(made.path);
                  });
                }}
              >
                <Input autoFocus placeholder="新文件夹的名字" value={name} onChange={(e) => setName(e.target.value)} />
                <Button variant="default" type="submit" disabled={busy || name.trim().length === 0}>新建</Button>
              </form>
            )}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

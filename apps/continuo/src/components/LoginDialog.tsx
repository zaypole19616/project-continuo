import { useEffect, useRef, useState } from 'react';
import { Check, ExternalLink, Loader2 } from 'lucide-react';
import { kimi } from '#/lib/api';
import { Button } from '#/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '#/components/ui/dialog';

type Phase = { kind: 'starting' } | { kind: 'waiting'; url: string } | { kind: 'done' } | { kind: 'failed'; message: string };

const ENDED: Record<string, string> = { denied: '授权被拒绝了。', expired: '登录链接过期了。', cancelled: '登录已取消。' };

function LoginDialog({ open, popup, onClose, onDone }: { open: boolean; popup: React.RefObject<Window | null>; onClose: () => void; onDone: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'starting' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => { popup.current?.close(); setPhase({ kind: 'done' }); timer = setTimeout(onDone, 900); };
    const poll = (interval: number) => {
      timer = setTimeout(() => {
        void kimi.loginPoll().then((flow) => {
          if (cancelled) return;
          if (flow?.status === 'authenticated') finish();
          else if (flow === null || flow.status === 'pending') poll(interval);
          else setPhase({ kind: 'failed', message: flow.error_message ?? ENDED[flow.status] ?? '没有登录成功。' });
        }).catch(() => { if (!cancelled) poll(interval); });
      }, interval);
    };
    setPhase({ kind: 'starting' });
    kimi.loginStart().then((flow) => {
      if (cancelled) return;
      if (flow.status === 'authenticated') { finish(); return; }
      const url = flow.verification_uri_complete ?? '';
      if (popup.current !== null && !popup.current.closed) popup.current.location.href = url;
      setPhase({ kind: 'waiting', url });
      poll(Math.max(2, flow.interval ?? 5) * 1000);
    }).catch((error: Error) => { if (!cancelled) { popup.current?.close(); setPhase({ kind: 'failed', message: error.message }); } });
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, attempt]);
  const cancel = () => { if (phase.kind === 'waiting' || phase.kind === 'starting') void kimi.loginCancel().catch(() => undefined); popup.current?.close(); onClose(); };
  const retry = () => { popup.current = window.open('', '_blank'); setAttempt((n) => n + 1); };
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) cancel(); }}>
      <DialogContent className="flex max-w-md flex-col gap-4 p-6 text-left">
        <DialogTitle className="text-lg">登录 Kimi 账号</DialogTitle>
        {phase.kind === 'done'
          ? <DialogDescription className="text-sm"><span className="login-wait"><Check size={15} className="login-ok" />登录成功，可以开始了。</span></DialogDescription>
          : phase.kind === 'failed'
            ? <>
              <DialogDescription className="text-sm">{phase.message}</DialogDescription>
              <div className="flex justify-end gap-2"><Button variant="secondary" onClick={cancel}>取消</Button><Button onClick={retry}>重新登录</Button></div>
            </>
            : <>
              <DialogDescription className="text-sm">请在刚打开的页面上用 Kimi 账号登录，完成后这里会自动继续。</DialogDescription>
              <div className="login-wait"><Loader2 size={14} className="spin" />{phase.kind === 'starting' ? '正在打开登录页…' : '等你在浏览器里完成登录…'}</div>
              {phase.kind === 'waiting' && phase.url !== '' && <div className="login-fallback">页面没有打开？<a className="login-link" href={phase.url} target="_blank" rel="noreferrer">点这里打开 <ExternalLink size={12} /></a></div>}
              <div className="flex justify-end"><Button variant="secondary" onClick={cancel}>取消</Button></div>
            </>}
      </DialogContent>
    </Dialog>
  );
}

export function useKimiLogin(onDone: () => void): { start: () => void; dialog: React.ReactNode } {
  const [open, setOpen] = useState(false);
  const popup = useRef<Window | null>(null);
  const start = () => { popup.current = window.open('', '_blank'); setOpen(true); };
  const dialog = <LoginDialog open={open} popup={popup} onClose={() => setOpen(false)} onDone={() => { setOpen(false); onDone(); }} />;
  return { start, dialog };
}

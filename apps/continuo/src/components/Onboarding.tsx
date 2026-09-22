import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '#/components/ui/dialog';
import { Button } from '#/components/ui/button';
import { BookMarked, CheckCircle2, FolderOpen, MessageCircleQuestion } from 'lucide-react';

const STEPS = [
  { icon: FolderOpen, kicker: 'Continuo', title: '把一个文件夹交给它', body: 'Continuo 住在你的文件夹里。你交代任务，它在文件夹里干活，做完的东西放回文件夹。' },
  { icon: BookMarked, kicker: 'Orderliness · 有条理', title: '它记住你怎么做事', body: '第一次打开，它先读一遍文件夹，记下约定和决定。以后每个任务都带着这些干，你不用再交代一遍。' },
  { icon: MessageCircleQuestion, kicker: 'Proactiveness · 不乱打扰', title: '要你决定时才问', body: '材料里没有的决定它不编，会停下来问你。你回一句，它接着干。' },
  { icon: CheckCircle2, kicker: 'Clarity · 说清楚', title: '做完了才说做完', body: '任务结束时它核对文件是不是真的在文件夹里，告诉你做了什么、记住了什么、下次打开会怎样。' },
];

export const ONBOARDED_KEY = 'continuo.onboarded';

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const last = step === STEPS.length - 1;
  const next = () => { if (last) onDone(); else setStep(step + 1); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); next(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const Icon = STEPS[step]!.icon;
  return (
    <Dialog open onOpenChange={() => undefined}>
      <DialogContent onEscapeKeyDown={(e) => { e.preventDefault(); }} onInteractOutside={(e) => { e.preventDefault(); }} className="flex flex-col items-center gap-3 text-center">
        <span className="onboard-icon"><Icon size={26} /></span>
        <div className="onboard-kicker">{STEPS[step]!.kicker}</div>
        <DialogTitle>{STEPS[step]!.title}</DialogTitle>
        <DialogDescription className="min-h-19">{STEPS[step]!.body}</DialogDescription>
        <div className="mt-3.5 flex w-full items-center justify-between">
          <span className="onboard-dots">{STEPS.map((_, i) => <i key={i} className={i === step ? 'is-active' : ''} />)}</span>
          <Button variant="default" autoFocus onClick={next}>{last ? '开始使用' : '下一步'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

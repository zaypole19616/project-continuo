import { useEffect, useState } from 'react';
import { BookMarked, CheckCircle2, FolderOpen, MessageCircleQuestion } from 'lucide-react';

const STEPS = [
  { icon: FolderOpen, kicker: 'Continuo', title: '把一个文件夹交给它', body: 'Continuo 住在你的文件夹里。你交代任务，它在文件夹里干活，做完的东西放回文件夹。' },
  { icon: BookMarked, kicker: 'Legibility · 有章法', title: '它记住你怎么做事', body: '第一次打开，它先读一遍文件夹，记下约定和决定。以后每个任务都带着这些干，你不用再交代一遍。' },
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
    <div className="onboard-backdrop" role="dialog" aria-modal="true" aria-label="新手引导">
      <div className="onboard fade-in" key={step}>
        <span className="onboard-icon"><Icon size={26} /></span>
        <div className="onboard-kicker">{STEPS[step]!.kicker}</div>
        <div className="onboard-title">{STEPS[step]!.title}</div>
        <div className="onboard-body">{STEPS[step]!.body}</div>
        <div className="onboard-foot">
          <span className="onboard-dots">{STEPS.map((_, i) => <i key={i} className={i === step ? 'is-active' : ''} />)}</span>
          <button className="btn btn-primary" onClick={next} autoFocus>{last ? '开始使用' : '下一步'}</button>
        </div>
      </div>
    </div>
  );
}

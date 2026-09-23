import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '#/components/ui/dialog';
import { Button } from '#/components/ui/button';
import { BookMarked, CheckCircle2, FolderOpen, GitFork, ListTodo } from 'lucide-react';

const STEPS = [
  { icon: FolderOpen, kicker: 'Continuo', title: '把一个文件夹交给它', body: '它住在你的文件夹里：你交代任务，它在文件夹里干活，做完的东西放回文件夹。关掉再开，从文件夹里接着干。', where: '创建一个项目，或打开已有的文件夹' },
  { icon: BookMarked, kicker: 'Orderliness · 有条理', title: '照你的规矩做事', body: '第一次打开，它先读 AGENTS.md 和目录，记下有来源的项目要点。每件事做完，在 work-log/ 留一份日志，下次接着干不用再交代一遍。', where: '对话顶部「了解这个文件夹」· 文件区的 work-log/' },
  { icon: ListTodo, kicker: 'Proactiveness · 有分寸', title: '主动，但不抢你的注意力', body: '它会提下一步的建议，做不做由你：立即执行、划掉，或放进待办。缺关键决定时才停下来问；你随时可以暂停、补充或接着做。', where: '右上角「事项」· 输入框旁的权限' },
  { icon: CheckCircle2, kicker: 'Clarity · 坦诚清晰', title: '做完了才说做完', body: '收尾时它逐个核对文件是不是真的在，告诉你做了什么、还差什么、读过哪些资料；出了错也说清原因。', where: '每件事后面的收尾卡 · 文件区的预览与对比' },
  { icon: GitFork, kicker: '判断留给人，也被记下来', title: '方向不明时，给你几条路', body: '它把几个方案并排给你，写清各自适合什么、选择取决于什么。选了哪条、放弃哪条都记成轨迹；想换一条，原来的不动，随时切回去。', where: '对话里的方案卡 · 右上角「轨迹」' },
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
        <div className="onboard-where"><span>在哪里看</span>{STEPS[step]!.where}</div>
        <div className="mt-3.5 flex w-full items-center justify-between">
          <span className="onboard-dots">{STEPS.map((_, i) => <i key={i} className={i === step ? 'is-active' : ''} />)}</span>
          <Button variant="default" autoFocus onClick={next}>{last ? '开始使用' : '下一步'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

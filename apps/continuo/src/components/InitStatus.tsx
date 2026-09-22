import { useEffect, useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { Button } from '#/components/ui/button';
import type { ContinuoDoc } from '#/lib/api';

const STAGES: Array<[number, string]> = [
  [0, '正在了解你现有的工作…'],
  [12, '正在整理项目的背景和约定…'],
  [30, '正在分析材料…'],
  [55, '快好了，请稍候…'],
];

export function InitStatus({ doc, onReunderstand }: { doc: ContinuoDoc; onReunderstand: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const running = doc.init.status === 'running';
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [running]);
  if (running) {
    const started = doc.init.startedAt;
    const elapsed = started === undefined ? 0 : (now - new Date(started).getTime()) / 1000;
    return (
      <div className="init-status">
        <Loader2 className="size-4 shrink-0 animate-spin text-accent" />
        <div className="min-w-0">
          <div className="text-sm font-medium">{STAGES.findLast(([at]) => elapsed >= at)![1]}</div>
          <div className="t3 xs">只读不改，不用等它读完，可以直接交代任务。</div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-end">
      <Button variant="ghost" size="sm" title="再读一遍文件夹，重新形成理解（约一分钟）" onClick={onReunderstand}><RotateCcw />重新了解</Button>
    </div>
  );
}

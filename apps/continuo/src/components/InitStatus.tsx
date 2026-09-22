import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { ContinuoDoc } from '#/lib/api';

const STAGES: Array<[number, string]> = [
  [0, '正在了解你现有的工作…'],
  [12, '正在整理项目的背景和约定…'],
  [30, '正在分析材料…'],
  [55, '快好了，请稍候…'],
];

export function InitStatus({ doc }: { doc: ContinuoDoc }) {
  const [now, setNow] = useState(() => Date.now());
  const running = doc.init.status === 'running';
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [running]);
  if (!running) return null;
  const started = doc.init.startedAt;
  const elapsed = started === undefined ? 0 : (now - new Date(started).getTime()) / 1000;
  return (
    <div className="init-status">
      <Loader2 className="size-4 shrink-0 animate-spin text-accent" />
      <div className="text-sm font-medium">{STAGES.findLast(([at]) => elapsed >= at)![1]}</div>
    </div>
  );
}

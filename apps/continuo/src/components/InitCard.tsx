import { useEffect, useState } from 'react';
import { BookOpen, FileText, Loader2, RotateCcw } from 'lucide-react';
import type { ContinuoDoc, TaskError } from '#/lib/api';
import { Button } from '#/components/ui/button';
import { ErrorCard } from './ErrorCard';

const STAGES: Array<[number, string]> = [
  [0, '正在了解你现有的工作…'],
  [12, '正在整理项目的背景和约定…'],
  [30, '正在分析材料…'],
  [55, '快好了，请稍候…'],
];

export function InitCard({ doc, busy, onRetry, onOpenFile }: { doc: ContinuoDoc; busy: boolean; onRetry: () => void; onOpenFile: (path: string) => void }) {
  const [now, setNow] = useState(() => Date.now());
  const running = doc.init.status === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  const task = doc.init.taskId === undefined ? undefined : doc.tasks.find((candidate) => candidate.taskId === doc.init.taskId);
  const retry = <Button variant="default" size="sm" disabled={busy} onClick={onRetry}><RotateCcw size={12} />重新了解</Button>;

  if (running) {
    const started = doc.init.startedAt;
    const elapsed = started === undefined ? 0 : (now - Date.parse(started)) / 1000;
    return (
      <div className="init-status">
        <Loader2 className="size-4 shrink-0 animate-spin text-accent" />
        <div className="text-sm font-medium">{STAGES.findLast(([at]) => elapsed >= at)![1]}</div>
      </div>
    );
  }
  if (doc.init.status === 'failed') {
    const error: TaskError = task?.error ?? { code: 'turn.failed', message: task?.lastError ?? '没有完成', at: doc.init.endedAt ?? doc.init.startedAt ?? new Date().toISOString() };
    return <ErrorCard kicker="了解这个文件夹时出错" error={error} action={retry} />;
  }
  if (doc.init.status === 'stopped') {
    return <div className="state-bar chrome"><span className="t2 sm flex-1">了解这个文件夹时被打断了</span>{retry}</div>;
  }
  if (doc.understanding === undefined) return null;
  return (
    <div className="init-card fade-in">
      <div className="init-card-head">
        <BookOpen size={14} />
        <span className="font-medium">{doc.init.status === 'pending' ? '这个文件夹还是空的' : '已了解这个文件夹'}</span>
        {doc.init.status === 'partial' && <span className="t3">· 文件较多，只看了一部分</span>}
      </div>
      <div className="init-card-body">{doc.understanding.text}</div>
      {(doc.context.length > 0 || task?.logPath !== undefined) && (
        <div className="init-card-foot">
          {doc.context.length > 0 && <span className="t3">记下 {doc.context.length} 条项目要点</span>}
          <span className="flex-1" />
          {task?.logPath !== undefined && <button className="link" onClick={() => onOpenFile(task.logPath!)}><FileText size={12} />工作日志</button>}
        </div>
      )}
    </div>
  );
}

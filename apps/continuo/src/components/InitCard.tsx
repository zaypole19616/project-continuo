import { useEffect, useState } from 'react';
import { ArrowRight, BookOpen, FileText, Loader2, RotateCcw } from 'lucide-react';
import type { ContinuoDoc, TaskError } from '#/lib/api';
import { Button } from '#/components/ui/button';
import { ErrorCard } from './ErrorCard';

const STAGES: Array<[number, string]> = [
  [0, '正在看目录结构…'],
  [12, '正在读指引文件…'],
  [30, '正在整理项目的背景和约定…'],
  [55, '快好了…'],
];

function FileList({ files, onOpenFile }: { files: readonly string[]; onOpenFile: (path: string) => void }) {
  return (
    <div className="init-files">
      {files.map((path) => <button key={path} className="tag tag-neutral" title="在左侧打开" onClick={() => onOpenFile(path)}>{path}</button>)}
    </div>
  );
}

export function InitCard({ doc, busy, started, onRetry, onOpenFile, onStart }: {
  doc: ContinuoDoc; busy: boolean; started: boolean;
  onRetry: () => void; onOpenFile: (path: string) => void; onStart: (prompt: string) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const running = doc.init.status === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  const task = doc.init.taskId === undefined ? undefined : doc.tasks.find((candidate) => candidate.taskId === doc.init.taskId);
  const files = task?.sources ?? doc.understanding?.sourceRefs ?? [];
  const retry = <Button variant="default" size="sm" disabled={busy} onClick={onRetry}><RotateCcw size={12} />重新了解</Button>;

  if (running) {
    const started = doc.init.startedAt;
    const elapsed = started === undefined ? 0 : (now - Date.parse(started)) / 1000;
    return (
      <div className="init-card is-running fade-in">
        <div className="init-card-head"><Loader2 size={14} className="spin" /><span className="font-medium">正在了解这个文件夹</span></div>
        <div className="init-card-body">
          <div className="init-phase">{task?.phase ?? STAGES.findLast(([at]) => elapsed >= at)![1]}</div>
          {files.length > 0 && <><div className="init-sec">已读 {files.length} 个文件</div><FileList files={files} onOpenFile={onOpenFile} /></>}
        </div>
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
  const empty = doc.init.status === 'pending';
  const title = empty ? '这个文件夹还是空的' : '已了解这个文件夹';
  const suggestions = doc.understanding.suggestions ?? [];

  if (started) {
    return (
      <details className="init-card is-compact fade-in">
        <summary className="init-card-head">
          <BookOpen size={14} /><span className="font-medium">{title}</span>
          {!empty && <span className="t3">· 读过 {files.length} 个文件{doc.context.length > 0 ? ` · ${doc.context.length} 条要点` : ''}</span>}
        </summary>
        <div className="init-card-body">
          <div>{doc.understanding.text}</div>
          {files.length > 0 && <FileList files={files} onOpenFile={onOpenFile} />}
          {doc.context.length > 0 && <ul className="init-points">{doc.context.map((entry) => <li key={entry.id}>{entry.text}</li>)}</ul>}
          {task?.logPath !== undefined && <button className="link init-log" onClick={() => onOpenFile(task.logPath!)}><FileText size={12} />工作日志</button>}
        </div>
      </details>
    );
  }

  return (
    <div className="init-card fade-in">
      <div className="init-card-head">
        <BookOpen size={14} /><span className="font-medium">{title}</span>
        {doc.init.status === 'partial' && <span className="t3">· 文件较多，只看了一部分</span>}
      </div>
      <div className="init-card-body">
        <div>{doc.understanding.text}</div>
        {files.length > 0 && (
          <details>
            <summary className="init-sec">读过 {files.length} 个文件{doc.context.length > 0 ? `，记下 ${doc.context.length} 条要点` : ''}</summary>
            <FileList files={files} onOpenFile={onOpenFile} />
            {doc.context.length > 0 && <ul className="init-points">{doc.context.map((entry) => <li key={entry.id}>{entry.text}</li>)}</ul>}
          </details>
        )}
      </div>
      <div className="init-ask">
        <div className="init-ask-q">接下来想做什么？</div>
        {suggestions.length === 0
          ? <div className="t3 sm">{empty ? '放进材料，或者直接说第一件事。' : '我没有要先提的，等你安排。'}</div>
          : suggestions.map((item) => (
            <div key={item.title} className="init-suggestion">
              <div className="min-w-0 flex-1">
                <div className="init-suggestion-title">{item.title}</div>
                <div className="t3 xs">{item.reason}</div>
              </div>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => onStart(item.prompt)}>就做这个<ArrowRight size={12} /></Button>
            </div>
          ))}
      </div>
    </div>
  );
}

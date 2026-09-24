import { useEffect, useState } from 'react';
import { FileText, RotateCcw } from 'lucide-react';
import type { ContinuoDoc, ContinuoTodo, TaskError, TodoAction } from '#/lib/api';
import { Button } from '#/components/ui/button';
import { isEmptyFolder } from '#/lib/trajectory';
import { ErrorCard } from './ErrorCard';
import { SuggestedTodos } from './SuggestedTodos';

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

const EMPTY_TEXT = '这是一个新建的空文件夹。放进材料后再打开，我会先了解一遍；也可以直接告诉我第一件事。';

function Phase({ text }: { text: string }) {
  const match = /^(在读|在写) (.+)$/.exec(text);
  if (match === null) return <>{text}</>;
  return <>{match[1]} <span className="init-file">{match[2]}</span></>;
}

function clock(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function InitCard({ doc, busy, startLock, onRetry, onOpenFile, onTodoAction, onShowTodos }: {
  doc: ContinuoDoc; busy: boolean; startLock: string | undefined;
  onRetry: () => void; onOpenFile: (path: string) => void;
  onTodoAction: (todo: ContinuoTodo, action: TodoAction) => void; onShowTodos: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const running = doc.init.status === 'running';
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  const task = doc.init.taskId === undefined ? undefined : doc.tasks.find((candidate) => candidate.taskId === doc.init.taskId);
  const files = task?.sources ?? doc.understanding?.sourceRefs ?? [];
  const retry = <Button variant="default" size="sm" disabled={busy} onClick={onRetry}><RotateCcw size={12} />重新了解</Button>;

  if (running) {
    const started = doc.init.startedAt;
    const elapsed = started === undefined ? 0 : Math.max(0, (now - Date.parse(started)) / 1000);
    const phase = task?.phase ?? (STAGES.findLast(([at]) => elapsed >= at) ?? STAGES[0]!)[1];
    return (
      <div className="init-msg fade-in">
        <div className="turn-status"><span className="turn-avatar" /><span>正在了解这个文件夹</span></div>
        <div className="init-reading">
          <div key={phase} className="fade-in"><Phase text={phase} /></div>
          {files.length > 0 && <div className="t3 xs">已读 {files.length} 个文件</div>}
        </div>
      </div>
    );
  }
  if (doc.init.status === 'failed') {
    const error: TaskError = task?.error ?? { code: 'turn.failed', message: '没有完成', at: doc.init.endedAt ?? doc.init.startedAt ?? new Date().toISOString() };
    return <ErrorCard kicker="了解这个文件夹时出错" error={error} action={retry} />;
  }
  if (doc.init.status === 'stopped') {
    return <div className="state-bar chrome"><span className="t2 sm flex-1">了解这个文件夹时被打断了</span>{retry}</div>;
  }
  if (doc.understanding === undefined) return null;
  const empty = isEmptyFolder(doc);
  const suggested = (doc.todos ?? []).filter((todo) => todo.fromTaskId !== undefined && todo.fromTaskId === doc.init.taskId);
  const understood = doc.understanding.text.trim();
  const sentence = /[。！？.!?]$/.test(understood) ? understood : `${understood}。`;
  const partial = doc.init.status === 'partial' ? '（文件比较多，只看了一部分）' : '';
  const text = empty ? EMPTY_TEXT : `我已经了解了这个项目${partial}：${sentence}${suggested.length > 0 ? '我建议接下来可以做这些事：' : '你想先做什么？直接在下面告诉我就行。'}`;
  const read = `读过 ${files.length} 个文件${doc.context.length > 0 ? `，记下 ${doc.context.length} 条要点` : ''}`;
  const endedAt = doc.init.endedAt ?? doc.understanding.updatedAt;

  return (
    <div className="init-msg fade-in">
      <div className="msg-assistant">{text}</div>
      {suggested.length > 0 && <SuggestedTodos todos={suggested} busy={busy} startLock={startLock} onAction={onTodoAction} onShowTodos={onShowTodos} head={false} />}
      {!empty && files.length > 0 && (
        <details className="init-read">
          <summary>{clock(endedAt)} · {read}</summary>
          <div className="init-read-body">
            <FileList files={files} onOpenFile={onOpenFile} />
            {doc.context.length > 0 && <ul className="init-points">{doc.context.map((entry) => <li key={entry.id}>{entry.text}{entry.sourceRefs.length > 0 && <span className="init-src">{entry.sourceRefs.join('、')}</span>}</li>)}</ul>}
            {task?.logPath !== undefined && <button className="link init-log" onClick={() => onOpenFile(task.logPath!)}><FileText size={12} />工作日志</button>}
          </div>
        </details>
      )}
    </div>
  );
}

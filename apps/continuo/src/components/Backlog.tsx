import { useState } from 'react';
import { Play, Plus, Trash2 } from 'lucide-react';
import type { ContinuoDoc, ContinuoTodo, TodoAction, TodoTiming } from '#/lib/api';
import { localDay, localTime, taskLabel } from '#/lib/trajectory';
import { Button } from '#/components/ui/button';
import { Hint } from './Hint';
import { SuggestionActions } from './SuggestedTodos';

type When = 'none' | 'once' | 'daily' | 'weekly';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function inAnHour(): string {
  const at = new Date(Date.now() + 3600_000);
  at.setMinutes(0, 0, 0);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:00`;
}

function nextText(iso: string): string {
  return `${localDay(iso).slice(5).replace('-', '月')}日 ${localTime(iso)}`;
}

function metaOf(doc: ContinuoDoc, todo: ContinuoTodo): string {
  if (todo.fromTaskId !== undefined) {
    const from = doc.tasks.find((task) => task.taskId === todo.fromTaskId);
    const source = from === undefined ? '' : `来自「${taskLabel(from)}」`;
    return todo.state === 'suggested' ? `建议${source === '' ? '' : ` · ${source}`}` : source === '' ? '建议事项' : source;
  }
  if (todo.schedule === undefined) return '不定时';
  if (!todo.schedule.recurring) return `${todo.schedule.label} 开始`;
  return `${todo.schedule.label}${todo.nextAt === undefined ? '' : ` · 下次 ${nextText(todo.nextAt)}`}`;
}

export function Backlog({ doc, busy, startLock, onAdd, onAction }: {
  doc: ContinuoDoc; busy: boolean; startLock: string | undefined;
  onAdd: (text: string, timing: TodoTiming | undefined) => Promise<boolean>; onAction: (todo: ContinuoTodo, action: TodoAction) => void;
}) {
  const todos = (doc.todos ?? []).filter((todo) => todo.state === undefined || todo.state === 'suggested').toSorted((a, b) => Number(b.state === 'suggested') - Number(a.state === 'suggested'));
  const [text, setText] = useState('');
  const [when, setWhen] = useState<When>('none');
  const [at, setAt] = useState(inAnHour);
  const [time, setTime] = useState('09:00');
  const [day, setDay] = useState(1);
  const [problem, setProblem] = useState<string | null>(null);

  const add = async () => {
    if (text.trim() === '') { setProblem('先写下要做的事'); return; }
    if (when === 'once' && Number.isNaN(Date.parse(at))) { setProblem('先选一个时间'); return; }
    if (when === 'once' && Date.parse(at) <= Date.now()) { setProblem('这个时间已经过了'); return; }
    const timing: TodoTiming | undefined = when === 'none' ? undefined : when === 'once' ? { kind: 'once', at: new Date(at).toISOString() } : when === 'daily' ? { kind: 'daily', time } : { kind: 'weekly', day, time };
    if (await onAdd(text.trim(), timing)) { setText(''); setWhen('none'); setProblem(null); }
  };

  return (
    <section className="todo-group">
      <div className="todo-group-head">待办<span className="t3"> · {todos.length}</span></div>
      {todos.map((todo) => (
        <div key={todo.todoId} className={`todo-row ${todo.state === 'suggested' ? 'is-suggested' : ''}`}>
          <span className="status-dot" />
          <div className="min-w-0 flex-1">
            <div className="todo-title">{todo.title ?? todo.text}</div>
            <div className="todo-meta">{metaOf(doc, todo)}</div>
          </div>
          {todo.state === 'suggested'
            ? <SuggestionActions todo={todo} busy={busy} startLock={startLock} onAction={onAction} />
            : (
              <div className="flex shrink-0 gap-1">
                <Hint title={startLock}><Button variant="ghost" size="sm" disabled={busy || startLock !== undefined} onClick={() => onAction(todo, 'start')}><Play size={12} />开始</Button></Hint>
                <button className="icon-btn" title="删除这件待办" aria-label="删除这件待办" onClick={() => onAction(todo, 'delete')}><Trash2 size={14} /></button>
              </div>
            )}
        </div>
      ))}
      <div className="todo-add">
        <input className="todo-input" value={text} placeholder="添加一件待办…" onChange={(e) => { setText(e.target.value); setProblem(null); }} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void add(); }} />
        <div className="todo-when">
          <select value={when} onChange={(e) => { setWhen(e.target.value as When); setProblem(null); }} aria-label="什么时候开始">
            <option value="none">不定时</option>
            <option value="once">指定时间</option>
            <option value="daily">每天</option>
            <option value="weekly">每周</option>
          </select>
          {when === 'once' && <input type="datetime-local" value={at} onChange={(e) => { setAt(e.target.value); setProblem(null); }} aria-label="开始时间" />}
          {when === 'weekly' && <select value={day} onChange={(e) => setDay(Number(e.target.value))} aria-label="星期几">{WEEKDAYS.map((label, index) => <option key={label} value={index}>{label}</option>)}</select>}
          {(when === 'daily' || when === 'weekly') && <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="几点" />}
          <span className="flex-1" />
          <Button variant="outline" size="sm" onClick={() => void add()}><Plus size={12} />添加</Button>
        </div>
        {problem !== null && <div className="todo-problem">{problem}</div>}
      </div>
    </section>
  );
}

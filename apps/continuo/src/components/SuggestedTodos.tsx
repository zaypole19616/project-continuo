import { Check, ListPlus, Sparkles, X } from 'lucide-react';
import type { ContinuoTodo, TodoAction } from '#/lib/api';
import { Hint } from './Hint';

const STATE_LABEL: Record<string, string> = { open: '已加入待办', started: '已开始', dismissed: '已划掉' };

export function SuggestionActions({ todo, busy, startLock, onAction }: {
  todo: ContinuoTodo; busy: boolean; startLock: string | undefined; onAction: (todo: ContinuoTodo, action: TodoAction) => void;
}) {
  return (
    <div className="suggest-actions">
      <Hint title={startLock ?? '立即执行'}><button className="icon-btn is-go" aria-label="立即执行" disabled={busy || startLock !== undefined} onClick={() => onAction(todo, 'start')}><Check size={15} /></button></Hint>
      <button className="icon-btn is-drop" title="划掉" aria-label="划掉" disabled={busy} onClick={() => onAction(todo, 'dismiss')}><X size={15} /></button>
      <button className="icon-btn" title="加入待办" aria-label="加入待办" disabled={busy} onClick={() => onAction(todo, 'accept')}><ListPlus size={15} /></button>
    </div>
  );
}

export function SuggestedTodos({ todos, busy, startLock, onAction, onShowTodos }: {
  todos: readonly ContinuoTodo[]; busy: boolean; startLock: string | undefined;
  onAction: (todo: ContinuoTodo, action: TodoAction) => void; onShowTodos: () => void;
}) {
  if (todos.length === 0) return null;
  return (
    <div className="suggest">
      <div className="suggest-head"><Sparkles size={14} />建议的下一步事项</div>
      {todos.map((todo) => (
        <div key={todo.todoId} className={`suggest-row is-${todo.state ?? 'open'}`}>
          <div className="min-w-0 flex-1">
            <div className="suggest-title">{todo.title ?? todo.text}</div>
            {todo.reason !== undefined && <div className="t3 xs">{todo.reason}</div>}
          </div>
          {todo.state === 'suggested'
            ? <SuggestionActions todo={todo} busy={busy} startLock={startLock} onAction={onAction} />
            : <span className="suggest-state">{STATE_LABEL[todo.state ?? 'open']}</span>}
        </div>
      ))}
      {todos.some((todo) => todo.state === undefined) && <div className="suggest-foot"><button className="link" onClick={onShowTodos}>查看待办</button></div>}
    </div>
  );
}

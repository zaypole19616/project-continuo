import type { TimelineState } from '#/lib/timeline';

export interface BoardTask { id: string; title: string; status: 'queued' | 'running' | 'waiting' | 'done' | 'failed' | 'stopped'; trigger: string; detail?: string; startedAt?: number; endedAt?: number }

export function Board({ tasks, state, connection }: { tasks: BoardTask[]; state: TimelineState; connection: string }) {
  const cols: Array<{ key: BoardTask['status'][]; title: string }> = [
    { key: ['queued'], title: '待执行' },
    { key: ['running'], title: '进行中' },
    { key: ['waiting'], title: '需要你' },
    { key: ['done', 'failed', 'stopped'], title: '已结束' },
  ];
  const u = state.usage;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-medium">看板</div>
        <div className="muted text-xs">连接 {connection === 'open' ? '正常' : connection === 'connecting' ? '重连中' : '已断开'}</div>
      </div>
      {cols.map((c) => {
        const list = tasks.filter((t) => c.key.includes(t.status));
        return (
          <div key={c.title}>
            <div className="muted text-xs mb-1">{c.title} · {list.length}</div>
            <div className="space-y-2">
              {list.map((t) => <TaskCard key={t.id} t={t} />)}
              {list.length === 0 && <div className="muted text-xs px-1">—</div>}
            </div>
          </div>
        );
      })}
      <div className="panel p-3 text-xs space-y-1">
        <div className="font-medium">本会话用量</div>
        <div className="muted">步数 {u.steps} · 输入 {u.inputOther + u.inputCacheRead + u.inputCacheCreation}（缓存命中 {u.inputCacheRead}）· 输出 {u.output}</div>
        <div className="muted">数字来自服务端每步返回，不是估算。</div>
      </div>
    </div>
  );
}

function TaskCard({ t }: { t: BoardTask }) {
  const tag = t.status === 'running' ? 'tag-run' : t.status === 'waiting' ? 'tag-wait' : t.status === 'failed' ? 'tag-fail' : 'tag-done';
  const label = { queued: '排队', running: '进行中', waiting: '等待你', done: '完成', failed: '失败', stopped: '已停止' }[t.status];
  return (
    <div className="panel p-3 space-y-1">
      <div className="flex items-center gap-2"><span className={`tag ${tag}`}>{label}</span><span className="muted text-xs">{t.trigger}</span></div>
      <div className="text-sm">{t.title}</div>
      {t.detail && <div className="muted text-xs whitespace-pre-wrap">{t.detail}</div>}
    </div>
  );
}

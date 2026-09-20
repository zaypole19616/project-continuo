import type { ContinuoDoc, ContinuoTask } from '#/lib/api';

const STATUS_LABEL: Record<ContinuoTask['status'], string> = {
  queued: '排队', running: '进行中', awaiting_user: '需要你', verifying: '核验中', completed: '完成', needs_review: '待复核', paused: '已暂停', failed: '失败', interrupted: '中断',
};
const TRIGGER_LABEL: Record<string, string> = { first_open: '首次打开', user: '用户发起', resume: '用户恢复', reopen: '重新打开', reply: '用户回复后续接' };

export type BoardAction = 'pause' | 'resume' | 'complete';

export function Board({ doc, selectedTaskId, connection, onSelect, onAction }: { doc: ContinuoDoc; selectedTaskId: string | null; connection: string; onSelect: (task: ContinuoTask) => void; onAction: (task: ContinuoTask, action: BoardAction) => void }) {
  const cols: Array<{ title: string; match: (t: ContinuoTask) => boolean }> = [
    { title: '待执行', match: (t) => t.status === 'queued' },
    { title: '进行中', match: (t) => t.status === 'running' || t.status === 'verifying' },
    { title: '需要你', match: (t) => t.status === 'awaiting_user' || t.status === 'needs_review' },
    { title: '已结束', match: (t) => t.status === 'completed' || t.status === 'paused' || t.status === 'failed' || t.status === 'interrupted' },
  ];
  const tasks = [...doc.tasks].toReversed();
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-medium">看板</div>
        {connection !== 'idle' && <div className="muted text-xs">连接 {connection === 'open' ? '正常' : connection === 'connecting' ? '连接中' : '已断开'}</div>}
      </div>
      {cols.map((c) => {
        const list = tasks.filter(c.match);
        return (
          <div key={c.title}>
            <div className="muted text-xs mb-1">{c.title} · {list.length}</div>
            <div className="space-y-2">
              {list.map((t) => <TaskCard key={t.taskId} t={t} doc={doc} selected={t.taskId === selectedTaskId} onSelect={() => onSelect(t)} onAction={(a) => onAction(t, a)} />)}
              {list.length === 0 && <div className="muted text-xs px-1">—</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TaskCard({ t, doc, selected, onSelect, onAction }: { t: ContinuoTask; doc: ContinuoDoc; selected: boolean; onSelect: () => void; onAction: (a: BoardAction) => void }) {
  const tag = t.status === 'running' || t.status === 'verifying' ? 'tag-run' : t.status === 'awaiting_user' || t.status === 'needs_review' ? 'tag-wait' : t.status === 'failed' || t.status === 'interrupted' ? 'tag-fail' : 'tag-done';
  const awaitingReply = t.status === 'awaiting_user' && t.pendingInteraction === 'reply';
  const canPause = t.status === 'running' || (t.status === 'awaiting_user' && !awaitingReply) || t.status === 'queued';
  const canResume = t.status === 'paused' || t.status === 'interrupted' || t.status === 'needs_review' || t.status === 'failed';
  const canComplete = awaitingReply || t.status === 'needs_review';
  const isInit = t.kind === 'init';
  const done = t.usage.steps;
  return (
    <div className={`panel p-3 space-y-1 cursor-pointer ${selected ? 'ring-1' : ''}`} style={selected ? { borderColor: 'var(--accent)' } : undefined} onClick={onSelect}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`tag ${tag}`}>{awaitingReply ? '等你回复' : STATUS_LABEL[t.status]}</span>
        <span className="muted text-xs">{TRIGGER_LABEL[t.trigger] ?? t.trigger}</span>
        {isInit && <span className="muted text-xs">初始化</span>}
      </div>
      <div className="text-sm">{t.title}</div>
      {isInit && doc.scan && (
        <div className="muted text-xs">范围：{doc.scan.counts.dirs} 个文件夹、{doc.scan.counts.files} 个文件{doc.scan.guideFiles.length > 0 ? `，指引 ${doc.scan.guideFiles.join('、')}` : ''}{doc.scan.unscanned.length > 0 ? `；未读 ${doc.scan.unscanned.length} 处` : ''}</div>
      )}
      {t.phase && (t.status === 'running' || t.status === 'awaiting_user' || t.status === 'verifying') && <div className="muted text-xs">{awaitingReply ? t.phase : `正在：${t.phase}`}</div>}
      {awaitingReply && t.lastReply && <div className="text-xs muted" style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{t.lastReply}</div>}
      {t.report && (t.status === 'completed' || t.status === 'needs_review') && (
        <div className="text-xs space-y-0.5">
          {t.report.deliverables.map((d) => <div key={d.path} className="mono">{d.exists === false ? '✗' : '✓'} {d.path}</div>)}
          {t.report.unresolved.map((u) => <div key={u} style={{ color: 'var(--warn)' }}>未解决：{u}</div>)}
        </div>
      )}
      {t.verification && t.verification.length > 0 && t.status === 'needs_review' && <div className="text-xs" style={{ color: 'var(--warn)' }}>{t.verification.join('；')}</div>}
      {t.lastError && <div className="text-xs" style={{ color: 'var(--danger)' }}>{t.lastError}</div>}
      <div className="muted text-xs">{done} 步 · 输入 {t.usage.inputTokens + t.usage.cacheReadTokens}（缓存 {t.usage.cacheReadTokens}）· 输出 {t.usage.outputTokens}</div>
      {(canPause || canResume || canComplete) && (
        <div className="flex gap-2 pt-1">
          {canPause && <button className="btn text-xs" onClick={(e) => { e.stopPropagation(); onAction('pause'); }}>停止</button>}
          {canResume && <button className="btn text-xs" onClick={(e) => { e.stopPropagation(); onAction('resume'); }}>{t.status === 'failed' ? '重试' : '继续'}</button>}
          {canComplete && <button className="btn text-xs" onClick={(e) => { e.stopPropagation(); onAction('complete'); }}>标记完成</button>}
        </div>
      )}
    </div>
  );
}

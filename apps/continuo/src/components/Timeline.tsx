import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight, Check, CircleAlert, Loader2 } from 'lucide-react';
import type { TimelineItem, ToolCall } from '#/lib/timeline';
import { renderMarkdown } from '#/lib/markdown';

const TOOL_LABEL: Record<string, string> = {
  Read: '读取', ReadMediaFile: '读取', Write: '写入', Edit: '修改', Grep: '搜索', Glob: '查找文件', Bash: '命令',
  WebSearch: '网页搜索', FetchURL: '打开网页', Trajectory: '方案', SubmitPlan: '方案', ReportWorkspaceResult: '汇报结果', AskUserQuestion: '提问',
  TodoList: '待办', WorkspaceContext: '记录要点', Skill: '技能',
};

export function Timeline({ items, root, after }: { items: TimelineItem[]; root?: string; after?: (item: TimelineItem, index: number) => React.ReactNode }) {
  return (
    <div className="space-y-5">
      {items.map((it, i) => (
        <Fragment key={it.id}>
          {it.kind === 'user' ? <div className="flex flex-col items-end gap-1 fade-in"><div className="msg-user">{it.text}</div><span className="t3 xs">{clock(it.at)}</span></div> : <AssistantTurn item={it} root={root} />}
          {after?.(it, i)}
        </Fragment>
      ))}
    </div>
  );
}

function AssistantTurn({ item, root }: { item: Extract<TimelineItem, { kind: 'assistant' }>; root?: string }) {
  return (
    <div className="space-y-3 fade-in">
      {!item.ended && (
        <div className="turn-status">
          <span className="turn-avatar" />
          <span>{item.text ? '正在回答' : item.tools.length > 0 ? '正在动手' : '正在思考中'}</span>
        </div>
      )}
      {item.tools.length > 0 && <ActivityTimeline tools={item.tools} root={root} />}
      {item.text && (item.ended ? <div className="msg-assistant md" style={{ whiteSpace: 'normal' }} dangerouslySetInnerHTML={{ __html: renderMarkdown(item.text) }} /> : <div className="msg-assistant">{item.text}</div>)}
      {item.ended && item.ended.reason === 'completed' && (item.text || item.tools.length > 0) && <div className="t3 xs">{clock(item.at)}</div>}
      {item.ended?.reason === 'cancelled' && (
        <div className="fs-meta flex items-start gap-2" style={{ color: 'var(--text-3)' }}>
          <CircleAlert size={14} style={{ marginTop: 2 }} />
          <span>已停止</span>
        </div>
      )}
    </div>
  );
}

function ActivityTimeline({ tools, root }: { tools: ToolCall[]; root?: string }) {
  const [collapsed, setCollapsed] = useState(tools.length > 6 && tools.every((t) => t.done));
  const done = tools.filter((t) => t.done).length;
  const running = tools.length - done;
  return (
    <div className="activity">
      <button className="activity-row w-full text-left chrome" onClick={() => setCollapsed(!collapsed)} style={{ background: 'var(--row-hover)' }}>
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        <span className="text-2">{running > 0 ? `执行中 · ${done}/${tools.length} 步` : `${tools.length} 步已完成`}</span>
      </button>
      {!collapsed && tools.map((t) => <ToolRow key={t.id} t={t} root={root} />)}
    </div>
  );
}

function ToolRow({ t, root }: { t: ToolCall; root?: string }) {
  const [open, setOpen] = useState(false);
  const known = TOOL_LABEL[t.name];
  const label = known === undefined ? t.description ?? describe(t, root) : describe(t, root);
  return (
    <div>
      <button className="activity-row w-full text-left" onClick={() => setOpen(!open)}>
        <StatusIcon t={t} />
        <span className="name">{known ?? t.name}</span>
        <span className="desc flex-1">{label}</span>
      </button>
      {t.isError === true && missingFile(t) && <div className="tool-err">文件不存在：{describe(t, root) || '这个文件'}</div>}
      {open && t.output !== undefined && (
        <pre className="m-2 mt-0 max-h-56 overflow-auto p-2" style={{ background: 'var(--row-hover)', borderRadius: 'var(--r-2)' }}>{t.output.slice(0, 4000)}</pre>
      )}
    </div>
  );
}

function StatusIcon({ t }: { t: ToolCall }) {
  if (!t.done) return <Loader2 size={14} className="spin" style={{ color: 'var(--info)' }} />;
  if (t.isError) return <CircleAlert size={14} style={{ color: 'var(--err)' }} />;
  return <Check size={14} style={{ color: 'var(--ok)' }} />;
}

function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function missingFile(t: ToolCall): boolean {
  return /does not exist|not found|no such file|ENOENT/i.test(t.output ?? '');
}

function describe(t: ToolCall, root?: string): string {
  const a = t.args as Record<string, unknown> | undefined;
  if (!a) return '';
  const first = a['path'] ?? a['file_path'] ?? a['pattern'] ?? a['command'] ?? a['query'] ?? a['url'] ?? a['question'];
  if (typeof first !== 'string') return '';
  const base = root === undefined ? undefined : root.endsWith('/') ? root : `${root}/`;
  return base !== undefined && first.startsWith(base) ? first.slice(base.length) : first;
}

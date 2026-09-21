import { useEffect, useState } from 'react';
import { ArrowLeft, BookOpen, FileText, Folder, PanelRightOpen, Sparkles } from 'lucide-react';
import { continuoFiles, type ContinuoDoc, type FileContent, type FileEntry, type FileListing } from '#/lib/api';
import { renderMarkdown } from '#/lib/markdown';
import type { NavTarget } from './Sidebar';

export function FileBrowser({ workspaceId, doc, target, agentCollapsed, onNavigate, onOpenAgent, onSelectTask }: {
  workspaceId: string; doc: ContinuoDoc | null; target: NavTarget; agentCollapsed: boolean;
  onNavigate: (target: NavTarget) => void; onOpenAgent: () => void; onSelectTask: (taskId: string) => void;
}) {
  const folderPath = target.kind === 'folder' ? target.path : target.path.split('/').slice(0, -1).join('/');
  const [listing, setListing] = useState<FileListing | null>(null);
  const [file, setFile] = useState<FileContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const revision = doc?.revision ?? 0;

  useEffect(() => {
    let cancelled = false;
    setError(null);
    continuoFiles.list(workspaceId, folderPath).then((r) => { if (!cancelled) setListing(r); }).catch((error: Error) => { if (!cancelled) setError(error.message); });
    return () => { cancelled = true; };
  }, [workspaceId, folderPath, revision]);

  useEffect(() => {
    if (target.kind !== 'file') { setFile(null); return; }
    let cancelled = false;
    continuoFiles.read(workspaceId, target.path).then((r) => { if (!cancelled) setFile(r); }).catch((error: Error) => { if (!cancelled) setError(error.message); });
    return () => { cancelled = true; };
  }, [workspaceId, target, revision]);

  const crumbs = folderPath === '' ? [] : folderPath.split('/');
  const taskTitle = (taskId: string) => doc?.tasks.find((t) => t.taskId === taskId)?.title ?? taskId;

  return (
    <section className="pane pane-content" aria-label="文件工作区">
      <header className="pane-header chrome">
        <div className="crumbs flex-1 min-w-0">
          <button onClick={() => onNavigate({ kind: 'folder', path: '' })}>{doc?.root.split('/').pop() || '根目录'}</button>
          {crumbs.map((c, i) => {
            const p = crumbs.slice(0, i + 1).join('/');
            const last = i === crumbs.length - 1 && target.kind === 'folder';
            return <span key={p} className="flex items-center gap-1"><span className="text-3">/</span>{last ? <span className="current px-1">{c}</span> : <button onClick={() => onNavigate({ kind: 'folder', path: p })}>{c}</button>}</span>;
          })}
          {target.kind === 'file' && <span className="flex items-center gap-1"><span className="text-3">/</span><span className="current px-1 truncate">{target.path.split('/').pop()}</span></span>}
        </div>
        {listing && target.kind === 'folder' && <span className="text-3 fs-meta">{listing.entries.length} 项</span>}
        {agentCollapsed && <button className="btn btn-icon" title="打开 Agent 面板" onClick={onOpenAgent}><PanelRightOpen size={18} /></button>}
      </header>
      <div className="pane-body">
        {error && <div className="banner banner-err m-3">{error}</div>}
        {target.kind === 'file' ? (
          <FilePreview file={file} taskTitle={taskTitle} onBack={() => onNavigate({ kind: 'folder', path: folderPath })} onSelectTask={onSelectTask} />
        ) : (
          <FileTable listing={listing} taskTitle={taskTitle} onNavigate={onNavigate} onSelectTask={onSelectTask} />
        )}
      </div>
    </section>
  );
}

function FileTable({ listing, taskTitle, onNavigate, onSelectTask }: { listing: FileListing | null; taskTitle: (id: string) => string; onNavigate: (t: NavTarget) => void; onSelectTask: (id: string) => void }) {
  if (!listing) return <div className="text-3 fs-meta p-4">读取中…</div>;
  if (listing.entries.length === 0) return <div className="text-3 p-10 text-center">这个文件夹是空的</div>;
  return (
    <table className="file-table">
      <thead><tr><th className="col-name">名称</th><th className="col-mark">标记</th><th className="col-time">修改时间</th><th className="col-size" style={{ textAlign: 'right' }}>大小</th></tr></thead>
      <tbody>
        {listing.entries.map((e) => (
          <tr key={e.path} className="row-click" onClick={() => onNavigate(e.kind === 'dir' ? { kind: 'folder', path: e.path } : { kind: 'file', path: e.path })}>
            <td className="col-name"><div className="name-cell">{e.kind === 'dir' ? <Folder size={16} className="text-2" /> : <FileText size={16} className="text-3" />}<span className="name-text">{e.name}</span></div></td>
            <td className="col-mark"><Markers entry={e} taskTitle={taskTitle} onSelectTask={onSelectTask} /></td>
            <td className="col-time text-3 fs-meta">{formatTime(e.modifiedAt)}</td>
            <td className="col-size text-3 fs-meta" style={{ textAlign: 'right' }}>{e.kind === 'dir' ? `${e.childCount ?? 0} 项` : formatSize(e.size)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Markers({ entry, taskTitle, onSelectTask }: { entry: FileEntry; taskTitle: (id: string) => string; onSelectTask: (id: string) => void }) {
  return (
    <div className="flex items-center gap-1">
      {entry.isGuide && <span className="tag tag-neutral"><BookOpen size={12} />指引</span>}
      {entry.producedBy && <button className="tag tag-done" title={`由任务产出：${taskTitle(entry.producedBy)}`} onClick={(ev) => { ev.stopPropagation(); onSelectTask(entry.producedBy!); }}><Sparkles size={12} />产物</button>}
    </div>
  );
}

function FilePreview({ file, taskTitle, onBack, onSelectTask }: { file: FileContent | null; taskTitle: (id: string) => string; onBack: () => void; onSelectTask: (id: string) => void }) {
  if (!file) return <div className="text-3 fs-meta p-4">读取中…</div>;
  const isMd = /\.(md|markdown)$/i.test(file.path);
  return (
    <div className="p-6 space-y-4 fade-in">
      <div className="flex items-center gap-3 flex-wrap chrome">
        <button className="btn btn-sm btn-ghost" onClick={onBack}><ArrowLeft size={14} />返回列表</button>
        <span className="text-3 fs-meta">{formatSize(file.size)} · {formatTime(file.modifiedAt)}</span>
        {file.producedBy && <button className="tag tag-done" onClick={() => onSelectTask(file.producedBy!)} title={taskTitle(file.producedBy)}><Sparkles size={12} />由任务产出 · 查看过程</button>}
        {file.truncated && <span className="tag tag-wait">只显示前 256KB</span>}
      </div>
      {file.binary ? (
        <div className="text-3">这是二进制文件，Continuo 只展示文本文件的内容。</div>
      ) : isMd ? (
        <article className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(file.text ?? '') }} />
      ) : (
        <pre className="md" style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>{file.text}</pre>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return sameDay ? `今天 ${hm}` : `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, ChevronRight, LayoutGrid, List, PanelRightOpen, Search, Sparkles } from 'lucide-react';
import { continuoFiles, type ContinuoDoc, type FileContent, type FileEntry, type FileListing } from '#/lib/api';
import { renderMarkdown } from '#/lib/markdown';
import { FileGlyph, FolderGlyph, fileTypeLabel } from './icons';

export type NavTarget = { kind: 'folder'; path: string } | { kind: 'file'; path: string };
type SortKey = 'name' | 'time' | 'size';

export function FileBrowser({ workspaceId, root, doc, target, agentCollapsed, searchRef, onNavigate, onOpenAgent, onSelectTask, onError }: {
  workspaceId: string; root: string; doc: ContinuoDoc | null; target: NavTarget; agentCollapsed: boolean; searchRef: React.RefObject<HTMLInputElement | null>;
  onNavigate: (target: NavTarget) => void; onOpenAgent: () => void; onSelectTask: (taskId: string) => void; onError: (message: string) => void;
}) {
  const folderPath = target.kind === 'folder' ? target.path : target.path.split('/').slice(0, -1).join('/');
  const [listing, setListing] = useState<FileListing | null>(null);
  const [file, setFile] = useState<FileContent | null>(null);
  const [view, setView] = useState<'grid' | 'list'>(() => { try { return localStorage.getItem('continuo.view') === 'list' ? 'list' : 'grid'; } catch { return 'grid'; } });
  const sort: SortKey = 'name';
  const [query, setQuery] = useState('');
  const revision = doc?.revision ?? 0;

  useEffect(() => {
    let cancelled = false;
    continuoFiles.list(workspaceId, folderPath).then((r) => { if (!cancelled) setListing(r); }).catch((error: Error) => { if (!cancelled) onError(error.message); });
    return () => { cancelled = true; };
  }, [workspaceId, folderPath, revision]);

  useEffect(() => {
    if (target.kind !== 'file') { setFile(null); return; }
    let cancelled = false;
    continuoFiles.read(workspaceId, target.path).then((r) => { if (!cancelled) setFile(r); }).catch((error: Error) => { if (!cancelled) onError(error.message); });
    return () => { cancelled = true; };
  }, [workspaceId, target, revision]);

  useEffect(() => { setQuery(''); }, [folderPath]);

  const entries = useMemo(() => {
    const list = (listing?.entries ?? []).filter((e) => query.trim() === '' || e.name.toLowerCase().includes(query.trim().toLowerCase()));
    const dirFirst = (a: FileEntry, b: FileEntry) => (a.kind === b.kind ? 0 : a.kind === 'dir' ? -1 : 1);
    const by: Record<SortKey, (a: FileEntry, b: FileEntry) => number> = {
      name: (a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'),
      time: (a, b) => b.modifiedAt.localeCompare(a.modifiedAt),
      size: (a, b) => b.size - a.size,
    };
    return [...list].toSorted((a, b) => dirFirst(a, b) || by[sort](a, b));
  }, [listing, query, sort]);

  const crumbs = folderPath === '' ? [] : folderPath.split('/');
  const rootName = root.split('/').filter(Boolean).pop() ?? '根目录';
  const folderName = crumbs.length === 0 ? rootName : crumbs.at(-1)!;
  const taskTitle = (taskId: string) => doc?.tasks.find((t) => t.taskId === taskId)?.title ?? taskId;
  const switchView = (v: 'grid' | 'list') => { setView(v); try { localStorage.setItem('continuo.view', v); } catch {} };
  return (
    <section className="pane pane-content" aria-label="文件工作区">
      <header className="pane-header chrome" style={{ height: 56 }}>
        <div className="crumbs flex-1 min-w-0">
          <button onClick={() => onNavigate({ kind: 'folder', path: '' })} className="flex items-center gap-1" title="工作空间"><FolderGlyph size={18} /><span className="crumb-root-label">工作空间</span></button>
          <ChevronRight size={14} className="text-3" />
          {crumbs.length === 0 && target.kind === 'folder' ? <span className="current">{rootName}</span> : <button onClick={() => onNavigate({ kind: 'folder', path: '' })}>{rootName}</button>}
          {crumbs.map((c, i) => {
            const p = crumbs.slice(0, i + 1).join('/');
            const last = i === crumbs.length - 1 && target.kind === 'folder';
            return <span key={p} className="flex items-center gap-1"><ChevronRight size={14} className="text-3" />{last ? <span className="current">{c}</span> : <button onClick={() => onNavigate({ kind: 'folder', path: p })}>{c}</button>}</span>;
          })}
          {target.kind === 'file' && <span className="flex items-center gap-1"><ChevronRight size={14} className="text-3" /><span className="current truncate">{target.path.split('/').pop()}</span></span>}
        </div>
        <label className="search-box">
          <Search size={16} className="text-3" />
          <input ref={searchRef} placeholder="搜索此文件夹" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="seg">
          <button className={view === 'grid' ? 'is-active' : ''} title="网格" onClick={() => switchView('grid')}><LayoutGrid size={16} /></button>
          <button className={view === 'list' ? 'is-active' : ''} title="列表" onClick={() => switchView('list')}><List size={16} /></button>
        </div>
        {agentCollapsed && <button className="btn btn-icon" title="打开 Agent 面板" onClick={onOpenAgent}><PanelRightOpen size={18} /></button>}
      </header>

      {target.kind === 'file' ? (
        <div className="pane-body"><FilePreview file={file} taskTitle={taskTitle} onBack={() => onNavigate({ kind: 'folder', path: folderPath })} onSelectTask={onSelectTask} /></div>
      ) : (
        <>
          <div className="toolbar chrome">
            <span className="toolbar-title">{folderName}</span>
            <span className="text-3">{entries.length} 项</span>
          </div>
          <div className="pane-body">
            {!listing ? <div className="text-3 fs-meta p-6">读取中…</div>
              : entries.length === 0 ? <EmptyFolder query={query} />
              : view === 'grid' ? <Grid entries={entries} taskTitle={taskTitle} onNavigate={onNavigate} onSelectTask={onSelectTask} />
              : <FileTable entries={entries} taskTitle={taskTitle} onNavigate={onNavigate} onSelectTask={onSelectTask} />}
          </div>
        </>
      )}
    </section>
  );
}

function EmptyFolder({ query }: { query: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-16 text-center">
      <FolderGlyph size={104} />
      <div className="text-2" style={{ fontSize: 'var(--fs-chat)' }}>{query ? `没有名字包含「${query}」的项目` : '这个文件夹是空的'}</div>
      {!query && <div className="text-3 fs-meta">在右侧交代一个任务，产物会出现在这里。</div>}
    </div>
  );
}

function Grid({ entries, taskTitle, onNavigate, onSelectTask }: { entries: FileEntry[]; taskTitle: (id: string) => string; onNavigate: (t: NavTarget) => void; onSelectTask: (id: string) => void }) {
  return (
    <div className="file-grid">
      {entries.map((e) => (
        <button key={e.path} className="file-tile" onDoubleClick={() => onNavigate(e.kind === 'dir' ? { kind: 'folder', path: e.path } : { kind: 'file', path: e.path })} onClick={() => onNavigate(e.kind === 'dir' ? { kind: 'folder', path: e.path } : { kind: 'file', path: e.path })} title={e.name}>
          <div className="tile-icon">{e.kind === 'dir' ? <FolderGlyph size={82} /> : <FileGlyph name={e.name} size={62} />}</div>
          <div className="tile-name">{e.name}</div>
          <div className="tile-meta">{fileTypeLabel(e.name, e.kind)}{e.kind === 'dir' && e.childCount !== undefined ? ` · ${e.childCount} 项` : ''}</div>
          <Markers entry={e} taskTitle={taskTitle} onSelectTask={onSelectTask} />
        </button>
      ))}
    </div>
  );
}

function FileTable({ entries, taskTitle, onNavigate, onSelectTask }: { entries: FileEntry[]; taskTitle: (id: string) => string; onNavigate: (t: NavTarget) => void; onSelectTask: (id: string) => void }) {
  return (
    <table className="file-table">
      <thead><tr><th className="col-name">名称</th><th className="col-mark">标记</th><th className="col-time">修改时间</th><th className="col-size" style={{ textAlign: 'right' }}>大小</th></tr></thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.path} className="row-click" onClick={() => onNavigate(e.kind === 'dir' ? { kind: 'folder', path: e.path } : { kind: 'file', path: e.path })}>
            <td className="col-name"><div className="name-cell">{e.kind === 'dir' ? <FolderGlyph size={20} /> : <FileGlyph name={e.name} size={15} />}<span className="name-text">{e.name}</span><span className="text-3 fs-meta">{fileTypeLabel(e.name, e.kind)}</span></div></td>
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
  if (!entry.isGuide && !entry.producedBy) return null;
  return (
    <div className="flex items-center gap-1 justify-center flex-wrap">
      {entry.isGuide && <span className="tag tag-neutral"><BookOpen size={12} />指引</span>}
      {entry.producedBy && <span role="button" tabIndex={0} className="tag tag-done row-click" title={`由任务产出：${taskTitle(entry.producedBy)}`} onClick={(ev) => { ev.stopPropagation(); onSelectTask(entry.producedBy!); }}><Sparkles size={12} />产物</span>}
    </div>
  );
}

function FilePreview({ file, taskTitle, onBack, onSelectTask }: { file: FileContent | null; taskTitle: (id: string) => string; onBack: () => void; onSelectTask: (id: string) => void }) {
  if (!file) return <div className="text-3 fs-meta p-6">读取中…</div>;
  const isMd = /\.(md|markdown)$/i.test(file.path);
  return (
    <div className="p-8 space-y-5 fade-in">
      <div className="flex items-center gap-3 flex-wrap chrome">
        <button className="btn btn-sm btn-ghost" onClick={onBack}><ArrowLeft size={14} />返回文件夹</button>
        <span className="text-3 fs-meta">{formatSize(file.size)} · {formatTime(file.modifiedAt)}</span>
        {file.producedBy && <button className="tag tag-done" onClick={() => onSelectTask(file.producedBy!)} title={taskTitle(file.producedBy)}><Sparkles size={12} />由任务产出 · 查看过程</button>}
        {file.truncated && <span className="tag tag-wait">只显示前 256KB</span>}
      </div>
      {file.binary ? <div className="text-3">这是二进制文件，Continuo 只展示文本文件的内容。</div>
        : isMd ? <article className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(file.text ?? '') }} />
        : <pre className="md" style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>{file.text}</pre>}
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
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return d.toDateString() === now.toDateString() ? `今天 ${hm}` : `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

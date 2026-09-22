import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { continuoFiles, type FileEntry } from '#/lib/api';
import { renderMarkdown } from '#/lib/markdown';

const LOG_DIR = 'work-log';
const NAME = /^work-log-(\d{4}-\d{2}-\d{2})-(?:([a-z][a-z0-9-]*)-)?(.+)\.md$/;

interface LogFile { path: string; day: string; category?: string; name: string }

function localDay(iso: string): string {
  const at = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

function parse(entry: FileEntry): LogFile | null {
  const match = NAME.exec(entry.name);
  if (match === null) return entry.name.endsWith('.md') ? { path: entry.path, day: localDay(entry.modifiedAt), name: entry.name.replace(/\.md$/, '') } : null;
  return { path: entry.path, day: match[1]!, category: match[2], name: match[3]! };
}

export function WorkRecord({ workspaceId, revision, onError }: { workspaceId: string; revision: number; onError: (message: string) => void }) {
  const [files, setFiles] = useState<LogFile[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    continuoFiles.list(workspaceId, LOG_DIR)
      .then((listing) => {
        if (cancelled) return;
        const logs = listing.entries.filter((entry) => entry.kind === 'file').map(parse).filter((log): log is LogFile => log !== null);
        setFiles(logs.toSorted((a, b) => b.path.localeCompare(a.path)));
      })
      .catch(() => { if (!cancelled) setFiles([]); });
    return () => { cancelled = true; };
  }, [workspaceId, revision]);

  const toggle = (log: LogFile) => {
    if (open === log.path) { setOpen(null); return; }
    setOpen(log.path);
    if (text[log.path] !== undefined) return;
    continuoFiles.read(workspaceId, log.path)
      .then((file) => { setText((prev) => ({ ...prev, [log.path]: file.text ?? '' })); })
      .catch((error: Error) => { onError(error.message); });
  };

  if (files === null) return <div className="t3 sm">读取中…</div>;
  if (files.length === 0) return <div className="t3 sm">还没有工作记录。每件事做完，项目的 work-log/ 里会多一份日志。</div>;

  const days = [...new Set(files.map((log) => log.day))];
  return (
    <div className="log-list">
      {days.map((day) => (
        <section key={day}>
          <div className="log-day">{day}</div>
          {files.filter((log) => log.day === day).map((log) => (
            <div key={log.path} className={`log-item ${open === log.path ? 'is-open' : ''}`}>
              <button className="log-row" onClick={() => toggle(log)}>
                <ChevronRight size={14} className="chev" />
                <span className="nm">{log.name}</span>
                {log.category !== undefined && <span className="tag tag-neutral">{log.category}</span>}
              </button>
              {open === log.path && (
                text[log.path] === undefined
                  ? <div className="t3 sm log-body">读取中…</div>
                  : <article className="md work-record log-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(text[log.path]!) }} />
              )}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { continuo } from '#/lib/api';
import { renderMarkdown } from '#/lib/markdown';

export function WorkRecord({ workspaceId, revision, onError }: { workspaceId: string; revision: number; onError: (message: string) => void }) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    continuo.workLog(workspaceId).then((r) => { if (!cancelled) setMarkdown(r.markdown); }).catch((error: Error) => { if (!cancelled) onError(error.message); });
    return () => { cancelled = true; };
  }, [workspaceId, revision]);
  if (markdown === null) return <div className="t3 sm">读取中…</div>;
  return (
    <div className="space-y-2">
      <div className="t3 xs">这个文件夹里发生过的事，按日期排列。</div>
      <article className="md work-record" dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }} />
    </div>
  );
}

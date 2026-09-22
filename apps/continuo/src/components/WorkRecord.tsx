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
  return <article className="md work-record" dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }} />;
}

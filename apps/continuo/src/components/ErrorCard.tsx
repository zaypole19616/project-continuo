import { useEffect, useState } from 'react';
import { CircleAlert } from 'lucide-react';
import { kimi, type TaskError } from '#/lib/api';
import { errorTitle, mentionsUsageLimit, spentLimit, untilText, type SpentLimit } from '#/lib/errors';
import { localTime } from '#/lib/trajectory';

const URL = /(https?:\/\/[^\s)]+)/g;

function Linked({ text }: { text: string }) {
  return <>{text.split(URL).map((part, index) => (index % 2 === 1 ? <a key={index} href={part} target="_blank" rel="noreferrer">{part}</a> : part))}</>;
}

export function ErrorCard({ kicker, error, action }: { kicker: string; error: TaskError; action?: React.ReactNode }) {
  const [limit, setLimit] = useState<SpentLimit | undefined>(undefined);
  const usageLimited = mentionsUsageLimit(error);
  useEffect(() => {
    if (!usageLimited) return;
    let cancelled = false;
    kimi.planUsage().then((usage) => { if (!cancelled) setLimit(spentLimit(usage)); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [usageLimited, error.at]);
  const details: Array<[string, string]> = [['错误码', error.code]];
  if (error.status !== undefined) details.push(['HTTP 状态', String(error.status)]);
  if (error.requestId !== undefined) details.push(['Request ID', error.requestId]);
  if (error.traceId !== undefined) details.push(['Trace ID', error.traceId]);
  details.push(['时间', localTime(error.at)]);
  return (
    <div className="err-card fade-in">
      <div className="err-head">
        <CircleAlert size={15} />
        <span className="err-kicker">{kicker}</span>
        <span className="err-title">{limit === undefined ? errorTitle(error) : `${limit.label}已用完`}</span>
      </div>
      {limit?.resetAt !== undefined && <div className="err-limit">{untilText(limit.resetAt, Date.now())}后重置（{localTime(limit.resetAt)}）</div>}
      <div className="err-message"><Linked text={error.message} /></div>
      <details className="err-details">
        <summary>详情</summary>
        <dl>{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      </details>
      {action !== undefined && <div className="err-actions">{action}</div>}
    </div>
  );
}

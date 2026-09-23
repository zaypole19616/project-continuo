import type { ContinuoTask, PlanUsage, TaskError } from './api';

const TITLES: Record<string, string> = {
  'provider.connection_error': '无法连接模型服务',
  'provider.auth_error': '模型认证失败',
  'provider.rate_limit': '模型请求被限流',
  'provider.overloaded': '模型服务过载',
  'provider.filtered': '响应被提供方过滤',
  'provider.api_error': '模型接口返回错误',
  'context.overflow': '上下文超出模型限制',
};

export function mentionsUsageLimit(error: TaskError): boolean {
  return /usage limit|quota|额度|用量/i.test(error.message);
}

export function errorTitle(error: TaskError): string {
  if (mentionsUsageLimit(error)) return '已达到用量上限';
  return TITLES[error.code] ?? '模型请求失败';
}

export interface SpentLimit { label: string; resetAt?: string }

function limitLabel(key: string): string {
  const hours = /^limit(\d+)h$/i.exec(key);
  if (hours !== null) return `${hours[1]} 小时限额`;
  if (/week/i.test(key)) return '每周限额';
  if (/month/i.test(key)) return '每月限额';
  return key;
}

export function spentLimit(usage: PlanUsage): SpentLimit | undefined {
  if (usage.kind !== 'ok' || !('quota' in usage)) return undefined;
  const spent = Object.entries(usage.quota.usages).filter(([, value]) => value.usedRatio >= 1);
  if (spent.length === 0) return undefined;
  const latest = spent.toSorted(([, a], [, b]) => Date.parse(b.resetAt ?? '') - Date.parse(a.resetAt ?? ''))[0]!;
  return { label: limitLabel(latest[0]), resetAt: latest[1].resetAt };
}

export function untilText(iso: string, now: number): string {
  const minutes = Math.max(1, Math.round((Date.parse(iso) - now) / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days > 0) return hours > 0 ? `${days} 天 ${hours} 小时` : `${days} 天`;
  if (hours > 0) return rest > 0 ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
  return `${rest} 分钟`;
}

export function failureReason(task: ContinuoTask): string | undefined {
  if (task.error !== undefined) return errorTitle(task.error);
  if (task.lastError === undefined) return undefined;
  return /usage limit|quota/i.test(task.lastError) ? '已达到用量上限' : task.lastError.slice(0, 80);
}

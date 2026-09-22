import type { Message } from './api';
import type { WsEvent } from './ws';

export type ToolCall = { id: string; name: string; args?: unknown; description?: string; display?: { kind?: string; operation?: string; path?: string }; output?: string; isError?: boolean; done: boolean };

export type TimelineItem =
  | { kind: 'user'; id: string; text: string; at: number }
  | { kind: 'assistant'; id: string; turnId: number; text: string; thinking: string; tools: ToolCall[]; at: number; ended?: { reason: string; error?: string } };

export interface Usage { inputOther: number; output: number; inputCacheRead: number; inputCacheCreation: number; steps: number }

export interface TimelineState { items: TimelineItem[]; usage: Usage; busy: boolean; lastTurnReason?: string; pendingInteraction: string }

export const emptyTimeline = (): TimelineState => ({ items: [], usage: { inputOther: 0, output: 0, inputCacheRead: 0, inputCacheCreation: 0, steps: 0 }, busy: false, pendingInteraction: 'none' });

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

const textOf = (m: Message): string => m.content.filter((c) => c.type === 'text' && c.text).map((c) => c.text as string).join('\n');

export function fromMessages(state: TimelineState, messages: Message[]): TimelineState {
  const items: TimelineItem[] = [];
  let turn = 0;
  for (const m of messages) {
    if (m.metadata?.origin?.kind === 'injection') continue;
    if (m.role === 'user') { items.push({ kind: 'user', id: m.id, text: textOf(m), at: Date.parse(m.created_at) }); turn++; continue; }
    items.push({ kind: 'assistant', id: m.id, turnId: turn, text: textOf(m), thinking: '', tools: [], at: Date.parse(m.created_at), ended: { reason: 'completed' } });
  }
  return { ...state, items };
}

type AssistantItem = Extract<TimelineItem, { kind: 'assistant' }>;

function currentTurn(items: TimelineItem[], turnId: number): AssistantItem {
  const last = items.at(-1);
  if (last && last.kind === 'assistant' && last.turnId === turnId && !last.ended) {
    const clone: AssistantItem = { ...last, tools: last.tools.map((t) => ({ ...t })) };
    items[items.length - 1] = clone;
    return clone;
  }
  const fresh: AssistantItem = { kind: 'assistant', id: `turn-${turnId}-${Date.now()}`, turnId, text: '', thinking: '', tools: [], at: Date.now() };
  items.push(fresh);
  return fresh;
}

export function withUserMessage(state: TimelineState, id: string, text: string): TimelineState {
  if (state.items.some((item) => item.kind === 'user' && item.text === text)) return state;
  return { ...state, items: [...state.items, { kind: 'user', id, text, at: Date.now() }] };
}

export function applyEvent(state: TimelineState, ev: WsEvent): TimelineState {
  const p = ev.payload;
  const type = ev.type;
  const items = [...state.items];
  const turnId = typeof p['turnId'] === 'number' ? (p['turnId'] as number) : -1;
  switch (type) {
    case 'prompt.submitted': {
      const content = (p['content'] as Array<{ type: string; text?: string }> | undefined) ?? [];
      const text = content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n');
      const id = str(p['promptId']) || str(p['userMessageId']) || String(Date.now());
      if (!items.some((i) => i.id === id)) items.push({ kind: 'user', id, text, at: Date.now() });
      return { ...state, items, busy: true };
    }
    case 'turn.started': { currentTurn(items, turnId); return { ...state, items, busy: true }; }
    case 'thinking.delta': { const t = currentTurn(items, turnId); t.thinking += str(p['delta']); return { ...state, items }; }
    case 'assistant.delta': { const t = currentTurn(items, turnId); t.text += str(p['delta']); return { ...state, items }; }
    case 'tool.call.started': {
      const t = currentTurn(items, turnId);
      const id = str(p['toolCallId']);
      if (!t.tools.some((c) => c.id === id)) t.tools.push({ id, name: str(p['name']), args: p['args'], description: p['description'] as string | undefined, display: p['display'] as ToolCall['display'], done: false });
      return { ...state, items };
    }
    case 'tool.result': {
      const id = str(p['toolCallId']);
      const output = typeof p['output'] === 'string' ? (p['output'] as string) : JSON.stringify(p['output']);
      const next = items.map((it) => it.kind === 'assistant' && it.tools.some((x) => x.id === id)
        ? { ...it, tools: it.tools.map((c) => (c.id === id ? { ...c, done: true, output, isError: p['isError'] === true } : c)) }
        : it);
      return { ...state, items: next };
    }
    case 'turn.step.completed': {
      const u = (p['usage'] as Partial<Usage> | undefined) ?? {};
      return { ...state, items, usage: { inputOther: state.usage.inputOther + (u.inputOther ?? 0), output: state.usage.output + (u.output ?? 0), inputCacheRead: state.usage.inputCacheRead + (u.inputCacheRead ?? 0), inputCacheCreation: state.usage.inputCacheCreation + (u.inputCacheCreation ?? 0), steps: state.usage.steps + 1 } };
    }
    case 'turn.ended': {
      const t = currentTurn(items, turnId);
      const err = p['error'] as { message?: string } | undefined;
      t.ended = { reason: str(p['reason']), error: err?.message };
      return { ...state, items, busy: false, lastTurnReason: str(p['reason']) };
    }
    case 'event.session.work_changed': {
      return { ...state, items, busy: p['busy'] === true, pendingInteraction: str(p['pending_interaction']) || 'none', lastTurnReason: (p['last_turn_reason'] as string | undefined) ?? state.lastTurnReason };
    }
    default:
      return state;
  }
}

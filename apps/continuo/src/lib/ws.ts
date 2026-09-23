import { readToken } from './api';

export interface WsEvent { type: string; seq?: number; session_id?: string; timestamp?: string; payload: Record<string, unknown> & { type?: string } ; volatile?: boolean }

type Listener = (ev: WsEvent) => void;

export class SessionStream {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private closed = false;
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  status: 'connecting' | 'open' | 'closed' = 'connecting';
  onStatus: ((s: SessionStream['status']) => void) | null = null;

  constructor(private readonly sessionId: string) { this.connect(); }

  private connect(): void {
    if (this.closed) return;
    const token = readToken() ?? '';
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/v1/ws`, ['kimi-code.bearer.' + token]);
    this.ws = ws;
    this.setStatus('connecting');
    ws.onopen = () => {
      this.retry = 0;
      ws.send(JSON.stringify({ type: 'client_hello', id: 'hello', payload: { subscriptions: [this.sessionId], client_id: 'continuo' } }));
    };
    ws.onmessage = (m) => {
      let frame: WsEvent & { id?: string };
      try { frame = JSON.parse(m.data as string); } catch { return; }
      if (frame.type === 'ping') { ws.send(JSON.stringify({ type: 'pong', payload: frame.payload })); return; }
      if (frame.type === 'ack' && frame.id === 'hello') { this.setStatus('open'); return; }
      for (const l of this.listeners) l(frame);
    };
    ws.onclose = () => {
      if (this.closed) return;
      this.setStatus('connecting');
      const delay = Math.min(8000, 500 * 2 ** this.retry++);
      this.timer = setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => { ws.close(); };
  }

  private setStatus(s: SessionStream['status']): void { this.status = s; this.onStatus?.(s); }

  subscribe(l: Listener): () => void { this.listeners.add(l); return () => this.listeners.delete(l); }

  close(): void { this.closed = true; clearTimeout(this.timer); this.setStatus('closed'); this.ws?.close(); }
}

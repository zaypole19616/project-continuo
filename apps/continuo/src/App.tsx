import { useEffect, useState } from 'react';
import { ApiError, kimi, readToken, setToken, touchRecent, type Workspace } from '#/lib/api';
import { ONBOARDED_KEY, Onboarding } from '#/components/Onboarding';
import { WorkspaceView } from '#/pages/Workspace';
import { About, type BetId } from '#/pages/About';

const WS_KEY = 'continuo.workspace';
const BETS = new Set(['orderliness', 'proactiveness', 'clarity', 'direction']);

type Route = { kind: 'app' } | { kind: 'about'; page: BetId | 'index' };

function readRoute(): Route {
  const h = window.location.hash.replace(/^#/, '');
  const m = /^\/about(?:\/([a-z]+))?$/.exec(h);
  if (m) return { kind: 'about', page: m[1] && BETS.has(m[1]) ? (m[1] as BetId) : 'index' };
  return { kind: 'app' };
}

export function App() {
  const [token, setTok] = useState<string | null>(() => readToken());
  const [route, setRoute] = useState<Route>(() => readRoute());
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [checking, setChecking] = useState(true);
  const [serverOk, setServerOk] = useState<string | null>(null);
  const [failure, setFailure] = useState<'auth' | 'network' | null>(null);
  const [intro, setIntro] = useState(() => { try { return localStorage.getItem(ONBOARDED_KEY) !== '1'; } catch { return true; } });

  useEffect(() => {
    const onHash = () => { const t = readToken(); if (t) setTok(t); setRoute(readRoute()); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setChecking(true);
      try {
        const meta = await kimi.meta();
        if (cancelled) return;
        setServerOk(meta.server_version);
        const saved = localStorage.getItem(WS_KEY);
        if (saved) {
          const list = await kimi.workspaces();
          const found = list.items.find((w) => w.id === saved);
          if (found) { touchRecent(found.id); setWorkspace(found); }
        }
      } catch (error) {
        if (cancelled) return;
        setServerOk(null);
        setFailure(error instanceof ApiError && error.code === 401 ? 'auth' : 'network');
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const goAbout = (page: BetId | 'index' = 'index') => { window.location.hash = page === 'index' ? '/about' : `/about/${page}`; };
  const goApp = () => { window.location.hash = ''; setRoute({ kind: 'app' }); };

  if (route.kind === 'about') return <About page={route.page} onNavigate={goAbout} onOpenApp={goApp} />;
  if (checking) return <Center>正在连接本地服务…</Center>;
  if (!serverOk) {
    return (
      <Center>
        <div className="card p-6 max-w-md space-y-3">
          <div style={{ fontSize: 'var(--fs-xl)', fontWeight: 700 }}>{failure === 'auth' ? '需要本地服务的 token' : '连不上本地服务'}</div>
          <p className="t2">{failure === 'auth' ? '本地服务在，但这个页面没有有效的 token。' : '请先运行 kimi web 启动本地服务。'}把启动时打印的 token 填在这里，或用带 <code>#token=</code> 的地址打开本页。</p>
          <TokenForm onSave={(t) => { setToken(t); setTok(t); }} />
        </div>
      </Center>
    );
  }
  const finishIntro = () => { try { localStorage.setItem(ONBOARDED_KEY, '1'); } catch {} setIntro(false); };
  return (
    <>
      <WorkspaceView workspace={workspace} onSwitch={(w) => { localStorage.setItem(WS_KEY, w.id); touchRecent(w.id); setWorkspace(w); }} onClose={() => { localStorage.removeItem(WS_KEY); setWorkspace(null); }} onAbout={(bet) => goAbout(bet && BETS.has(bet) ? (bet as BetId) : 'index')} onReplayIntro={() => setIntro(true)} />
      {intro && <Onboarding onDone={finishIntro} />}
    </>
  );
}

function TokenForm({ onSave }: { onSave: (t: string) => void }) {
  const [v, setV] = useState('');
  return (
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (v.trim()) onSave(v.trim()); }}>
      <input className="flex-1" placeholder="server token" value={v} onChange={(e) => setV(e.target.value)} />
      <button className="btn btn-primary" type="submit">保存</button>
    </form>
  );
}

export function Center({ children }: { children: React.ReactNode }) {
  return <div className="h-full flex items-center justify-center p-6">{children}</div>;
}

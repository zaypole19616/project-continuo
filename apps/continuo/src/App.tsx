import { useEffect, useState } from 'react';
import { ApiError, kimi, readToken, setToken, type Workspace } from '#/lib/api';
import { OpenWorkspace } from '#/pages/OpenWorkspace';
import { WorkspaceView } from '#/pages/Workspace';

const WS_KEY = 'continuo.workspace';

export function App() {
  const [token, setTok] = useState<string | null>(() => readToken());
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [checking, setChecking] = useState(true);
  const [serverOk, setServerOk] = useState<string | null>(null);
  const [failure, setFailure] = useState<'auth' | 'network' | null>(null);

  useEffect(() => {
    const onHash = () => { const t = readToken(); if (t) setTok(t); };
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
          if (found) setWorkspace(found);
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

  if (checking) return <Center>正在连接本地服务…</Center>;
  if (!serverOk) {
    return (
      <Center>
        <div className="panel p-6 max-w-md space-y-3">
          <div className="text-lg font-semibold">{failure === 'auth' ? '需要本地服务的 token' : '连不上本地服务'}</div>
          <p className="muted">{failure === 'auth' ? '本地服务在，但这个页面没有有效的 token。' : '请先运行 kimi web 启动本地服务。'}把启动时打印的 token 填在这里，或用带 <code>#token=</code> 的地址打开本页。</p>
          <TokenForm onSave={(t) => { setToken(t); setTok(t); }} />
        </div>
      </Center>
    );
  }
  if (!workspace) {
    return <OpenWorkspace onOpen={(w) => { localStorage.setItem(WS_KEY, w.id); setWorkspace(w); }} />;
  }
  return <WorkspaceView workspace={workspace} onClose={() => { localStorage.removeItem(WS_KEY); setWorkspace(null); }} />;
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

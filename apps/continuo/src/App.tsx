import { useEffect, useState } from 'react';
import { ApiError, kimi, needsLogin, readToken, setToken, touchRecent, type Workspace } from '#/lib/api';
import { applyTheme, readThemePref, watchSystemTheme, type ThemePref } from '#/lib/theme';
import { ONBOARDED_KEY, Onboarding } from '#/components/Onboarding';
import { Launcher } from '#/pages/Launcher';
import { WorkspaceView } from '#/pages/Workspace';
import { Button } from '#/components/ui/button';

export function App() {
  const [token, setTok] = useState<string | null>(() => readToken());
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [checking, setChecking] = useState(true);
  const [serverOk, setServerOk] = useState<string | null>(null);
  const [failure, setFailure] = useState<'auth' | 'network' | null>(null);
  const [loginNeeded, setLoginNeeded] = useState(false);
  const [intro, setIntro] = useState(() => { try { return localStorage.getItem(ONBOARDED_KEY) !== '1'; } catch { return true; } });
  const [themePref, setThemePref] = useState<ThemePref>(() => readThemePref());

  useEffect(() => { applyTheme(themePref); }, [themePref]);
  useEffect(() => watchSystemTheme(() => applyTheme(themePref)), [themePref]);

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
        kimi.userInfo().then((info) => { if (!cancelled) setLoginNeeded(needsLogin(info)); }).catch(() => undefined);
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
        <div className="card p-6 max-w-md space-y-3">
          <div style={{ fontSize: 'var(--fs-xl)', fontWeight: 700 }}>{failure === 'auth' ? '需要本地服务的 token' : '连不上本地服务'}</div>
          <p className="t2">{failure === 'auth' ? '本地服务在，但这个页面没有有效的 token。' : '请先运行 kimi web 启动本地服务。'}把启动时打印的 token 填在这里，或用带 <code>#token=</code> 的地址打开本页。</p>
          <TokenForm onSave={(t) => { setToken(t); setTok(t); }} />
        </div>
      </Center>
    );
  }
  const finishIntro = () => { try { localStorage.setItem(ONBOARDED_KEY, '1'); } catch {} setIntro(false); };
  const open = (w: Workspace) => { touchRecent(w.id); setWorkspace(w); };
  return (
    <>
      {workspace
        ? <WorkspaceView workspace={workspace} onClose={() => setWorkspace(null)} themePref={themePref} onTheme={setThemePref} />
        : <Launcher onOpen={open} themePref={themePref} onTheme={setThemePref} onGuide={() => setIntro(true)} loginNeeded={loginNeeded} onLoggedIn={() => setLoginNeeded(false)} />}
      {intro && <Onboarding onDone={finishIntro} />}
    </>
  );
}

function TokenForm({ onSave }: { onSave: (t: string) => void }) {
  const [v, setV] = useState('');
  return (
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (v.trim()) onSave(v.trim()); }}>
      <input className="flex-1" placeholder="server token" value={v} onChange={(e) => setV(e.target.value)} />
      <Button variant="default" type="submit">保存</Button>
    </form>
  );
}

export function Center({ children }: { children: React.ReactNode }) {
  return <div className="h-full flex items-center justify-center p-6">{children}</div>;
}

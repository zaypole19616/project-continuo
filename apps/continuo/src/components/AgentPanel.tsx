import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, Check, CircleAlert, FolderOpen, Loader2, PanelRight, PanelRightClose, Play, RotateCcw, Square } from 'lucide-react';
import { DEFAULT_MODEL, DEMO_WORKSPACE_NAME, type ApprovalRequest, type ContextEntry, type ContinuoDoc, type ContinuoTask, type QuestionRequest } from '#/lib/api';
import type { TimelineState } from '#/lib/timeline';
import { Timeline } from './Timeline';
import { ApprovalCard, QuestionCard } from './InteractionCards';
import type { SideMode } from './SidePanel';

export interface AgentPanelProps {
  workspaceName: string;
  doc: ContinuoDoc | null;
  sideMode: SideMode | null;
  onSide: (mode: SideMode | null) => void;
  selected: ContinuoTask | null;
  state: TimelineState;
  questions: QuestionRequest[];
  approvals: ApprovalRequest[];
  connection: string;
  error: string | null;
  activeUserTask: ContinuoTask | null;
  continueTarget: ContinuoTask | null;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
  sending: boolean;
  onSend: () => void;
  onAnswer: (q: QuestionRequest, answers: Record<string, unknown>, note?: string) => Promise<void>;
  onDecide: (a: ApprovalRequest, d: 'approved' | 'rejected', scope?: 'session') => Promise<void>;
  onAction: (task: ContinuoTask, action: 'pause' | 'resume' | 'complete') => void;
  onOpenFile: (path: string) => void;
  onAbout: (bet: string) => void;
  onPatchContext: (entry: ContextEntry, body: { text?: string; status?: 'active' | 'inactive' }) => Promise<void>;
}

const DEMOS: Array<{ bet: string; en: string; title: string; desc: string; prompt: string; generic: string }> = [
  { bet: 'legibility', en: 'Legibility', title: '它按你的规矩干活', desc: '先在 Context 里改一条约定，再交代任务，看产物是否照改后的规矩落位、命名。', prompt: '起草一份 Q2 经营复盘初稿，放到 drafts/。', generic: '基于这个文件夹里的材料，起草一份总结初稿，按这里的约定放好、命名好。' },
  { bet: 'proactiveness', en: 'Proactiveness', title: '缺决定时它停下来问', desc: '材料里没有的决定它不编。你回一句，它在原会话接着干，中途可停可续。', prompt: '给 Q2 复盘初稿补一节「下季度价格动作」，价格方向和幅度按我的决定写，材料里没有的不要编。', generic: '找出这个文件夹里需要我拍板的事，列出来问我，不要自己替我决定。' },
  { bet: 'clarity', en: 'Clarity', title: '完成由文件证明', desc: '任务结束时核验产物是否真的存在；有未解决项就进待复核，不假装完成。', prompt: '基于 Q2 复盘初稿写一份 200 字以内的高管摘要，放到 drafts/。', generic: '把这个文件夹里最新的一份产物压缩成 200 字以内的摘要，另存为新文件。' },
];

const isAwaitingReply = (t: ContinuoTask | null) => !!t && t.status === 'awaiting_user' && t.pendingInteraction === 'reply';

export function AgentPanel(p: AgentPanelProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState('');
  const lastAssistant = p.state.items.at(-1);
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }); }, [p.state.items.length, lastAssistant?.kind === 'assistant' ? lastAssistant.text.length : 0, p.questions.length, p.approvals.length, p.selected?.status]);

  const needYou = p.doc?.tasks.filter((t) => t.status === 'awaiting_user' || t.status === 'needs_review').length ?? 0;
  const pendingContext = p.doc?.context.filter((e) => e.status === 'candidate' || e.status === 'stale').length ?? 0;
  const continuing = p.continueTarget !== null;
  const awaitingReply = isAwaitingReply(p.continueTarget);
  const isDemo = p.workspaceName === DEMO_WORKSPACE_NAME;
  const title = p.selected ? (p.selected.kind === 'init' ? '了解这个工作空间' : p.selected.title) : '新任务';
  const modelName = DEFAULT_MODEL.split('/').pop();
  const initRunning = p.doc?.init.status === 'running';
  const showEmpty = !p.selected && p.doc && !initRunning;
  const fill = (text: string) => { setDraft(text); if (p.composerRef.current) { p.composerRef.current.value = text; p.composerRef.current.focus(); } };
  const lastMode = useRef<SideMode>('files');
  useEffect(() => { if (p.sideMode !== null) lastMode.current = p.sideMode; }, [p.sideMode]);

  return (
    <section className="pane pane-main" aria-label="对话">
      <header className="chat-header chrome">
        <span className="chat-title truncate" title={title}>{title}</span>
        <span className="flex-1" />
        {p.sideMode === null
          ? <HeaderIcon label="打开右侧面板" active={false} badge={(needYou + pendingContext) || undefined} onClick={() => p.onSide(lastMode.current)}><PanelRight size={18} /></HeaderIcon>
          : <HeaderIcon label="收起右侧面板" active={false} onClick={() => { lastMode.current = p.sideMode ?? 'files'; p.onSide(null); }}><PanelRightClose size={18} /></HeaderIcon>}
      </header>
      {p.error && <div className="banner banner-err mx-auto mt-3" style={{ maxWidth: 760 }}>{p.error}</div>}

      <div className="pane-body chat-body">
        <div className="chat-col">
          {initRunning && p.doc && (
            <div className="understand fade-in">
              <BetChip en="Clarity" onClick={() => p.onAbout('clarity')} />
              <div className="flex items-center gap-2 font-medium"><Loader2 size={15} className="spin" style={{ color: 'var(--accent)' }} />正在了解这个文件夹，先理解再动手</div>
              <div className="t2 sm" style={{ marginTop: 4 }}>{p.doc.scan ? `${p.doc.scan.counts.dirs} 个文件夹、${p.doc.scan.counts.files} 个文件${p.doc.scan.guideFiles.length > 0 ? `，先读 ${p.doc.scan.guideFiles.join('、')}` : ''}。` : ''}只读，不会改动任何文件。</div>
            </div>
          )}
          {showEmpty && (
            <div className="empty-hero fade-in">
              <h2>把工作交给 Continuo</h2>
              <p className="t2" style={{ margin: '0 0 22px' }}>它已经了解了这个文件夹。下面三张卡各演示一个判断，点一下就开始。</p>
              <div className="demo-grid">
                {DEMOS.map((d) => (
                  <button key={d.bet} className="demo-card" onClick={() => fill(isDemo ? d.prompt : d.generic)}>
                    <span className="demo-en">{d.en}</span>
                    <span className="demo-title">{d.title}</span>
                    <span className="demo-desc">{d.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {p.selected && p.selected.kind === 'init' && p.doc?.understanding && (
            <UnderstandingCard doc={p.doc} onContext={() => p.onSide('context')} onAbout={() => p.onAbout('clarity')} onPatch={p.onPatchContext} />
          )}
          {!showEmpty && <Timeline items={p.selected?.kind === 'init' ? p.state.items.filter((it) => it.kind !== 'user') : p.state.items} emptyHint={p.selected ? (p.selected.kind === 'init' ? undefined : '这个任务还没有对话。') : undefined} />}
          {p.selected?.report && (p.selected.report.deliverables.length > 0 || p.selected.report.unresolved.length > 0) && (p.selected.status === 'completed' || p.selected.status === 'needs_review') && (
            <DeliverableCard task={p.selected} onOpenFile={p.onOpenFile} onAbout={() => p.onAbout('clarity')} />
          )}
          {p.questions.map((q) => <div key={q.question_id} className="space-y-2"><BetChip en="Proactiveness" note="需要你决定时才打扰" onClick={() => p.onAbout('proactiveness')} /><QuestionCard q={q} onAnswer={(answers, note) => p.onAnswer(q, answers, note)} /></div>)}
          {p.approvals.map((a) => <div key={a.approval_id} className="space-y-2"><BetChip en="Proactiveness" note="写文件前先问你" onClick={() => p.onAbout('proactiveness')} /><ApprovalCard a={a} onDecide={(d, scope) => p.onDecide(a, d, scope)} /></div>)}
          {isAwaitingReply(p.selected) && p.selected?.lastReply && (
            <div className="banner banner-warn"><BetChip en="Proactiveness" note="它在等你回复，看板不会假装完成" onClick={() => p.onAbout('proactiveness')} />在下面回复它，任务会在原会话接着干。</div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>
      <div className="chat-footer">
        <div className="chat-col">
          {p.activeUserTask ? (
            <div className="composer" style={{ padding: '12px 14px 12px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <Loader2 size={16} className="spin" style={{ color: 'var(--accent)' }} />
              <span className="t2 flex-1 sm">{p.activeUserTask.status === 'awaiting_user' ? (p.activeUserTask.pendingInteraction === 'approval' ? '在等你批准上面的操作' : '在等你回答上面的问题') : `正在执行：${p.activeUserTask.phase ?? p.activeUserTask.title}`}</span>
              <button className="btn btn-sm" onClick={() => p.onAction(p.activeUserTask!, 'pause')}><Square size={12} />停止</button>
            </div>
          ) : (
            <>
              {p.continueTarget && (p.continueTarget.status === 'paused' || p.continueTarget.status === 'interrupted' || p.continueTarget.status === 'failed' || p.continueTarget.status === 'needs_review') && (
                <div className="state-bar chrome">
                  <span className="t2 sm flex-1">{p.continueTarget.status === 'paused' ? '任务已暂停' : p.continueTarget.status === 'interrupted' ? '任务被中断' : p.continueTarget.status === 'failed' ? '上次执行失败' : '任务待复核：有未解决项'}</span>
                  {p.continueTarget.status === 'needs_review' && <button className="btn btn-sm" onClick={() => p.onAction(p.continueTarget!, 'complete')}><Check size={12} />标记完成</button>}
                  <button className="btn btn-sm btn-primary" onClick={() => p.onAction(p.continueTarget!, 'resume')}>{p.continueTarget.status === 'failed' ? <><RotateCcw size={12} />重试</> : <><Play size={12} />继续</>}</button>
                </div>
              )}
              <div className="composer">
                <textarea ref={p.composerRef} rows={2} placeholder={awaitingReply ? '回复它…' : continuing ? '接着这个任务说…' : '交代一个任务…'} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); p.onSend(); setDraft(''); } }} />
                <div className="composer-footer chrome">
                  <span className="model-chip">✳ {modelName}</span>
                  <span className="ws-chip"><FolderOpen size={13} />{p.workspaceName}</span>
                  <span className="flex-1" />
                  <button className="send" title="发送" disabled={!p.doc || p.sending} onClick={() => { p.onSend(); setDraft(''); }}><ArrowUp size={16} /></button>
                </div>
              </div>
            </>
          )}
          <div className="chat-status chrome">
            <span className="t3 xs">{p.connection === 'connecting' ? '连接中…' : continuing ? '会在这个任务里接着干；要另起一个，点左上角「新任务」' : ''}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

export function BetChip({ en, note, onClick }: { en: string; note?: string; onClick: () => void }) {
  return <button className="bet-chip chrome" onClick={onClick} title="这体现的是哪个判断">{en}{note ? <span className="t3"> · {note}</span> : null}</button>;
}

function UnderstandingCard({ doc, onContext, onAbout, onPatch }: { doc: ContinuoDoc; onContext: () => void; onAbout: () => void; onPatch: (entry: ContextEntry, body: { text?: string; status?: 'active' | 'inactive' }) => Promise<void> }) {
  const active = doc.context.filter((e) => e.status === 'active');
  const candidates = doc.context.filter((e) => e.status === 'candidate');
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (e: ContextEntry, status: 'active' | 'inactive') => { setBusy(e.id); try { await onPatch(e, { status }); } finally { setBusy(null); } };
  return (
    <div className="understand fade-in space-y-3">
      <div>
        <BetChip en="Clarity" note="理解有来源，先确认再生效" onClick={onAbout} />
        <div className="font-medium" style={{ margin: '6px 0' }}>我对这个文件夹的理解</div>
        <div className="sm" style={{ lineHeight: 1.65 }}>{doc.understanding!.text}</div>
      </div>
      {active.length > 0 && (
        <div className="space-y-1">
          <div className="t3 xs">已生效 · 来自文件或你的确认</div>
          {active.slice(0, 4).map((e) => <div key={e.id} className="sm flex items-start gap-2"><Check size={14} style={{ color: 'var(--ok)', marginTop: 3 }} /><span>{e.text}</span></div>)}
        </div>
      )}
      {candidates.length > 0 && (
        <div className="space-y-2">
          <div className="t3 xs">它的推断 · 等你确认才会用</div>
          {candidates.slice(0, 3).map((e) => (
            <div key={e.id} className="cand-row">
              <span className="sm flex-1">{e.text}</span>
              <button className="btn btn-sm btn-primary" disabled={busy === e.id} onClick={() => { void act(e, 'active'); }}>确认</button>
              <button className="btn btn-sm btn-ghost" disabled={busy === e.id} onClick={() => { void act(e, 'inactive'); }}>忽略</button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className="tag tag-done">{active.length} 条已生效</span>
        {candidates.length > 0 && <span className="tag tag-wait">{candidates.length} 条待确认</span>}
        <span className="flex-1" />
        <button className="btn btn-sm" onClick={onContext}>去纠正或查看来源</button>
      </div>
    </div>
  );
}

function DeliverableCard({ task, onOpenFile, onAbout }: { task: ContinuoTask; onOpenFile: (path: string) => void; onAbout: () => void }) {
  const r = task.report!;
  const ok = r.deliverables.filter((d) => d.exists !== false).length;
  return (
    <div className="space-y-2">
      <BetChip en="Clarity" note="完成由文件证明，不由模型自报" onClick={onAbout} />
      <div className="deliverable fade-in">
        <div className="deliverable-head">
          {task.status === 'completed' ? <Check size={14} style={{ color: 'var(--ok)' }} /> : <CircleAlert size={14} style={{ color: 'var(--warn)' }} />}
          <span className="font-medium">{r.deliverables.length} 个产物</span>
          <span className="t3">· 已核验 {ok} 个存在</span>
          {task.status === 'needs_review' && <span className="tag tag-wait" style={{ marginLeft: 'auto' }}>待复核</span>}
        </div>
        {r.deliverables.map((d) => (
          <div key={d.path} className="deliverable-row">
            {d.exists === false ? <CircleAlert size={13} style={{ color: 'var(--err)' }} /> : <Check size={13} style={{ color: 'var(--ok)' }} />}
            <span className="path" onClick={() => onOpenFile(d.path)} title="在右侧打开">{d.path}</span>
            {d.note && <span className="t3 xs truncate" style={{ maxWidth: '40%' }}>{d.note}</span>}
          </div>
        ))}
        {r.unresolved.map((u) => <div key={u} className="deliverable-row" style={{ color: '#b36b00' }}><CircleAlert size={13} />未解决：{u}</div>)}
      </div>
    </div>
  );
}

function HeaderIcon({ label, active, badge, onClick, children }: { label: string; active: boolean; badge?: number; onClick: () => void; children: ReactNode }) {
  return (
    <button className={`btn btn-icon hdr-icon ${active ? 'is-active' : ''}`} title={label} aria-label={label} aria-pressed={active} onClick={onClick}>
      {children}
      {badge !== undefined && <span className="hdr-badge">{badge}</span>}
    </button>
  );
}

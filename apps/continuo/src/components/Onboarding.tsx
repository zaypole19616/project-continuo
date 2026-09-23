import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeftRight, GitBranch, GitFork, type LucideIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '#/components/ui/dialog';
import { Button } from '#/components/ui/button';
import type { Trajectory } from '#/lib/api';
import { GUIDE_DECISION, GUIDE_LINES } from '#/lib/guideSample';
import shotLight from '#/assets/guide-light.png';
import shotDark from '#/assets/guide-dark.png';
import { DecisionCard } from './DecisionCard';
import { TrajectoryTree } from './TrajectoryTree';

export const ONBOARDED_KEY = 'continuo.onboarded';

const CARD = { w: 1040, h: 540 };
const SHOT = { w: 1350, h: 1100 };
const LENS = { w: 540, h: 408, scale: 0.8 };
const TOTAL = 3;

const TRAITS = [
  { en: 'Orderliness', zh: '有条理和章法', text: '资料、任务与成果各有归处，下次继续不用从头交代。', view: { x: 0, y: 0 } },
  { en: 'Proactiveness', zh: '主动但有分寸', text: '在明确委托的范围里把事情处理好，不需要人盯着。', view: { x: 675, y: 0 } },
  { en: 'Clarity', zh: '坦诚与清晰', text: '帮助用户理解什么对他们最相关，也不回避摩擦。', view: { x: 675, y: 330 } },
];

const FEATURES: Array<{ tag: string; icon: LucideIcon; title: string; text: string }> = [
  { tag: '决策', icon: GitFork, title: '在各个决策的十字路口与人对齐', text: '做法真正不同时，Continuo 不替用户选，而是呈现候选方案及其依据，并说明选择取决于什么。' },
  { tag: '轨迹', icon: GitBranch, title: '把方向选择和之后发生的事连起来', text: '选择、执行过程和结果连在一条轨迹上，可以随时回看，也可以回到决策点换一条路、在轨迹之间切换。' },
];

const noop = () => undefined;
const PLAN_ACTIONS = { onChoose: noop, onSwitch: noop, onAbandon: noop, onExpand: noop, onCustom: noop, onOpenFile: noop };

function Foot({ step, onNext }: { step: number; onNext: () => void }) {
  return (
    <div className="ob-foot">
      <span className="ob-dots">{Array.from({ length: TOTAL }, (_, i) => <i key={i} className={i === step ? 'is-on' : ''} />)}</span>
      <span className="flex-1" />
      <Button variant="default" autoFocus onClick={onNext}>{step === TOTAL - 1 ? '开始使用' : '下一步'}</Button>
    </div>
  );
}

function TraitsPage({ onNext }: { onNext: () => void }) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(() => setActive((i) => (i + 1) % TRAITS.length), 4000);
    return () => window.clearTimeout(timer);
  }, [paused, active]);
  const view = TRAITS[active]!.view;
  const shot = { width: SHOT.w * LENS.scale, height: SHOT.h * LENS.scale, transform: `translate(${-view.x * LENS.scale}px, ${-view.y * LENS.scale}px)` };
  return (
    <div className="ob-page" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="ob-text">
        <span className="ob-eyebrow" />
        <DialogTitle className="ob-title">Continuo 的做事方式</DialogTitle>
        <DialogDescription className="ob-lede">Continuo 是一个住在本地文件夹里的 Agent。</DialogDescription>
        <div className="ob-traits">
          {TRAITS.map((item, index) => (
            <button key={item.en} className={`ob-trait ${index === active ? 'is-on' : ''}`} onMouseEnter={() => setActive(index)} onClick={() => setActive(index)}>
              <span className="ob-trait-head"><span className="ob-en">{item.en}</span><span className="ob-sep">·</span><span className="ob-zh">{item.zh}</span></span>
              <span className="ob-trait-text">{item.text}</span>
            </button>
          ))}
        </div>
        <Foot step={0} onNext={onNext} />
      </div>
      <div className="ob-stage">
        <div className="ob-obj ob-lens" style={{ width: LENS.w, height: LENS.h }}>
          <img className="ob-shot is-light" src={shotLight} alt="" style={shot} />
          <img className="ob-shot is-dark" src={shotDark} alt="" style={shot} />
        </div>
      </div>
    </div>
  );
}

function LinesStage() {
  const [lineA, lineB] = GUIDE_LINES.trajectories as [Trajectory, Trajectory];
  const [on, setOn] = useState<'a' | 'b'>('a');
  const [pill, setPill] = useState<number | undefined>(undefined);
  const stage = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const node = stage.current?.querySelector('.ob-line .t-item.is-decision');
    if (!node || !stage.current) return;
    const zoom = stage.current.getBoundingClientRect().height / stage.current.offsetHeight;
    const box = node.getBoundingClientRect();
    setPill((box.top + box.height / 2 - stage.current.getBoundingClientRect().top) / zoom);
  }, []);
  const actions = { ...PLAN_ACTIONS, onSwitch: (line: Trajectory) => setOn(line.trajectoryId === lineB.trajectoryId ? 'b' : 'a'), onForkAfter: noop, onRetryInit: noop };
  const pick = (which: 'a' | 'b') => (event: React.MouseEvent) => { if ((event.target as HTMLElement).closest('button')) return; setOn(which); };
  return (
    <div ref={stage} className="ob-lines">
      <div className={`ob-line ${on === 'a' ? 'is-on' : ''}`} onClick={pick('a')}><TrajectoryTree doc={GUIDE_LINES} line={lineA} locked={false} actions={actions} /></div>
      <div className={`ob-line ${on === 'b' ? 'is-on' : ''}`} onClick={pick('b')}><TrajectoryTree doc={GUIDE_LINES} line={lineB} locked={false} actions={actions} /></div>
      {pill !== undefined && <button className="ob-switch" style={{ top: pill }} onClick={() => setOn(on === 'a' ? 'b' : 'a')}><ArrowLeftRight size={14} strokeWidth={2.2} />切换</button>}
    </div>
  );
}

function FeaturePage({ step, onNext }: { step: number; onNext: () => void }) {
  const feature = FEATURES[step - 1]!;
  const Icon = feature.icon;
  return (
    <div className="ob-page">
      <div className="ob-text">
        <span className="ob-eyebrow"><span className="ob-eyebrow-icon"><Icon size={15} strokeWidth={2.2} /></span>{feature.tag}</span>
        <DialogTitle className="ob-title">{feature.title}</DialogTitle>
        <DialogDescription className="ob-lede">{feature.text.split(/(?<=[，；。])/).map((clause) => <span key={clause}>{clause}</span>)}</DialogDescription>
        <Foot step={step} onNext={onNext} />
      </div>
      <div className={`ob-stage ${step === 2 ? 'is-lines' : ''}`}>
        {step === 1
          ? <div className="ob-deck"><DecisionCard doc={GUIDE_DECISION} line={GUIDE_DECISION.trajectories[0]!} decision={GUIDE_DECISION.decisions[0]!} locked={false} actions={PLAN_ACTIONS} /></div>
          : <LinesStage />}
      </div>
    </div>
  );
}

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [fit, setFit] = useState(1);
  const last = step === TOTAL - 1;
  const next = () => { if (last) onDone(); else setStep(step + 1); };
  useEffect(() => {
    const measure = () => setFit(Math.min(1, (window.innerWidth - 48) / CARD.w, (window.innerHeight - 48) / CARD.h));
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); next(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <Dialog open onOpenChange={noop}>
      <DialogContent onEscapeKeyDown={(e) => { e.preventDefault(); }} onInteractOutside={(e) => { e.preventDefault(); }} className="ob-dialog w-auto max-w-none rounded-[22px] border-0 bg-transparent p-0 shadow-none">
        <div className="ob-card" style={{ zoom: fit }}>
          {step === 0 ? <TraitsPage onNext={next} /> : <FeaturePage key={step} step={step} onNext={next} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

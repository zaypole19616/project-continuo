import { ArrowLeft, ArrowRight } from 'lucide-react';

export type BetId = 'orderliness' | 'proactiveness' | 'clarity' | 'direction';
const ORDER: BetId[] = ['orderliness', 'proactiveness', 'clarity', 'direction'];

interface Bet { id: BetId; n: string; layer: string; title: string; en: string; lead: string; quote: string; points: Array<{ h: string; p: string }>; inProduct: string[] }

const BETS: Bet[] = [
  {
    id: 'orderliness', n: '01', layer: '隐性交互', title: '有条理和章法', en: 'Orderliness',
    lead: '隐性交互是 Agent 在执行与交付中让人感受到的做事方式：怎么了解资料、怎么组织工作、成果放在哪。用户能感受到它是 P 人还是 J 人，也会因此决定要不要把第二件事交给它。',
    quote: '资料、任务与成果各有归处，用户的做事方式和习惯能留下来，下次继续时不用从头交代。',
    points: [
      { h: '按你的规范干活', p: '开工前先读目录指引，按既有结构决定产出位置，按日期、分类、任务命名，不自己另起一套。' },
      { h: '选择性积累', p: '留下有来源、有适用范围的客观信息，而不是把所有对话都存起来。' },
      { h: '通用与项目分开', p: '通用工作规范和某个项目的具体约定分开维护，按当前任务所在目录读取适用的那一份。' },
    ],
    inProduct: ['首次打开先读 README / AGENTS.md / CLAUDE.md 这类指引，来自指引的约定直接生效，它自己的推断只是候选。', '每条记住的事都带来源文件、适用范围（整个文件夹或仅本任务）和状态，可确认、改一下、不再用。', '产物出现在文件夹里，带「产物」标记，点它回到产出它的那次任务。'],
  },
  {
    id: 'proactiveness', n: '02', layer: '显性交互', title: '主动但有分寸', en: 'Proactiveness',
    lead: '主动型 Agent 最常见的失败，是把"让用户注意到我"当成目标：悬浮窗、鼠标旁的弹窗、不断的提醒。它本该减少负担，却在抢注意力。',
    quote: '好的主动是润物细无声的：委托范围内把事情处理好，需要决定时带着必要信息来找我，我想查看、修改、接管或暂停，随时都能做到。',
    points: [
      { h: '先了解，再动手', p: '打开已有文件夹后主动了解现有工作：读指引、沿指引看材料，沿用已有的组织方式。' },
      { h: '不用等它读完', p: '了解过程中你可以浏览文件，也可以直接交代任务，具体工作优先于目录了解。' },
      { h: '下一步交给你定', p: '任务结束后最多提一项有依据的下一步，说明凭什么这么建议，由你决定要不要开始。' },
    ],
    inProduct: ['缺少关键决定时停下来问；你回一句，它在原任务接着干，中途可停可续。', '任务结束时最多给一条下一步建议，点了才会开新任务，不自动推进。', '它自己的记事本不用你批，动你的文件才问。'],
  },
  {
    id: 'clarity', n: '03', layer: '显性 + 隐性', title: '坦诚与清晰', en: 'Clarity',
    lead: '以往的产品经验会让我们觉得，产品该直观到不需要任何引导。但 AI 的新概念本身就有理解成本，凭直觉上手反而可能更难。',
    quote: '帮助用户理解什么对他们最相关，即便会增加理解成本或摩擦，也不要回避。',
    points: [
      { h: '先解释再使用', p: '首次打开用简短引导说明它怎么组织资料、怎么主动推进、哪些选择要你来做。' },
      { h: '过程可查', p: '项目理解及其来源、任务状态、工作记录和成果，想看的时候都在。' },
      { h: '不假装完成', p: '准备摘要默认折叠，详细过程在工作记录里；成果可预览、可对比上一版，没做到的单独列出。' },
    ],
    inProduct: ['理解摘要两三句，点开看来源文件；详细过程在工作记录里按日期和事项展示。', '完成由文件证明：上报的路径和实际写入合起来核对，缺的如实标成「还差一点」。', '产物可以在右侧预览，也可以和这次任务动手前的那一版对比。'],
  },
  {
    id: 'direction', n: '04', layer: '模型 + Harness', title: '今天的模型是好的执行者，差的投资人', en: 'Direction',
    lead: '让模型把一件具体的事做好，它已经很强；但判断哪个方向更有价值、哪里值得继续投入，是它的弱项。这是 long horizon、自我改进，乃至泛化到真实任务的共同卡点。',
    quote: '这需要在模型、Harness 和产品交互三个层面一起解决，构建模型、Harness 与产品之间的反馈闭环。',
    points: [
      { h: '记录人的判断与反馈', p: '用户在什么情况下选了哪个方向、为什么改要求、接受或放弃了哪些结果，都和当时的任务一起留下来。' },
      { h: '把判断做成比较', p: '方向不明确时先给几个可能的方向让人比较和选择，再记录产物有没有被采用、哪些地方被修正过。' },
      { h: '让模型从轨迹里学', p: '产品提供交互，Harness 记录过程与反馈，模型再从这些带人类判断的轨迹中学习方向判断。' },
    ],
    inProduct: ['每个任务保存原始要求、你的补充、读过的资料和产出的成果，上下文分项目范围与任务范围并带来源。', '每次纠正都留下改前、改后和当时的任务。', '三分支比较与轨迹训练数据尚未实现，这版只做到把判断与反馈记录下来。'],
  },
];

export function About({ page, onNavigate, onOpenApp }: { page: BetId | 'index'; onNavigate: (page: BetId | 'index') => void; onOpenApp: () => void }) {
  const bet = page === 'index' ? null : BETS.find((b) => b.id === page)!;
  return (
    <div className="about">
      <nav className="about-nav chrome">
        <button onClick={onOpenApp} className="flex items-center gap-2" style={{ color: 'var(--text-1)', fontWeight: 700 }}><span className="brand-mark" />Continuo</button>
        <span className="flex-1" />
        <button className={page === 'index' ? 'is-active' : ''} onClick={() => onNavigate('index')}>四个判断</button>
        {BETS.map((b) => <button key={b.id} className={page === b.id ? 'is-active' : ''} onClick={() => onNavigate(b.id)}>{b.en}</button>)}
        <button className="btn btn-primary btn-sm" onClick={onOpenApp}>打开文件夹</button>
      </nav>
      {bet === null ? (
        <>
          <header className="about-hero">
            <div className="about-kicker">Continuo · 四个判断</div>
            <h1>让工作被持续接住，<br />而不是每次对话从头开始。</h1>
            <p className="lead">人与 Agent 的协作有两层：用户看得见的显性交互，和 Agent 在执行与交付中让人感受到的隐性交互。Continuo 在这两层各下了注，再加一条关于模型与 Harness 的判断。</p>
          </header>
          <div className="about-body">
            <div className="about-index">
              {BETS.map((b) => (
                <a key={b.id} href={`#/about/${b.id}`} onClick={(e) => { e.preventDefault(); onNavigate(b.id); }}>
                  <div className="n">{b.n} · {b.layer}</div>
                  <h3>{b.en}</h3>
                  <p>{b.title}。{b.points[0]!.p}</p>
                </a>
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          <header className="about-hero fade-in">
            <div className="about-kicker">{bet.n} · {bet.layer}</div>
            <h1>{bet.en}<span className="t3" style={{ fontWeight: 500, fontSize: 24, marginLeft: 14 }}>{bet.title}</span></h1>
            <p className="lead">{bet.lead}</p>
          </header>
          <div className="about-body fade-in">
            <div className="about-quote">{bet.quote}</div>
            <div className="about-grid">
              {bet.points.map((pt) => <div key={pt.h} className="about-card"><h3>{pt.h}</h3><p>{pt.p}</p></div>)}
            </div>
            <div className="about-inproduct">
              <h3>在 Continuo 里</h3>
              <ul style={{ margin: 0, paddingLeft: 20 }}>{bet.inProduct.map((s) => <li key={s}>{s}</li>)}</ul>
            </div>
            <div className="about-footer-nav">
              <PrevNext bet={bet} onNavigate={onNavigate} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function PrevNext({ bet, onNavigate }: { bet: Bet; onNavigate: (p: BetId | 'index') => void }) {
  const i = ORDER.indexOf(bet.id);
  const prev = i > 0 ? BETS[i - 1] : null;
  const next = i < ORDER.length - 1 ? BETS[i + 1] : null;
  return (
    <>
      {prev ? <button className="btn btn-ghost" onClick={() => onNavigate(prev.id)}><ArrowLeft size={16} />{prev.en}</button> : <button className="btn btn-ghost" onClick={() => onNavigate('index')}><ArrowLeft size={16} />四个判断</button>}
      {next ? <button className="btn btn-ghost" onClick={() => onNavigate(next.id)}>{next.en}<ArrowRight size={16} /></button> : <span />}
    </>
  );
}

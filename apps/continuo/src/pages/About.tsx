import { ArrowLeft, ArrowRight } from 'lucide-react';

export type BetId = 'legibility' | 'proactiveness' | 'clarity' | 'direction';
const ORDER: BetId[] = ['legibility', 'proactiveness', 'clarity', 'direction'];

interface Bet { id: BetId; n: string; layer: string; title: string; en: string; lead: string; quote: string; points: Array<{ h: string; p: string }>; inProduct: string[] }

const BETS: Bet[] = [
  {
    id: 'legibility', n: '01', layer: '隐性交互', title: '有章法', en: 'Legibility',
    lead: '用户把任务交出去之后，Agent 怎么拿背景、怎么组织工作、结果放在哪，决定了他敢不敢交第二次。',
    quote: '好助理做完事，东西在该在的地方，名字一看就懂，下次不用问。',
    points: [
      { h: '固定的结构', p: '每次输出落在约定的位置，不散落在根目录，不覆盖旧文件。' },
      { h: '一致的命名', p: '日期加主题。找的时候知道去哪，看到名字知道是什么。' },
      { h: '可追溯的记录', p: '产物能回到产出它的那次任务；每条判断都标注依据的文件。' },
    ],
    inProduct: ['它做出的文件出现在文件夹里，带「产物」标记，点它跳到产出它的任务。', '来自 README 的约定直接记住，它自己的推断只是候选，等你确认。', '每个任务结束都有一张收尾卡：做了什么、放在哪、记住了什么。'],
  },
  {
    id: 'proactiveness', n: '02', layer: '显性交互', title: '有分寸的主动', en: 'Proactiveness',
    lead: '主动型 Agent 最常见的失败，是把"让用户注意到我"当成目标。它本该减少负担，却不断抢走注意力。',
    quote: '只在预期收益超过打断代价时介入。委托范围内不打扰，需要决定时带着信息来。',
    points: [
      { h: '不打扰', p: '已经明确委托的范围里，Agent 把事处理完，不需要人盯着。' },
      { h: '带信息来找你', p: '需要决定时，给出选项、影响和它的建议，而不是一个空泛的提问。' },
      { h: '随时可接管', p: '想看进展、改要求、停下或接着干，都在一处，一步到位。' },
    ],
    inProduct: ['任务只在进入「需要你」时提示，其余状态安静地跑。', '缺决定时 Agent 停下来问；你回一句，它在原会话接着干。', '停止、继续、回复、标记完成都在任务卡片上。'],
  },
  {
    id: 'clarity', n: '03', layer: '显性 + 隐性', title: '坦诚与清晰', en: 'Clarity',
    lead: 'AI 是新东西，用户往往不知道自己在选什么。一个步骤如果不帮用户理解"这为什么适合我"，就是摩擦，砍掉；如果帮他理解什么对他最相关，哪怕增加摩擦也留下。',
    quote: '让用户知道自己选了什么、会得到什么，Agent 也不在需求没对齐时往下做。',
    points: [
      { h: '开工前说清差异', p: '两条路线各有代价时，先讲清楚再让用户选，而不是直接开做。' },
      { h: '理解有来源', p: '它的每条理解标注来自哪个文件，分"已记住"和"等你确认"。' },
      { h: '完成由外部证明', p: '"完成"不是模型说的，是交付物真的在、未解决项如实列出。' },
    ],
    inProduct: ['右侧「记住的事」里每一条带来源和状态，可确认、改一下、不再用。', '做没做完看文件说话：它上报的和实际写入的合起来核对，缺的如实标成「还差一点」。', '源文件变了，依赖它的那条自动标成"来源变了，先不用"。'],
  },
  {
    id: 'direction', n: '04', layer: '模型 + Harness', title: '今天的模型是好的执行者，差的投资人', en: 'Direction',
    lead: '把一件事执行到底，模型已经很强；判断哪个方向更值得投入，它常常做不到。这是 long horizon、自我改进、泛化到真实任务共同的卡点。原因不是它不聪明，而是"值钱"在它的训练里从来不是可观测的量。',
    quote: '下一阶段的 Harness 不是替模型执行得更好，而是把"什么值钱"变得可观测、可比较、可学习。',
    points: [
      { h: '把判断拿出来', p: '分叉处 Agent 不押注，产出选项、收益、代价、可逆性，人来决定。模型擅长执行，人擅长下注。' },
      { h: '把世界反馈接回来', p: '交付物在不在、用户接受还是放弃、产物之后有没有被用、哪些判断被纠正。这些信号收起来，长任务才有中间奖励。' },
      { h: '把判断变成比较', p: '模型做绝对判断差，做成对比较好。分叉时用小预算并行探索到摘要，在摘要之间比较。' },
    ],
    inProduct: ['「决定」排在注入给模型的最前面，它就是这个文件夹的价值函数。', '每次纠正都留下"纠正前、纠正后、当时的任务"，这是训练方向判断的真实数据。', '两处替模型补课的兜底都带退役条件：模型做到了，兜底就退。'],
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

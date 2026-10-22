import { useEffect, useRef, useState } from 'react';
import { createVoice } from './voice.ts';
import type { Turn } from '../shared/voice.ts';
import type { Feedback } from '../shared/feedback.ts';
import { Whiteboard } from './Whiteboard.tsx';
import { challenges, defaultChallenge } from '../shared/challenges.ts';
import type { ChallengeId } from '../shared/challenges.ts';

export function App() {
  const container = useRef<HTMLDivElement>(null);
  const voice = useRef<ReturnType<typeof createVoice> | null>(null);
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState('Ready when you are');
  const [notice, setNotice] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [feedback, setFeedback] = useState<Feedback>();
  const [muted, setMuted] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [session, setSession] = useState<{ id: string; handle: string }>();
  const [boardReady, setBoardReady] = useState(false);
  const [boardStatus, setBoardStatus] = useState('');
  const [headset, setHeadset] = useState(false);
  const [topicId, setTopicId] = useState<ChallengeId>(defaultChallenge.id);
  const [screen, setScreen] = useState<'landing' | 'tool'>('landing');
  const topic = challenges.find(challenge => challenge.id === topicId) ?? defaultChallenge;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(timer); void voice.current?.end(); };
  }, []);
  function start() {
    if (voice.current || !container.current) return;
    setActive(true);
    setMuted(false);
    setBlocked(false);
    setNotice('');
    setTurns([]);
    setFeedback(undefined);
    setDeadline(null);
    setSession(undefined);
    setBoardReady(false);
    setBoardStatus('');
    try {
      const call = createVoice(container.current, {
        status: setStatus, turns: setTurns, deadline: setDeadline, notice: setNotice, blocked: setBlocked, feedback: setFeedback,
        ended() { voice.current = null; setActive(false); setDeadline(null); setBlocked(false); setBoardReady(false); setBoardStatus(''); },
        session(id, handle) { setSession({ id, handle }); },
        ready() { setBoardReady(true); },
      });
      voice.current = call;
      void call.start(headset, topicId);
    } catch {
      setNotice('This browser could not initialize audio. Try a current desktop browser on localhost or HTTPS.');
      setActive(false);
    }
  }

  const remaining = deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 600;
  if (screen === 'landing') return <main className="landing">
    <nav className="landing-nav"><strong>MockMeisterAI</strong><span>System design practice</span></nav>
    <section className="hero">
      <p className="eyebrow">Speak. Sketch. Improve.</p>
      <h1>Practice system design like it’s the real interview.</h1>
      <p className="hero-copy">MockMeisterAI gives you a focused voice interview, a shared whiteboard, and evidence-based feedback when you finish.</p>
      <div className="topic-picker">
        <label htmlFor="challenge">Choose a design challenge</label>
        <select id="challenge" value={topicId} onChange={event => setTopicId(event.target.value as ChallengeId)}>
          {challenges.map(challenge => <option key={challenge.id} value={challenge.id}>{challenge.title}</option>)}
        </select>
        <p>{topic.summary}</p>
      </div>
      <button className="hero-cta" onClick={() => setScreen('tool')}>Open the practice tool <span aria-hidden="true">↓</span></button>
    </section>
    <section className="landing-details" aria-label="How MockMeisterAI works">
      <div><strong>Talk it through</strong><p>A concise interviewer follows your choices and tradeoffs.</p></div>
      <div><strong>Draw the architecture</strong><p>Use the whiteboard to make your systems thinking visible.</p></div>
      <div><strong>Review the evidence</strong><p>Get feedback tied to the ideas you actually expressed.</p></div>
    </section>
  </main>;
  return <main className="app-shell">
    <aside className="sidebar">
      <header>
        <div><button className="home-link" onClick={() => setScreen('landing')} disabled={active}>MockMeisterAI</button><p>System design · {topic.title.replace('Design ', '')}</p></div>
        <div className="controls">
          <span className="timer" aria-label="Time remaining">{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</span>
          {active ? <>
            <button aria-pressed={muted} onClick={() => { voice.current?.mute(!muted); setMuted(!muted); }}>{muted ? 'Unmute' : 'Mute'}</button>
            <button className="primary" onClick={() => { void voice.current?.end(); }}>End interview</button>
          </> : <><button aria-pressed={headset} onClick={() => setHeadset(!headset)}>Headset: {headset ? 'On' : 'Off'}</button><button className="primary" onClick={start}>Start interview</button></>}
        </div>
      </header>
      <section className="brief">
        <p className="eyebrow">Your challenge</p>
        <h2>{topic.title}.</h2>
        <label className="challenge-select" htmlFor="tool-challenge">Choose a topic<select id="tool-challenge" value={topicId} disabled={active} onChange={event => setTopicId(event.target.value as ChallengeId)}>{challenges.map(challenge => <option key={challenge.id} value={challenge.id}>{challenge.title}</option>)}</select></label>
        <p>{topic.summary} Talk through the requirements, request flow, scale, and failure.</p>
        <p>Use headphones for the clearest conversation. You can interrupt the interviewer at any time.</p>
        <p className="muted">Speech and drawings are processed for this interview and held only in memory while it is active. Raw audio is not recorded. Provider retention policies apply separately.</p>
      </section>
      <section className="interviewer" aria-label="Interviewer">
        <div ref={container} className="avatar" aria-label="3D interviewer" />
        <p role="status">{status}{muted && active ? ' · microphone muted' : ''}</p>
        {blocked && <button onClick={() => { void voice.current?.resumeAudio(); }}>Enable sound</button>}
      </section>
      {boardStatus && <p className="muted" role="status">{boardStatus}</p>}
      {notice && <p className="notice" role="alert">{notice}</p>}
      <section className="captions" aria-label="Interview captions">
        {feedback && <section className="feedback" aria-label="Interview feedback">
          <h2>Feedback</h2>
          {(['strengths', 'improvements'] as const).map(kind => <div key={kind}>
            <h3>{kind === 'strengths' ? 'Strengths' : 'Improve next'}</h3>
            {!feedback[kind].length && <p className="muted">No clear evidence.</p>}
            <ul>{feedback[kind].map((finding, index) => <li key={index}>{finding.text} {finding.citations.map((id, citationIndex) => <a key={id} href={`#turn-${id}`} aria-label={`View supporting transcript ${citationIndex + 1}`}>[Evidence {citationIndex + 1}]</a>)}</li>)}</ul>
          </div>)}
          {!!feedback.limitations.length && <div><h3>Limitations</h3><ul>{feedback.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul></div>}
        </section>}
        <h2>Conversation</h2>
        {!turns.length && <p className="muted">Your conversation will appear here.</p>}
        <div aria-live="polite" aria-relevant="additions text">
          {turns.map(turn => <p id={`turn-${turn.itemId}`} key={turn.itemId}><strong>{turn.role === 'candidate' ? 'You' : 'Interviewer'}</strong> {turn.text}{turn.interrupted && <span className="muted"> (interrupted)</span>}</p>)}
        </div>
      </section>
      <footer><a href="/avatars/NOTICE.md" target="_blank" rel="noreferrer">Avatar credits</a></footer>
    </aside>
    <section className="board-workspace" aria-label="Whiteboard">
      {active && boardReady && session
        ? <Whiteboard sessionId={session.id} sessionHandle={session.handle} active={active} notice={setNotice} boardStatus={setBoardStatus} />
        : <p className="muted">Start the interview to open the whiteboard.</p>}
    </section>
  </main>;
}

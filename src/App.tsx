import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpRight, Check, ChevronDown, Copy, Plus, RotateCcw, SlidersHorizontal, Square } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { streamChat } from './api';
import type { Turn } from './api';
import { loadConnections, providers, saveConnections } from './config';
import type { ProviderId } from './config';
import Settings from './Settings';

interface Message extends Turn {
  id: string;
  model?: string;
  status?: 'streaming' | 'done' | 'stopped' | 'error';
  error?: string;
}

// randomUUID is unavailable on plain HTTP when testing from a phone over LAN.
let messageSequence = 0;
const messageId = () => `${Date.now()}-${++messageSequence}`;

function Star({ className = '' }: { className?: string }) {
  return <svg className={className} width="28" height="28" viewBox="0 0 40 40" fill="none" aria-hidden="true">
    <path d="M20 2C22 14 26 18 38 20C26 22 22 26 20 38C18 26 14 22 2 20C14 18 18 14 20 2Z" fill="currentColor" />
  </svg>;
}

function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return <button className="copy-button" aria-label="复制回复" onClick={async () => {
    try { await navigator.clipboard.writeText(text); setState('copied'); }
    catch { setState('failed'); }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 2000);
  }}>{state === 'copied' ? <Check size={13} /> : <Copy size={13} />}
    <span>{state === 'copied' ? '已复制' : state === 'failed' ? '请长按文字复制' : '复制'}</span>
  </button>;
}

export default function App() {
  const [connections, setConnections] = useState(loadConnections);
  const [selected, setSelected] = useState<ProviderId>('gpt');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [showScroll, setShowScroll] = useState(false);
  const [notice, setNotice] = useState('');
  const textarea = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const controller = useRef<AbortController | null>(null);
  const pinned = useRef(true);
  const current = connections[selected];
  const currentName = providers.find((provider) => provider.id === selected)!.name;
  const ready = Boolean(current.apiKey.trim());

  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () => document.documentElement.style.setProperty('--app-height', `${viewport?.height ?? window.innerHeight}px`);
    resize();
    viewport?.addEventListener('resize', resize);
    window.addEventListener('resize', resize);
    return () => { viewport?.removeEventListener('resize', resize); window.removeEventListener('resize', resize); controller.current?.abort(); };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) setMenuOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [menuOpen]);

  useEffect(() => { if (notice) { const timer = setTimeout(() => setNotice(''), 2600); return () => clearTimeout(timer); } }, [notice]);

  useLayoutEffect(() => {
    const element = textarea.current;
    if (element) { element.style.height = '0'; element.style.height = `${Math.min(element.scrollHeight, 168)}px`; }
  }, [draft]);

  useLayoutEffect(() => {
    if (pinned.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [messages, busy]);

  async function send(retry = false) {
    if (controller.current) return;
    if (!ready) { setMenuOpen(false); setSettingsOpen(true); return; }
    let history: Message[];
    if (retry) {
      history = messages.slice(0, -1);
    } else {
      const content = draft.trim();
      if (!content) return;
      history = [...messages, { id: messageId(), role: 'user', content }];
      setDraft('');
    }
    const id = messageId();
    const abort = new AbortController();
    controller.current = abort;
    pinned.current = true;
    setShowScroll(false);
    setBusy(true);
    setMessages([...history, { id, role: 'assistant', content: '', model: current.model, status: 'streaming' }]);
    const update = (values: Partial<Message>) => setMessages((items) => items.map((item) => item.id === id ? { ...item, ...values } : item));
    let timedOut = false;
    const timeout = () => { timedOut = true; abort.abort(); };
    let timer = setTimeout(timeout, 120_000);
    try {
      await streamChat(current, history.filter((item) => item.content && item.status !== 'error')
        .map(({ role, content }) => ({ role, content })), abort.signal, (content) => {
          clearTimeout(timer); timer = setTimeout(timeout, 120_000); update({ content });
        });
      update({ status: 'done' });
    } catch (error) {
      if (abort.signal.aborted && !timedOut) update({ status: 'stopped' });
      else update({ status: 'error', error: timedOut ? '等待回复超时，请检查连接后重试。' : error instanceof Error ? error.message : '连接发生错误，请重试。' });
    } finally {
      clearTimeout(timer);
      controller.current = null;
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="./" aria-label="Astra 首页，新会话"><Star /><span>astra<span className="brand-dot">.</span></span></a>
        <div className="header-actions">
          <div className="model-picker" ref={menu}>
            <button className="model-trigger" aria-expanded={menuOpen} aria-controls="model-options" disabled={busy}
              onClick={() => setMenuOpen(!menuOpen)}><span className={`status-dot ${ready ? 'ready' : ''}`} />{currentName}<ChevronDown size={13} /></button>
            {menuOpen && <div className="model-menu" id="model-options">
              <span className="menu-caption">选择对话模型</span>
              {providers.map((provider) => <button key={provider.id} aria-pressed={selected === provider.id}
                onClick={() => { setSelected(provider.id); setMenuOpen(false); }}>
                <span><strong>{provider.name}</strong><small>{connections[provider.id].model}</small></span>
                {selected === provider.id && <Check size={16} />}
              </button>)}
            </div>}
          </div>
          <span className="header-divider" />
          <button className="icon-button" title="新对话" aria-label="新对话" disabled={busy || messages.length === 0}
            onClick={() => { setMessages([]); setDraft(''); setShowScroll(false); pinned.current = true; textarea.current?.focus(); }}><Plus size={21} strokeWidth={1.5} /></button>
          <button className="icon-button" title="连接设置" aria-label="连接设置" disabled={busy} onClick={() => setSettingsOpen(true)}><SlidersHorizontal size={18} strokeWidth={1.5} /></button>
        </div>
      </header>

      <main ref={scroller} className={`main-area ${messages.length ? 'has-messages' : ''}`} onScroll={() => {
        const element = scroller.current;
        if (element) { pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100; setShowScroll(!pinned.current); }
      }}>
        {messages.length === 0 ? <section className="welcome">
          <div className="welcome-mark"><Star /></div>
          <p className="eyebrow welcome-eyebrow">A LITTLE SPACE, FOR YOUR MIND</p>
          <h1>让想法，<br />有处可去<span className="heading-period">。</span></h1>
          <p className="welcome-description">一个问题，一闪念，或只是聊聊。<br className="mobile-break" />我在这里。</p>
          <div className="suggestions">
            {[
              { label: '梳理一个想法', text: '我有一个想法，想和你一起梳理一下。' },
              { label: '解答一个问题', text: '有个问题想请教你：' },
              { label: '随便聊聊', text: '我们随便聊聊吧。' },
            ].map(({ label, text }) => <button key={label} onClick={() => { setDraft(text); textarea.current?.focus(); }}>{label}<ArrowUpRight size={14} /></button>)}
          </div>
        </section> : <div className="conversation" role="log" aria-label="当前对话" aria-live="off">
          <div className="conversation-start"><span />此刻的对话<span /></div>
          {messages.map((message, index) => <article key={message.id} className={`message message-${message.role}`}>
            {message.role === 'user' ? <><div className="user-label">你</div><div className="user-bubble">{message.content}</div></> : <>
              <div className="assistant-label"><Star /><span>{message.model}</span>{message.status === 'streaming' && <span className="writing-label">正在回复</span>}</div>
              {message.content ? <div className={`markdown ${message.status === 'streaming' ? 'streaming' : ''}`}><Markdown remarkPlugins={[remarkGfm]}
                components={{ a: ({ children, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer">{children}</a>, img: ({ alt }) => <span className="image-placeholder">[图片{alt ? `：${alt}` : ''}]</span> }}>
                {message.content}
              </Markdown></div> : message.status === 'streaming' ? <div className="thinking" aria-label="正在等待回复"><i /><i /><i /></div> : null}
              {message.error && <div className="message-error" role="alert"><p>{message.error}</p></div>}
              {message.status !== 'streaming' && <div className="message-actions">
                {message.content && <CopyButton text={message.content} />}
                {message.status === 'stopped' && <span className="stopped-label">已停止生成</span>}
                {(message.status === 'error' || message.status === 'stopped') && index === messages.length - 1 && <button disabled={busy} className="copy-button" onClick={() => void send(true)}><RotateCcw size={13} />重新尝试</button>}
              </div>}
            </>}
          </article>)}
        </div>}
      </main>

      <footer className="composer-area">
        {showScroll && <button className="scroll-button icon-button" aria-label="回到最新消息" onClick={() => {
          pinned.current = true; scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }); setShowScroll(false);
        }}><ArrowDown size={17} /></button>}
        <form className="composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
          <textarea ref={textarea} value={draft} rows={1} placeholder="说说你在想什么…" aria-label="消息"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229 && window.matchMedia('(pointer: fine)').matches) {
                event.preventDefault(); if (!busy) void send();
              }
            }} />
          {busy ? <button type="button" className="send-button stop-button" aria-label="停止生成" onClick={() => controller.current?.abort()}><Square size={13} fill="currentColor" /></button> :
            <button type="submit" className="send-button" aria-label="发送消息" disabled={!draft.trim()}><ArrowUp size={21} strokeWidth={1.8} /></button>}
        </form>
        <div className="composer-meta">
          <span className="session-note"><span className="tiny-ring" />仅此刻，不留存对话</span>
          {ready ? <span className="keyboard-hint">Enter 发送<span> / </span>Shift + Enter 换行</span> : <button className="connect-link" onClick={() => setSettingsOpen(true)}>连接模型，开始聊天<ArrowUpRight size={12} /></button>}
        </div>
        <div className="footer-wordmark">LESS, BUT CLOSER.</div>
      </footer>

      <span className="sr-only" role="status">{busy ? '模型正在回复' : messages.length ? '可以继续发送消息' : ''}</span>
      {notice && <div className="toast" role="status"><Check size={15} />{notice}</div>}
      {settingsOpen && <Settings connections={connections} selected={selected} onClose={() => setSettingsOpen(false)} onSave={(next) => {
        setConnections(next); saveConnections(next); setSettingsOpen(false); setNotice('连接设置已保存');
      }} />}
    </div>
  );
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, ChevronDown, Copy, Paperclip, Plus, RotateCcw, Square, X } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { streamChat } from './api';
import type { Turn } from './api';
import { loadConnections, providers } from './config';
import type { ProviderId } from './config';
import { useViewport } from './useViewport';
import { FILE_ACCEPT, MAX_FILES, MAX_TOTAL_BYTES, readAttachment } from './attachments';
import type { Attachment } from './attachments';
import AttachmentList from './AttachmentList';

interface Message extends Turn {
  id: string;
  model?: string;
  status?: 'streaming' | 'done' | 'stopped' | 'error';
  error?: string;
  searching?: boolean;
}

// randomUUID is unavailable on plain HTTP when testing from a phone over LAN.
let messageSequence = 0;
const messageId = () => `${Date.now()}-${++messageSequence}`;

function CopyButton({ text, label = '复制回复' }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return <button className="copy-button" aria-label={label} title={label} onClick={async () => {
    try { await navigator.clipboard.writeText(text); setState('copied'); }
    catch { setState('failed'); }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 2000);
  }}>{state === 'copied' ? <Check size={13} /> : <Copy size={13} />}
    {state === 'failed' && <span>请长按文字复制</span>}
  </button>;
}

export default function App() {
  useViewport();
  const [connections] = useState(loadConnections);
  const [selected, setSelected] = useState<ProviderId>('gpt');
  const [menuOpen, setMenuOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [readingFiles, setReadingFiles] = useState(false);
  const [fileError, setFileError] = useState('');
  const reading = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [showScroll, setShowScroll] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const controller = useRef<AbortController | null>(null);
  const pinned = useRef(true);
  const current = connections[selected];
  const currentName = providers.find((provider) => provider.id === selected)!.name;

  useEffect(() => () => controller.current?.abort(), []);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) setMenuOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [menuOpen]);

  useLayoutEffect(() => {
    const element = textarea.current;
    if (element) { element.style.height = 'auto'; element.style.height = `${Math.min(element.scrollHeight, 144)}px`; }
  }, [draft]);

  useLayoutEffect(() => {
    if (pinned.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [messages, busy]);

  async function addFiles(files: File[]) {
    if (!files.length || reading.current || controller.current) return;
    reading.current = true;
    setReadingFiles(true);
    setFileError('');
    const next = [...attachments];
    const errors: string[] = [];
    try {
      for (const file of files) {
        if (next.length >= MAX_FILES) { errors.push('一次最多添加 6 个附件。'); break; }
        if (next.reduce((total, item) => total + item.size, 0) + file.size > MAX_TOTAL_BYTES) {
          errors.push(`${file.name}：附件总大小不能超过 15 MB。`);
          continue;
        }
        try { next.push(await readAttachment(file)); }
        catch (error) { errors.push(`${file.name}：${error instanceof Error ? error.message : '文件读取失败。'}`); }
      }
      setAttachments(next);
      setFileError(errors.join('\n'));
    } finally {
      reading.current = false;
      setReadingFiles(false);
    }
  }

  async function send(retry = false) {
    if (controller.current || reading.current) return;
    let history: Message[];
    if (retry) {
      history = messages.slice(0, -1);
    } else {
      const content = draft.trim();
      if (!content && !attachments.length) return;
      history = [...messages, { id: messageId(), role: 'user', content, ...(attachments.length ? { attachments } : {}) }];
      setDraft('');
      setAttachments([]);
      setFileError('');
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
      if (!current.apiKey.trim()) throw new Error('连接未能初始化，请刷新页面后重试。');
      await streamChat(current, history.filter((item) => (item.content || item.attachments?.length) && item.status !== 'error')
        .map(({ role, content, attachments }) => ({ role, content, attachments })), abort.signal, (content) => {
          clearTimeout(timer); timer = setTimeout(timeout, 120_000); update({ content });
        }, (searching) => {
          clearTimeout(timer); timer = setTimeout(timeout, 120_000); update({ searching });
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
          <div className="model-picker" ref={menu}>
            <button className="model-trigger" aria-expanded={menuOpen} aria-controls="model-options" disabled={busy}
              onClick={() => setMenuOpen(!menuOpen)}>{currentName}<ChevronDown size={15} /></button>
            {menuOpen && <div className="model-menu" id="model-options">
              {providers.map((provider) => <button key={provider.id} aria-pressed={selected === provider.id}
                onClick={() => { setSelected(provider.id); setMenuOpen(false); }}>
                <span>{provider.name}</span>
                {selected === provider.id && <Check size={16} />}
              </button>)}
            </div>}
          </div>
        <div className="header-actions">
          <button className="icon-button" title="新对话" aria-label="新对话" disabled={busy || readingFiles || (messages.length === 0 && attachments.length === 0 && !draft && !fileError)}
            onClick={() => { setMessages([]); setDraft(''); setAttachments([]); setFileError(''); setShowScroll(false); pinned.current = true; }}><Plus size={21} strokeWidth={1.5} /></button>
        </div>
      </header>

      <main ref={scroller} className={`main-area ${messages.length ? 'has-messages' : ''}`} onScroll={() => {
        const element = scroller.current;
        if (element) { pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100; setShowScroll(!pinned.current); }
      }}>
        {messages.length === 0 && <div className="empty-mark" aria-hidden="true">?</div>}
        <div className="conversation" role="log" aria-label="当前对话" aria-live="off">
          {messages.map((message, index) => <article key={message.id} className={`message message-${message.role}`}>
            {message.role === 'user' ? <>
              {!!message.attachments?.length && <AttachmentList files={message.attachments} />}
              {message.content && <div className="user-bubble">{message.content}</div>}
              {message.content && <CopyButton text={message.content} label="复制问题" />}
            </> : <>
              <span className="sr-only">{message.model}</span>
              {message.content ? <div className={`markdown ${message.status === 'streaming' ? 'streaming' : ''}`}><Markdown remarkPlugins={[remarkGfm]}
                components={{ a: ({ children, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer">{children}</a>, img: ({ alt }) => <span className="image-placeholder">[图片{alt ? `：${alt}` : ''}]</span> }}>
                {message.content}
              </Markdown></div> : message.status === 'streaming' && !message.searching ? <div className="thinking" aria-label="正在等待回复"><i /><i /><i /></div> : null}
              {message.status === 'streaming' && message.searching && <div className="search-status" role="status">正在联网搜索…</div>}
              {message.error && <div className="message-error" role="alert"><p>{message.error}</p></div>}
              {message.status !== 'streaming' && <div className="message-actions">
                {message.content && <CopyButton text={message.content} />}
                {message.status === 'stopped' && <span className="stopped-label">已停止生成</span>}
                {(message.status === 'error' || message.status === 'stopped') && index === messages.length - 1 && <button disabled={busy} className="copy-button" onClick={() => void send(true)}><RotateCcw size={13} />重新尝试</button>}
              </div>}
            </>}
          </article>)}
        </div>
      </main>

      <footer className="composer-area">
        {showScroll && <button className="scroll-button icon-button" aria-label="回到最新消息" onClick={() => {
          pinned.current = true; scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }); setShowScroll(false);
        }}><ArrowDown size={17} /></button>}
        <form className="composer" onSubmit={(event) => { event.preventDefault(); void send(); }}
          onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
          onDrop={event => {
            if (event.dataTransfer.files.length) { event.preventDefault(); void addFiles(Array.from(event.dataTransfer.files)); }
          }}>
          {!!attachments.length && <AttachmentList files={attachments} onRemove={id => {
            if (!reading.current) setAttachments(items => items.filter(item => item.id !== id));
          }} />}
          {readingFiles && <div className="file-reading" role="status">正在读取附件…</div>}
          {fileError && <div className="file-error" role="alert"><span>{fileError}</span><button type="button" aria-label="关闭附件提示" onClick={() => setFileError('')}><X size={16} /></button></div>}
          <div className="composer-row">
          <input ref={fileInput} type="file" accept={FILE_ACCEPT} multiple hidden aria-label="选择图片或附件"
            onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; void addFiles(files); }} />
          <button type="button" className="attach-button" aria-label="上传图片或附件" title="上传图片或附件" disabled={busy || readingFiles}
            onClick={() => fileInput.current?.click()}><Paperclip size={20} strokeWidth={1.6} /></button>
          <textarea ref={textarea} value={draft} rows={1} placeholder="发送消息" aria-label="消息"
            onChange={(event) => setDraft(event.target.value)}
            onPaste={event => {
              const files = Array.from(event.clipboardData.files);
              if (files.length) { event.preventDefault(); void addFiles(files); }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229 && window.matchMedia('(pointer: fine)').matches) {
                event.preventDefault(); if (!busy) void send();
              }
            }} />
          {busy ? <button type="button" className="send-button stop-button" aria-label="停止生成" onClick={() => controller.current?.abort()}><Square size={13} fill="currentColor" /></button> :
            <button type="submit" className="send-button" aria-label="发送消息" disabled={readingFiles || (!draft.trim() && !attachments.length)}><ArrowUp size={21} strokeWidth={1.8} /></button>}
          </div>
        </form>
      </footer>

      <span className="sr-only" role="status">{busy ? '模型正在回复' : messages.length ? '可以继续发送消息' : ''}</span>
    </div>
  );
}

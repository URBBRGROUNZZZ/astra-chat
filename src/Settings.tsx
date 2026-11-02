import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, Eye, EyeOff, X } from 'lucide-react';
import { endpointFor } from './api';
import { providers } from './config';
import type { Connections, ProviderId, Protocol } from './config';

interface Props {
  connections: Connections;
  selected: ProviderId;
  onClose: () => void;
  onSave: (connections: Connections) => void;
}

export default function Settings({ connections, selected, onClose, onSave }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(() => structuredClone(connections));
  const [tab, setTab] = useState(selected);
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState('');
  const connection = draft[tab];

  useEffect(() => { dialog.current?.showModal(); }, []);

  const update = (key: keyof typeof connection, value: string) => {
    setDraft((current) => ({ ...current, [tab]: { ...current[tab], [key]: value } }));
    setError('');
  };

  return (
    <dialog ref={dialog} className="settings-dialog" aria-labelledby="settings-title"
      onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="settings-inner">
        <div className="settings-heading">
          <div><span className="eyebrow">MAKE A CONNECTION</span><h2 id="settings-title">连接你的模型</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="关闭设置"><X size={20} /></button>
        </div>
        <p className="settings-intro">默认连接已准备好，也可以在这里调整。</p>
        <div className="provider-tabs" aria-label="配置模型">
          {providers.map((provider) => (
            <button key={provider.id} type="button" aria-pressed={tab === provider.id}
              className={tab === provider.id ? 'active' : ''}
              onClick={() => { setTab(provider.id); setVisible(false); setError(''); }}>
              {provider.name}<span>{provider.subtitle}</span>
              {draft[provider.id].apiKey.trim() && <Check size={13} />}
            </button>
          ))}
        </div>
        <form onSubmit={(event) => {
          event.preventDefault();
          try {
            for (const { id } of providers) {
              if (!draft[id].model.trim()) { setTab(id); throw new Error('请填写模型 ID。'); }
              try { endpointFor(draft[id].baseUrl, draft[id].protocol); }
              catch (error) { setTab(id); throw error; }
            }
            onSave(draft);
          } catch (error) { setError(error instanceof Error ? error.message : '请检查连接信息。'); }
        }}>
          <label className="field">接口地址
            <input type="url" autoComplete="off" autoCapitalize="none" spellCheck={false}
              value={connection.baseUrl} onChange={(event) => update('baseUrl', event.target.value)}
              placeholder="https://example.com/v1" required />
          </label>
          <div className="field-row">
            <label className="field">模型 ID
              <input value={connection.model} onChange={(event) => update('model', event.target.value)}
                autoComplete="off" autoCapitalize="none" spellCheck={false} required />
            </label>
            <label className="field protocol-field">接口格式
              <select value={connection.protocol} onChange={(event) => update('protocol', event.target.value as Protocol)}>
                <option value="responses">Responses</option><option value="messages">Anthropic Messages</option><option value="chat">Chat Completions</option>
              </select>
            </label>
          </div>
          <label className="field">API Key
            <span className="password-field">
              <input type={visible ? 'text' : 'password'} value={connection.apiKey}
                onChange={(event) => update('apiKey', event.target.value)} placeholder="粘贴你的密钥"
                autoComplete="off" autoCapitalize="none" spellCheck={false} />
              <button type="button" aria-label={visible ? '隐藏密钥' : '显示密钥'} onClick={() => setVisible(!visible)}>
                {visible ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </span>
          </label>
          <p className="field-note">默认密钥会自动载入；手动修改的密钥仅用于当前页面。地址与模型设置会保留。</p>
          {error && <p className="settings-error" role="alert">{error}</p>}
          <button className="save-button" type="submit">保存连接<ArrowUpRight size={18} /></button>
        </form>
        <p className="settings-footnote">浏览器直连接口 · 本站不保存聊天记录<br />接口服务的数据保留规则由服务方决定。</p>
      </div>
    </dialog>
  );
}

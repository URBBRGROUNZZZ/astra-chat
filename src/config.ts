export type ProviderId = 'gpt' | 'claude';
export type Protocol = 'responses' | 'messages' | 'chat';

export interface Connection {
  baseUrl: string;
  model: string;
  protocol: Protocol;
  apiKey: string;
}

export type Connections = Record<ProviderId, Connection>;

export const providers: { id: ProviderId; name: string; subtitle: string }[] = [
  { id: 'gpt', name: 'GPT', subtitle: 'OpenAI' },
  { id: 'claude', name: 'Claude', subtitle: 'Anthropic' },
];

const defaults: Connections = {
  gpt: { baseUrl: 'https://xcode.best/v1', model: 'gpt-6-astra', protocol: 'responses', apiKey: '' },
  claude: { baseUrl: 'https://xcode.best/v1', model: 'claude-opus-5-5', protocol: 'messages', apiKey: '' },
};

const storageKey = 'astra-connections-v1';

export function loadConnections(): Connections {
  const connections = structuredClone(defaults);
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
    for (const { id } of providers) {
      const config = saved[id];
      if (!config || typeof config !== 'object') continue;
      if (typeof config.baseUrl === 'string') connections[id].baseUrl = config.baseUrl;
      if (typeof config.model === 'string') connections[id].model = config.model;
      if (['responses', 'messages', 'chat'].includes(config.protocol)) connections[id].protocol = config.protocol;
    }
  } catch { /* Storage is optional, including in private browsing. */ }
  return connections;
}

export function saveConnections(connections: Connections) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(
      providers.map(({ id }) => {
        const { baseUrl, model, protocol } = connections[id];
        return [id, { baseUrl, model, protocol }];
      }),
    )));
  } catch { /* Connections still work in memory when storage is unavailable. */ }
}

import embedded from './embedded-credentials.json';

export type ProviderId = 'gpt' | 'claude';
export type Protocol = 'responses' | 'messages' | 'chat';

export interface Connection {
  baseUrl: string;
  model: string;
  protocol: Protocol;
  apiKey: string;
}

export type Connections = Record<ProviderId, Connection>;

export const providers: { id: ProviderId; name: string }[] = [
  { id: 'gpt', name: 'GPT' },
  { id: 'claude', name: 'Claude' },
];

const defaults: Connections = {
  gpt: { baseUrl: 'https://xcodebest.com/v1', model: 'gpt-6.2-astra', protocol: 'responses', apiKey: '' },
  claude: { baseUrl: 'https://xcodebest.com/v1', model: 'claude-fable-5-2', protocol: 'messages', apiKey: '' },
};

const bytes = (value: string) => Uint8Array.from(atob(value), character => character.charCodeAt(0));

async function decrypt(): Promise<Record<string, string>> {
  if (globalThis.crypto?.subtle) {
    try {
      const key = await crypto.subtle.importKey('raw', bytes(embedded.key), 'AES-GCM', false, ['decrypt']);
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: bytes(embedded.iv) }, key, bytes(embedded.ciphertext),
      );
      return JSON.parse(new TextDecoder().decode(plaintext));
    } catch { /* fall through to the pure-JS implementation */ }
  }
  // Some older Xiaomi/MIUI WebViews ship without SubtleCrypto even over HTTPS.
  const { gcm } = await import('@noble/ciphers/aes.js');
  const plaintext = gcm(bytes(embedded.key), bytes(embedded.iv)).decrypt(bytes(embedded.ciphertext));
  return JSON.parse(new TextDecoder().decode(plaintext));
}

export async function initializeCredentials(): Promise<void> {
  try {
    const credentials = await decrypt();
    for (const { id } of providers) {
      if (typeof credentials[id] === 'string') defaults[id].apiKey = credentials[id];
    }
  } catch (error) {
    console.warn('Automatic connection unavailable. Open this page over HTTPS and reload.', error);
  }
}

export function loadConnections(): Connections {
  return JSON.parse(JSON.stringify(defaults)) as Connections;
}

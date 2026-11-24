import embedded from './embedded-credentials.json';

export type ProviderId = 'gpt';
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
];

const defaults: Connections = {
  gpt: { baseUrl: 'https://xcode.best/v1', model: 'gpt-6.2-astra', protocol: 'responses', apiKey: '' },
};

export async function initializeCredentials(): Promise<void> {
  const bytes = (value: string) => Uint8Array.from(atob(value), character => character.charCodeAt(0));
  try {
    const key = await crypto.subtle.importKey('raw', bytes(embedded.key), 'AES-GCM', false, ['decrypt']);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes(embedded.iv) }, key, bytes(embedded.ciphertext),
    );
    const credentials = JSON.parse(new TextDecoder().decode(plaintext));
    for (const { id } of providers) {
      if (typeof credentials[id] === 'string') defaults[id].apiKey = credentials[id];
    }
  } catch {
    console.warn('Automatic connection unavailable. Open this page over HTTPS and reload.');
  }
}

export function loadConnections(): Connections {
  return structuredClone(defaults);
}


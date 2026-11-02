// Run explicitly to refresh the embedded credentials from this computer.
// Values are read in memory and never printed or written as plaintext.
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { randomBytes, createCipheriv } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const codex = JSON.parse(await readFile(resolve(homedir(), '.codex/auth.json'), 'utf8'));
const claude = JSON.parse(await readFile(resolve(homedir(), '.claude/settings.json'), 'utf8'));
const credentials = {
  gpt: codex.OPENAI_API_KEY,
  claude: claude.env?.ANTHROPIC_API_KEY || claude.env?.ANTHROPIC_AUTH_TOKEN,
};
if (Object.values(credentials).some(value => typeof value !== 'string' || !value.trim())) {
  throw new Error('Both local provider credentials must be configured before embedding.');
}
const key = randomBytes(32);
const iv = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', key, iv);
const ciphertext = Buffer.concat([
  cipher.update(JSON.stringify(credentials), 'utf8'), cipher.final(), cipher.getAuthTag(),
]);
await writeFile(resolve(root, 'src/embedded-credentials.json'), JSON.stringify({
  version: 1,
  key: key.toString('base64'),
  iv: iv.toString('base64'),
  ciphertext: ciphertext.toString('base64'),
}, null, 2) + '\n');
console.log('Embedded both provider credentials using AES-256-GCM. No plaintext keys were written.');

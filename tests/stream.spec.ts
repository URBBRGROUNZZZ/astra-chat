import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { streamChat } from '../src/api';

test('streaming UTF-8 split across network chunks preserves Chinese text', async () => {
  const sse = ': heartbeat\r\n\r\ndata: {"type":"response.output_text.delta","delta":"你好，世界 🌿"}\r\n\r\ndata: {"type":"response.completed","response":{"status":"completed"}}\r\n\r\n';
  const bytes = Buffer.from(sse);
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    let offset = 0;
    const interval = setInterval(() => {
      response.write(bytes.subarray(offset, offset + 1));
      offset++;
      if (offset >= bytes.length) { clearInterval(interval); response.end(); }
    }, 1);
    response.on('close', () => clearInterval(interval));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  let text = '';
  try {
    await streamChat({
      baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
      model: 'test', protocol: 'responses', apiKey: 'test',
    }, [{ role: 'user', content: '你好' }], new AbortController().signal, (value) => { text = value; });
    expect(text).toBe('你好，世界 🌿');
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});

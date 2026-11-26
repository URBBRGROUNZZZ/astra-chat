import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { useModel, GPT_URL, CLAUDE_URL } from './helpers';

const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;

async function send(page: Page, message: string) {
  await page.getByRole('textbox', { name: '消息', exact: true }).fill(message);
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
}

const searchAnswer = '已查到：最新稳定版是 3.14.1。';

const claudeStream =
  frame({ type: 'message_start', message: { id: 'm1' } }) +
  frame({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }) +
  frame({ type: 'content_block_stop', index: 0 }) +
  frame({ type: 'content_block_start', index: 1, content_block: { type: 'server_tool_use', name: 'web_search' } }) +
  frame({ type: 'content_block_stop', index: 1 }) +
  frame({ type: 'content_block_start', index: 2, content_block: { type: 'web_search_tool_result' } }) +
  frame({ type: 'content_block_stop', index: 2 }) +
  frame({ type: 'content_block_start', index: 3, content_block: { type: 'text', text: '' } }) +
  frame({ type: 'content_block_delta', index: 3, delta: { type: 'text_delta', text: searchAnswer } }) +
  frame({ type: 'content_block_delta', index: 3, delta: { type: 'citations_delta',
    citation: { type: 'web_search_result_location', url: 'https://example.com/dart', title: 'Dart releases' } } }) +
  frame({ type: 'content_block_stop', index: 3 }) +
  frame({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }) +
  frame({ type: 'message_stop' });

test('Claude uses Messages with adaptive thinking, web search and source links', async ({ page }) => {
  const bodies: any[] = [];
  const headers: Record<string, string>[] = [];
  await page.route(CLAUDE_URL, async route => {
    headers.push(route.request().headers());
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ contentType: 'text/event-stream', body: claudeStream });
  });
  await page.goto('/');
  await expect(page.locator('.model-trigger')).toHaveText('Claude');
  await send(page, '查一下 Dart 最新稳定版');
  await expect(page.locator('.markdown')).toContainText(searchAnswer);
  await expect(page.getByRole('link', { name: 'Dart releases' })).toHaveAttribute('href', 'https://example.com/dart');
  await expect(page.locator('.search-status')).toHaveCount(0);
  expect(headers[0]['x-api-key']).toBeTruthy();
  expect(headers[0]['anthropic-version']).toBe('2023-06-01');
  const body = bodies[0];
  expect(body.model).toBe('claude-fable-5-2');
  expect(body.max_tokens).toBe(32000);
  expect(body.thinking).toEqual({ type: 'adaptive' });
  expect(body.output_config).toEqual({ effort: 'high' });
  expect(body.tools).toEqual([{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }]);
  expect(body.system).toContain('联网搜索是可选工具');
  expect(body.messages).toEqual([{ role: 'user', content: '查一下 Dart 最新稳定版' }]);

  await send(page, '继续解释');
  await expect(page.locator('.markdown')).toHaveCount(2);
  expect(bodies[1].messages).toHaveLength(3);
  expect(bodies[1].messages[1].role).toBe('assistant');
  expect(bodies[1].messages[1].content).toContain('来源：');
  expect(bodies[1].messages[2]).toEqual({ role: 'user', content: '继续解释' });
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(storage).toBe(JSON.stringify({ local: {}, session: {} }));
});

test('Claude search status follows server tool events and can be stopped', async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.fetch;
    window.fetch = async (input, init) => {
      if (!String(input).includes('/v1/messages')) return original(input, init);
      const stream = new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"type":"content_block_start","index":1,"content_block":{"type":"server_tool_use","name":"web_search"}}\n\n'));
        init?.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
      } });
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
    };
  });
  await page.goto('/');
  await expect(page.locator('.search-status')).toHaveCount(0);
  await send(page, '查最新消息');
  await expect(page.getByText('正在联网搜索…', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '停止生成' }).click();
  await expect(page.locator('.search-status')).toHaveCount(0);
  await expect(page.getByText('已停止生成', { exact: true })).toBeVisible();
});

test('switching models routes each turn to the matching protocol', async ({ page }) => {
  const calls: string[] = [];
  await page.route(GPT_URL, async route => {
    calls.push('gpt');
    await route.fulfill({ contentType: 'text/event-stream',
      body: frame({ type: 'response.output_text.delta', delta: 'GPT 回复' }) + frame({ type: 'response.completed' }) });
  });
  await page.route(CLAUDE_URL, async route => {
    calls.push('claude');
    await route.fulfill({ contentType: 'text/event-stream', body: claudeStream });
  });
  await page.goto('/');
  await send(page, '第一问');
  await useModel(page, 'GPT');
  await send(page, '第二问');
  await expect(page.locator('.markdown').last()).toContainText('GPT 回复');
  expect(calls).toEqual(['claude', 'gpt']);
  await useModel(page, 'Claude');
  await send(page, '第三问');
  expect(calls).toEqual(['claude', 'gpt', 'claude']);
  await expect(page.locator('.markdown').last()).toContainText(searchAnswer);
});

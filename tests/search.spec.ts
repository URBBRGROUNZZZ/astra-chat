import { expect, test } from '@playwright/test';

const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const url = 'https://developers.openai.com/api/docs/guides/tools-web-search';

test('Astra offers automatic search and renders citations from streamed multi-part output', async ({ page }) => {
  const marker = '\uE200cite\uE202turn0search0\uE201';
  const answer = `中文与 🌍：已查到文档。${marker}`;
  const annotation = { type: 'url_citation', start_index: Array.from(answer).length - marker.length,
    end_index: Array.from(answer).length, url, title: 'Web search' };
  const output = [
    { type: 'message', content: [{ type: 'output_text', text: '先查一下。\n\n', annotations: [] }] },
    { type: 'web_search_call', id: 'search1', status: 'completed' },
    { type: 'message', content: [{ type: 'output_text', text: answer, annotations: [annotation] }] },
  ];
  const bodies: any[] = [];
  await page.route('https://xcode.best/v1/responses', async route => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ contentType: 'text/event-stream', body:
      frame({ type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: '先查一下。\n\n' }) +
      frame({ type: 'response.output_item.added', output_index: 1, item: { type: 'web_search_call', id: 'search1', status: 'in_progress' } }) +
      frame({ type: 'response.web_search_call.searching', output_index: 1, item_id: 'search1' }) +
      frame({ type: 'response.web_search_call.completed', output_index: 1, item_id: 'search1' }) +
      frame({ type: 'response.output_text.delta', output_index: 2, content_index: 0, delta: answer }) +
      frame({ type: 'response.output_text.annotation.added', output_index: 2, content_index: 0, annotation_index: 0, annotation }) +
      frame({ type: 'response.completed', response: { status: 'completed', output } }),
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Claude', exact: true }).click();
  await page.getByRole('button', { name: 'GPT', exact: true }).click();
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('联网搜索官方文档');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByRole('button', { name: '复制回复' })).toBeVisible();
  expect(bodies[0].tools).toEqual([{ type: 'web_search' }]);
  expect(bodies[0].reasoning).toEqual({ effort: 'high' });
  expect(bodies[0].tool_choice).toBe('auto');
  expect(bodies[0].instructions).toContain('联网搜索是可选工具');
  expect(bodies[0].store).toBe(false);
  await expect(page.locator('.markdown')).toContainText('先查一下。');
  await expect(page.locator('.markdown')).toContainText('中文与 🌍：已查到文档。');
  await expect(page.locator('.markdown')).not.toContainText(marker);
  await expect(page.locator('.markdown a')).toHaveCount(1);
  await expect(page.locator('.markdown a')).toHaveAttribute('href', url);
  await expect(page.locator('.markdown a')).toHaveAttribute('target', '_blank');
  await expect(page.locator('.search-status')).toHaveCount(0);
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('继续解释');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByRole('button', { name: '复制回复' })).toHaveCount(2);
  expect(bodies[1].input[1].content).toContain(url);
  expect(bodies[1].input).toHaveLength(3);
  expect(bodies[1].instructions).toBe(bodies[0].instructions);
  await page.reload();
  await expect(page.getByRole('log')).toBeEmpty();
});

test('search status follows actual tool events and search can be stopped', async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.fetch;
    window.fetch = async (input, init) => {
      if (!String(input).includes('xcode.best/v1/responses')) return original(input, init);
      const stream = new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"type":"response.web_search_call.searching","item_id":"s1"}\n\n'));
        init?.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
      } });
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Claude', exact: true }).click();
  await page.getByRole('button', { name: 'GPT', exact: true }).click();
  await expect(page.locator('.search-status')).toHaveCount(0);
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('查最新消息');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByText('正在联网搜索…', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '停止生成' }).click();
  await expect(page.locator('.search-status')).toHaveCount(0);
  await expect(page.getByText('已停止生成', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeVisible();
});

test('JSON citation fallback preserves existing links and rejects unsafe citation URLs', async ({ page }) => {
  const text = `文档：[官方文档](${url})。第二个来源。`;
  const second = 'https://example.com/reference';
  await page.route('https://xcode.best/v1/responses', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    output: [{ type: 'message', content: [{ type: 'output_text', text, annotations: [
      { type: 'url_citation', url, start_index: 0, end_index: text.length },
      { type: 'url_citation', url: second, start_index: 0, end_index: text.length },
      { type: 'url_citation', url: second, start_index: 0, end_index: text.length },
      { type: 'url_citation', url: 'javascript:alert(1)', start_index: 0, end_index: text.length },
    ] }] }],
  }) }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Claude', exact: true }).click();
  await page.getByRole('button', { name: 'GPT', exact: true }).click();
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('搜索');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByRole('button', { name: '复制回复' })).toBeVisible();
  await expect(page.locator('.markdown a')).toHaveCount(2);
  await expect(page.getByRole('link', { name: '官方文档' })).toHaveAttribute('href', url);
  await expect(page.getByRole('link', { name: '1', exact: true })).toHaveAttribute('href', second);
});

test('relay search rejection stays visible instead of silently retrying without tools', async ({ page }) => {
  let calls = 0;
  await page.route('https://xcode.best/v1/responses', async route => {
    calls++;
    expect(route.request().postDataJSON().tools).toEqual([{ type: 'web_search' }]);
    await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { message: 'web_search is not supported' } }) });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Claude', exact: true }).click();
  await page.getByRole('button', { name: 'GPT', exact: true }).click();
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('联网');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('web_search is not supported');
  expect(calls).toBe(1);
  await expect(page.locator('.search-status')).toHaveCount(0);
});

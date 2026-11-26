import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { useModel } from './helpers';

const frame = (value: unknown) => `data: ${JSON.stringify(value)}\r\n\r\n`;
const responseBody = (text: string) => frame({ type: 'response.output_text.delta', delta: text }) + frame({ type: 'response.completed', response: { status: 'completed' } });

async function send(page: Page, message: string) {
  await page.getByRole('textbox', { name: '消息', exact: true }).fill(message);
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
}

test('minimal chat exposes no connection or credential controls', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('log', { name: '当前对话' })).toBeEmpty();
  await expect(page.locator('.empty-mark')).toHaveText('?');
  await expect(page.getByRole('heading')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: /设置|密钥|key/i })).toHaveCount(0);
  await expect(page.locator('input:not([type="file"]), select, dialog')).toHaveCount(0);
  await expect(page.locator('.model-trigger')).toHaveText('Claude');
  await expect(page.locator('#model-options')).toHaveCount(0);
  await page.locator('.model-trigger').click();
  await expect(page.locator('#model-options').getByRole('button')).toHaveText(['GPT', 'Claude']);
  await page.keyboard.press('Escape');
  await expect(page.locator('#model-options')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: `test-results/welcome-${info.project.name}.png`, fullPage: true, animations: 'disabled' });
  expect(errors).toEqual([]);
});

test('GPT credentials work without input and reload starts fresh', async ({ page }) => {
  const calls: { provider: string; turns: number; authorized: boolean }[] = [];
  await page.route('https://xcodebest.com/v1/**', async (route) => {
    const request = route.request();
    const body = request.postDataJSON();
    expect(request.url()).toMatch(/\/responses$/);
    calls.push({ provider: 'gpt', turns: body.input.length, authorized: Boolean(request.headers().authorization?.startsWith('Bearer ')) });
    await route.fulfill({ contentType: 'text/event-stream', body: responseBody('自动连接 GPT。') });
  });
  await page.goto('/');
  await useModel(page, 'GPT');
  await expect(page.locator('.model-trigger')).toBeVisible();
  await send(page, '直接开始');
  await expect(page.locator('.empty-mark')).toHaveCount(0);
  await expect(page.locator('.markdown')).toHaveText('自动连接 GPT。');
  await expect(page.getByRole('button', { name: '复制回复' })).toBeVisible();
  await send(page, '继续聊天');
  await expect(page.locator('.markdown').last()).toHaveText('自动连接 GPT。');
  await page.reload();
  await expect(page.locator('.user-bubble')).toHaveCount(0);
  await expect(page.locator('.empty-mark')).toHaveText('?');
  await expect(page.locator('.model-trigger')).toHaveText('Claude');
  await useModel(page, 'GPT');
  await send(page, '新的会话');
  await expect(page.locator('.markdown')).toHaveText('自动连接 GPT。');
  expect(calls).toEqual([
    { provider: 'gpt', turns: 1, authorized: true },
    { provider: 'gpt', turns: 3, authorized: true },
    { provider: 'gpt', turns: 1, authorized: true },
  ]);
  expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }))).toEqual({ local: [], session: [] });
});

test('old saved settings cannot override the built-in connection', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('astra-connections-v1', JSON.stringify({
    gpt: { baseUrl: 'https://old-relay.example/v1', model: 'old-model', protocol: 'chat' },
  })));
  let calledBuiltIn = false;
  await page.route('https://xcodebest.com/v1/responses', async route => {
    calledBuiltIn = true;
    expect(route.request().postDataJSON().model).toBe('gpt-6.2-astra');
    await route.fulfill({ contentType: 'text/event-stream', body: responseBody('连接正常。') });
  });
  await page.goto('/');
  await useModel(page, 'GPT');
  await send(page, '继续使用');
  await expect(page.locator('.markdown')).toHaveText('连接正常。');
  expect(calledBuiltIn).toBe(true);
  await expect(page.locator('input:not([type="file"]), select, dialog')).toHaveCount(0);
});

test('Responses stream, conversation context, refresh isolation and secret storage', async ({ page }, info) => {
  const requests: any[] = [];
  await page.route('https://xcodebest.com/v1/responses', async (route) => {
    requests.push(route.request().postDataJSON());
    expect(Boolean(route.request().headers().authorization?.startsWith('Bearer '))).toBe(true);
    await route.fulfill({ contentType: 'text/event-stream', body: responseBody('你好，世界。\n\n**一起把想法变清晰。**\n\n```js\nconst hello = "你好";\n```') });
  });
  await page.goto('/');
  await useModel(page, 'GPT');
  await send(page, '你好');
  await expect(page.locator('.markdown')).toContainText('你好，世界');
  await expect(page.locator('.markdown strong')).toHaveText('一起把想法变清晰。');
  await expect(page.getByRole('button', { name: '复制回复' })).toBeVisible();
  await send(page, '请继续');
  await expect(page.locator('.markdown')).toHaveCount(2);
  expect(requests[1].input).toEqual([
    { role: 'user', content: '你好' },
    { role: 'assistant', content: '你好，世界。\n\n**一起把想法变清晰。**\n\n```js\nconst hello = "你好";\n```' },
    { role: 'user', content: '请继续' },
  ]);
  expect(requests[1].store).toBe(false);
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(storage).toBe(JSON.stringify({ local: {}, session: {} }));
  expect(storage).not.toContain('你好');
  await page.screenshot({ path: `test-results/conversation-${info.project.name}.png`, fullPage: true, animations: 'disabled' });
  await page.reload();
  await expect(page.getByRole('log', { name: '当前对话' })).toBeEmpty();
  await expect(page.locator('input:not([type="file"]), select, dialog')).toHaveCount(0);
});

test('authentication errors retry the original turn without duplication', async ({ page }) => {
  let count = 0;
  await page.route('https://xcodebest.com/v1/responses', async (route) => {
    count++;
    expect(route.request().postDataJSON().input).toEqual([{ role: 'user', content: '试试看' }]);
    if (count === 1) await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Invalid API key' } }) });
    else await route.fulfill({ contentType: 'text/event-stream', body: responseBody('重试成功。') });
  });
  await page.goto('/');
  await useModel(page, 'GPT');
  await send(page, '试试看');
  await expect(page.getByRole('alert')).toContainText('模型连接认证失败');
  await page.getByRole('button', { name: '重新尝试' }).click();
  await expect(page.locator('.markdown')).toHaveText('重试成功。');
  await expect(page.locator('.user-bubble')).toHaveCount(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('truncated streams show partial output and an actionable error', async ({ page }) => {
  await page.route('https://xcodebest.com/v1/responses', (route) => route.fulfill({ contentType: 'text/event-stream', body: frame({ type: 'response.output_text.delta', delta: '尚未完成的回复' }) }));
  await page.goto('/');
  await useModel(page, 'GPT');
  await send(page, '中断测试');
  await expect(page.locator('.markdown')).toHaveText('尚未完成的回复');
  await expect(page.getByRole('alert')).toContainText('连接提前中断');
  await expect(page.getByRole('button', { name: '重新尝试' })).toBeVisible();
});

test('stop generation restores composer and allows a fresh conversation', async ({ page }) => {
  await page.route('https://xcodebest.com/v1/responses', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.fulfill({ contentType: 'text/event-stream', body: responseBody('迟到的回复') }).catch(() => undefined);
  });
  await page.goto('/');
  await useModel(page, 'GPT');
  await send(page, '等待中');
  await expect(page.getByRole('button', { name: '新对话', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '停止生成' }).click();
  await expect(page.getByText('已停止生成', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await expect(page.getByRole('log', { name: '当前对话' })).toBeEmpty();
});

test('non-streaming JSON fallback and safe Markdown rendering', async ({ page }) => {
  await page.route('https://xcodebest.com/v1/responses', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: '<script>window.bad = true</script>\n\n[危险链接](javascript:alert(1))\n\n![外部图片](https://tracker.example/secret)' }] }] }) }));
  await page.goto('/');
  await useModel(page, 'GPT');
  await send(page, 'Markdown 安全测试');
  await expect(page.getByRole('button', { name: '复制回复' })).toBeVisible();
  await expect(page.locator('.markdown script')).toHaveCount(0);
  await expect(page.locator('.markdown img')).toHaveCount(0);
  await expect(page.locator('.markdown a')).not.toHaveAttribute('href', /javascript:/);
});

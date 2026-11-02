import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function viewport(page: Page, height: number, offsetTop: number, event = 'resize') {
  await page.evaluate(({ height, offsetTop, event }) => {
    Object.defineProperties(window.visualViewport, {
      height: { configurable: true, value: height },
      offsetTop: { configurable: true, value: offsetTop },
    });
    window.visualViewport!.dispatchEvent(new Event(event));
  }, { height, offsetTop, event });
  await expect.poll(() => page.locator('.composer-area').evaluate(element => Math.round(element.getBoundingClientRect().bottom)))
    .toBe(height + offsetTop);
}

test('composer follows keyboard resize and Safari pan without scrolling the document', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const input = page.getByRole('textbox', { name: '消息', exact: true });
  await input.click();
  await input.fill('你好');
  await viewport(page, 480, 0);
  const shortHeight = (await input.boundingBox())!.height;
  await viewport(page, 430, 50, 'scroll');
  await input.fill(Array.from({ length: 16 }, (_, index) => `第 ${index + 1} 行`).join('\n'));
  await expect.poll(async () => (await input.boundingBox())!.height).toBeGreaterThan(shortHeight);
  expect((await input.boundingBox())!.height).toBeLessThanOrEqual(144);
  await expect.poll(() => page.locator('.composer-area').evaluate(element => Math.round(element.getBoundingClientRect().bottom))).toBe(480);
  const header = (await page.locator('.site-header').boundingBox())!;
  const composer = (await page.locator('.composer').boundingBox())!;
  expect(composer.y).toBeGreaterThan(header.y + header.height);
  await input.fill('');
  await viewport(page, 480, 0, 'scroll');
  await input.blur();
  await viewport(page, 844, 0);
  expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test('long conversation stays inside its scroller when the keyboard opens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('https://xcode.best/v1/responses', route => route.fulfill({
    contentType: 'text/event-stream',
    body: `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: '这是一段回复。\n\n'.repeat(70) })}\n\ndata: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed' } })}\n\n`,
  }));
  await page.goto('/');
  const input = page.getByRole('textbox', { name: '消息', exact: true });
  await input.fill('长回复');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByRole('button', { name: '复制回复' })).toBeVisible();
  await input.click();
  await viewport(page, 430, 40);
  await input.fill('继续');
  expect(await page.locator('.main-area').evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await page.locator('.main-area').evaluate(element => { element.scrollTop = 0; });
  await expect(page.getByRole('button', { name: '回到最新消息' })).toBeVisible();
  await expect.poll(() => page.locator('.composer-area').evaluate(element => Math.round(element.getBoundingClientRect().bottom))).toBe(470);
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

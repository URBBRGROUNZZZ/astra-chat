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
  expect(await input.evaluate(element => {
    const editor = element as HTMLTextAreaElement;
    const rect = editor.getBoundingClientRect();
    return document.activeElement === editor && editor.selectionStart === editor.value.length
      && rect.top >= 50 && rect.bottom <= 480;
  })).toBe(true);
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
  await page.getByRole('button', { name: 'Claude', exact: true }).click();
  await page.getByRole('button', { name: 'GPT', exact: true }).click();
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

test('repeated keyboard dismissal restores the bottom composer without losing the draft or selection', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const input = page.getByRole('textbox', { name: '消息', exact: true });
  for (let cycle = 0; cycle < 3; cycle++) {
    await input.focus();
    await input.fill('第一行\n第二行\n');
    await page.keyboard.insertText('继续输入');
    await viewport(page, 390, 90);
    await expect(input).toHaveValue('第一行\n第二行\n继续输入');
    await expect(input).toBeFocused();
    // Real iOS focus handling may leave a scrolled document. Simulate that
    // independently of viewport panning, which the previous tests never did.
    await page.evaluate(() => { document.body.style.height = '1400px'; window.scrollTo(0, 160); });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await expect.poll(() => page.locator('.site-header').evaluate(element => element.getBoundingClientRect().top)).toBe(0);
    await input.blur();
    // The keyboard metrics settle after focusout, with no resize notification.
    await page.evaluate(() => {
      Object.defineProperties(visualViewport, {
        height: { configurable: true, value: 844 }, offsetTop: { configurable: true, value: 0 },
      });
      document.body.style.height = '';
    });
    await expect.poll(() => page.locator('.composer-area').evaluate(element => element.getBoundingClientRect().bottom)).toBe(844);
    await expect(input).toHaveValue('第一行\n第二行\n继续输入');
    const box = (await input.boundingBox())!;
    expect(box.y).toBeGreaterThan(600);
    await input.focus();
    await page.keyboard.insertText('。');
    await expect(input).toHaveValue('第一行\n第二行\n继续输入。');
  }
});

test('restoring, rotating and zooming do not leave a translated or collapsed editor', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const input = page.getByRole('textbox', { name: '消息', exact: true });
  await input.fill('恢复时保留草稿');
  await viewport(page, 430, 50);
  await page.evaluate(() => {
    Object.defineProperties(visualViewport, { height: { configurable: true, value: 844 }, offsetTop: { configurable: true, value: 0 } });
    window.dispatchEvent(new Event('pageshow'));
  });
  await expect.poll(() => page.locator('.composer-area').evaluate(element => element.getBoundingClientRect().bottom)).toBe(844);
  await page.evaluate(() => {
    Object.defineProperties(visualViewport, { height: { configurable: true, value: 0 }, offsetTop: { configurable: true, value: -40 } });
    visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expect(input).toBeVisible();
  await expect.poll(() => page.locator('.composer-area').evaluate(element => element.getBoundingClientRect().bottom)).toBe(844);
  await page.evaluate(() => {
    Object.defineProperties(visualViewport, { height: { configurable: true, value: 300 }, scale: { configurable: true, value: 2 } });
    visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expect.poll(() => page.locator('.composer-area').evaluate(element => element.getBoundingClientRect().bottom)).toBe(844);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => {
    Object.defineProperties(visualViewport, { height: { configurable: true, value: 260 }, offsetTop: { configurable: true, value: 0 }, scale: { configurable: true, value: 1 } });
    window.dispatchEvent(new Event('orientationchange'));
  });
  await expect.poll(() => page.locator('.composer-area').evaluate(element => element.getBoundingClientRect().bottom)).toBe(260);
  await expect(input).toHaveValue('恢复时保留草稿');
  const box = (await input.boundingBox())!;
  expect(box.y).toBeGreaterThan(100);
  expect(box.y + box.height).toBeLessThanOrEqual(260);
});

test('multiline typing grows naturally, keeps the end visible and shrinks after clearing', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const input = page.getByRole('textbox', { name: '消息', exact: true });
  await input.focus();
  await viewport(page, 430, 0);
  const oneLine = (await input.boundingBox())!.height;
  for (let line = 0; line < 12; line++) {
    await page.keyboard.insertText('中文输入、长行文本 testing words ');
    await page.keyboard.press('Shift+Enter');
  }
  expect((await input.boundingBox())!.height).toBeGreaterThan(oneLine);
  expect((await input.boundingBox())!.height).toBeLessThanOrEqual(129);
  expect(await input.evaluate(element => {
    const editor = element as HTMLTextAreaElement;
    return editor.selectionStart === editor.value.length && editor.scrollTop > 0;
  })).toBe(true);
  await input.fill('');
  await expect.poll(async () => (await input.boundingBox())!.height).toBe(oneLine);
  await expect(input).toBeFocused();
  expect(await input.evaluate(element => element.scrollTop)).toBe(0);
});

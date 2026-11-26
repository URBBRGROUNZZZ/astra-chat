import { expect, test } from '@playwright/test';
import { useModel } from './helpers';
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

const png = { name: 'question.png', mimeType: 'image/png', buffer: readFileSync('public/icon-192.png') };
const pdf = { name: 'note.pdf', mimeType: 'application/pdf', buffer: readFileSync('tests/fixtures/note.pdf') };
const docx = { name: 'note.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: readFileSync('tests/fixtures/note.docx') };
const note = { name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('蓝色的纸船，编号 4827。') };
const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const response = frame({ type: 'response.output_text.delta', delta: '已读取附件。' }) + frame({ type: 'response.completed' });
const picker = (page: Page) => page.locator('input[type="file"]');

test('GPT sends images, PDF and text and keeps them in context', async ({ page }) => {
  const calls: any[] = [];
  await page.route('https://xcodebest.com/v1/**', async route => {
    calls.push(route.request().postDataJSON());
    await route.fulfill({ contentType: 'text/event-stream', body: response });
  });
  await page.goto('/');
  await useModel(page, 'GPT');
  await picker(page).setInputFiles([png, pdf, note]);
  await expect(page.locator('.pending-attachments .attachment')).toHaveCount(3);
  await expect(page.locator('.pending-attachments img')).toBeVisible();
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('看看这些附件');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByRole('button', { name: '复制回复' })).toBeVisible();
  await expect(page.locator('.pending-attachments')).toHaveCount(0);
  await expect(page.locator('.sent-attachments .attachment')).toHaveCount(3);
  const wire = calls[0].input;
  const parts = wire[0].content;
  expect(parts.map((part: any) => part.type)).toEqual(['input_text', 'input_image', 'input_file', 'input_text']);
  expect(parts[0].text).toBe('看看这些附件');
  expect(parts.at(-1).text).toContain('蓝色的纸船');
  expect(parts[1].image_url).toBe(`data:image/png;base64,${png.buffer.toString('base64')}`);
  expect(parts[2].file_data).toBe(`data:application/pdf;base64,${pdf.buffer.toString('base64')}`);
  expect(parts[2].filename).toBe('note.pdf');
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('继续分析');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByRole('button', { name: '复制回复' })).toHaveCount(2);
  const followup = calls[1].input;
  expect(followup[0]).toEqual(wire[0]);
  expect(followup[2]).toEqual({ role: 'user', content: '继续分析' });
  expect(await page.evaluate(() => Object.keys(localStorage).length + Object.keys(sessionStorage).length)).toBe(0);
  await page.reload();
  await expect(page.locator('.attachment')).toHaveCount(0);
  await expect(page.locator('.empty-mark')).toBeVisible();
});

test('attachment-only send, removal and retry preserve the file', async ({ page }) => {
  let attempts = 0;
  await page.route('https://xcodebest.com/v1/**', async route => {
    const body = route.request().postDataJSON();
    const turns = body.input || body.messages;
    expect(turns).toHaveLength(1);
    expect(turns[0].content).toHaveLength(1);
    expect(turns[0].content[0].text).toContain('蓝色的纸船');
    attempts++;
    if (attempts === 1) await route.fulfill({ status: 503, body: '{}' });
    else await route.fulfill({ contentType: 'text/event-stream', body: response });
  });
  await page.goto('/');
  await useModel(page, 'GPT');
  await picker(page).setInputFiles([png, note]);
  await expect(page.locator('.pending-attachments .attachment')).toHaveCount(2);
  await page.getByRole('button', { name: '移除 question.png' }).click();
  await expect(page.locator('.pending-attachments .attachment')).toHaveCount(1);
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('503');
  await page.getByRole('button', { name: '重新尝试' }).click();
  await expect(page.locator('.markdown')).toHaveText('已读取附件。');
  await expect(page.locator('.message-user')).toHaveCount(1);
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await expect(page.locator('.attachment')).toHaveCount(0);
});

test('DOCX text is extracted locally; unsupported and oversized files show useful errors', async ({ page }) => {
  let text = '';
  await page.route('https://xcodebest.com/v1/responses', async route => {
    text = route.request().postDataJSON().input[0].content[0].text;
    await route.fulfill({ contentType: 'text/event-stream', body: response });
  });
  await page.goto('/');
  await useModel(page, 'GPT');
  await picker(page).setInputFiles({ name: 'archive.zip', mimeType: 'application/zip', buffer: Buffer.from('bad') });
  await expect(page.getByRole('alert')).toContainText('暂不支持');
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled();
  await picker(page).setInputFiles({ name: 'huge.txt', mimeType: 'text/plain', buffer: Buffer.alloc(5 * 1024 * 1024 + 1, 'a') });
  await expect(page.getByRole('alert')).toContainText('不能超过 5 MB');
  await picker(page).setInputFiles(docx);
  await expect(page.locator('.pending-attachments')).toContainText('note.docx');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.locator('.markdown')).toBeVisible();
  expect(text).toContain('蓝色的纸船，编号 4827');
});

test('pasting files and dropping files add attachments, clear restores the empty composer', async ({ page }) => {
  await page.goto('/');
  await useModel(page, 'GPT');
  await page.getByRole('textbox', { name: '消息', exact: true }).evaluate(element => {
    const data = new DataTransfer();
    data.items.add(new File(['pasted'], 'paste.txt', { type: 'text/plain' }));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('.pending-attachments')).toContainText('paste.txt');
  await page.locator('.composer').evaluate(element => {
    const data = new DataTransfer();
    data.items.add(new File(['dropped'], 'drop.md', { type: 'text/markdown' }));
    element.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('.pending-attachments .attachment')).toHaveCount(2);
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await expect(page.locator('.pending-attachments')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled();
});

test('attachment strip stays bounded with multiple files and a reduced keyboard viewport', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await useModel(page, 'GPT');
  await picker(page).setInputFiles(Array.from({ length: 7 }, (_, index) => ({ ...png, name: `image-${index}.png` })));
  await expect(page.locator('.pending-attachments .attachment')).toHaveCount(6);
  await expect(page.getByRole('alert')).toContainText('最多添加 6 个');
  await page.getByRole('button', { name: '关闭附件提示' }).click();
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('分析这些图片');
  await page.evaluate(() => {
    Object.defineProperties(visualViewport, { height: { configurable: true, value: 430 }, offsetTop: { configurable: true, value: 40 } });
    visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expect.poll(() => page.locator('.composer-area').evaluate(element => Math.round(element.getBoundingClientRect().bottom))).toBe(470);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  expect((await page.locator('.composer').boundingBox())!.height).toBeLessThan(180);
  await page.screenshot({ path: `test-results/attachments-${info.project.name}.png`, animations: 'disabled' });
});

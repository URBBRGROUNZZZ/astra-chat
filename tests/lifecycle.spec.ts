import { expect, test } from '@playwright/test';
import { useModel } from './helpers';

for (const phase of ['completed', 'reading', 'headers', 'json'] as const) {
  test(`can send again when ${phase} transport cleanup stalls`, async ({ page }) => {
    await page.addInitScript(({ phase }) => {
      const realFetch = window.fetch;
      let attempts = 0;
      window.fetch = async (input, init) => {
        if (!String(input).includes('xcodebest.com')) return realFetch(input, init);
        attempts++;
        const frame = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
        const answer = frame({ type: 'response.output_text.delta', delta: `回复 ${attempts}` }) + frame({ type: 'response.completed' });
        if (attempts > 1) return new Response(answer, { headers: { 'Content-Type': 'text/event-stream' } });
        // Simulate a transport that neither settles cancellation nor honors AbortSignal.
        if (phase === 'headers') return new Promise<Response>(() => {});
        return new Response(new ReadableStream({
          start(controller) {
            if (phase === 'completed') controller.enqueue(new TextEncoder().encode(answer));
            if (phase === 'reading') controller.enqueue(new TextEncoder().encode(frame({ type: 'response.output_text.delta', delta: '部分回复' })));
          },
          cancel() { return new Promise<void>(() => {}); },
        }), { headers: { 'Content-Type': phase === 'json' ? 'application/json' : 'text/event-stream' } });
      };
    }, { phase });
    await page.goto('/');
  await useModel(page, 'GPT');
    const input = page.getByRole('textbox', { name: '消息', exact: true });
    const send = page.getByRole('button', { name: '发送消息', exact: true });
    await input.fill('第一问');
    await send.click();
    if (phase === 'reading') await expect(page.locator('.markdown')).toHaveText('部分回复');
    if (phase !== 'completed') {
      await page.getByRole('button', { name: '停止生成' }).click();
      await expect(page.getByText('已停止生成', { exact: true })).toBeVisible();
    }
    await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0);
    await input.fill('第二问');
    await send.click();
    await expect(page.locator('.markdown').last()).toHaveText('回复 2');
    await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0);
  });
}

test('idle timeout unlocks a stalled read and permits the next question', async ({ page }) => {
  await page.addInitScript(() => {
    const realFetch = window.fetch;
    let attempts = 0;
    window.fetch = async (input, init) => {
      if (!String(input).includes('xcodebest.com')) return realFetch(input, init);
      if (++attempts === 1) return new Response(new ReadableStream({ cancel() { return new Promise<void>(() => {}); } }), { headers: { 'Content-Type': 'text/event-stream' } });
      return new Response('data: {"type":"response.output_text.delta","delta":"恢复成功"}\n\ndata: {"type":"response.completed"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    };
  });
  await page.clock.install();
  await page.goto('/');
  await useModel(page, 'GPT');
  const input = page.getByRole('textbox', { name: '消息', exact: true });
  await input.fill('等待超时');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByRole('button', { name: '停止生成' })).toBeVisible();
  await page.clock.fastForward(120_001);
  await expect(page.getByRole('alert')).toContainText('等待回复超时');
  await input.fill('继续');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.locator('.markdown')).toHaveText('恢复成功');
});

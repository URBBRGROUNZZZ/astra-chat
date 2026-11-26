import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export const GPT_URL = 'https://xcodebest.com/v1/responses';
export const CLAUDE_URL = 'https://xcodebest.com/v1/messages';

export type ModelName = 'GPT' | 'Claude';

export async function useModel(page: Page, name: ModelName) {
  const trigger = page.locator('.model-trigger');
  await expect(trigger).toBeVisible();
  if ((await trigger.textContent())?.includes(name)) return;
  await trigger.click();
  await page.locator('#model-options').getByRole('button', { name, exact: true }).click();
  await expect(trigger).toContainText(name);
}

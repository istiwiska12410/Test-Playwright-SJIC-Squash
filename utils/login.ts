import { expect, Page } from '@playwright/test';
import { appProperties } from '../config/properties';

export async function login(page: Page): Promise<void> {
  await loginAs(page, appProperties.username, appProperties.password);
}

export async function loginAs(
  page: Page,
  username: string,
  password: string,
  appUrl: string = appProperties.appUrl
): Promise<void> {
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });

  await page.getByRole('textbox', { name: 'Enter Username' }).fill(username);
  await page.getByRole('textbox', { name: 'Enter Password' }).fill(password);

  // Jangan pakai Enter + click sekaligus, supaya tidak double submit.
  await page.getByRole('button', { name: 'Sign In' }).click();

  await page.waitForLoadState('networkidle').catch(() => {
    // Beberapa app tetap punya request terbuka, jadi networkidle bisa timeout.
  });

  await expect(page.getByRole('button', { name: 'Sign In' })).toBeHidden({
    timeout: appProperties.defaultTimeout,
  });
}
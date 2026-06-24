import { test, expect } from '@playwright/test';

test('[SQUASH_ITPI:268] Add new Tablet Code', async ({ page }) => {
  await page.goto('https://test.pmmp-abs.com/dpsSJIC/main/index.jsp');
  await page.getByRole('textbox', { name: 'Enter Username' }).click();
  await page.getByRole('textbox', { name: 'Enter Username' }).fill('it@test.com');
  await page.getByRole('textbox', { name: 'Enter Username' }).press('Tab');
  await page.getByRole('textbox', { name: 'Enter Password' }).fill('pmmp123');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.getByRole('link', { name: 'Operational Data' }).click();
  await page.getByRole('link', { name: 'Tetapkan Tablet Code' }).click();
  await page.getByRole('link', { name: 'Add Tablet Code' }).click();
  await page.locator('#userId').selectOption('1127');
  await page.locator('#code').click();
  await page.locator('#code').fill('167');
  await page.locator('#imei').click();
  await page.locator('#imei').fill('4123');
  await page.getByRole('button', { name: 'Create' }).click();
  const successMessage = page.getByText('Tablet Code Added');
  await expect(successMessage).toBeVisible({ timeout: 30000 });
});

test('[SQUASH_ITPI:269] Delete Tablet Code @PLX-PW-TAB-002', async ({ page }) => {
  await page.goto('https://test.pmmp-abs.com/dpsSJIC/main/');
  await page.getByRole('textbox', { name: 'Enter Username' }).click();
  await page.getByRole('textbox', { name: 'Enter Username' }).fill('it@test.com');
  await page.getByRole('textbox', { name: 'Enter Username' }).press('Tab');
  await page.getByRole('textbox', { name: 'Enter Password' }).fill('pmmp123');
  await page.getByRole('button', { name: 'Sign In' }).click();
 
  await page.getByRole('link', { name: 'Operational Data' }).click();
  await page.waitForLoadState('networkidle', { timeout: 10000 });
 
  await page.getByRole('link', { name: 'Tetapkan Tablet Code' }).click();
  await page.waitForLoadState('networkidle', { timeout: 10000 });
 
  await page.locator('#searchStr').click();
  await page.locator('#searchStr').fill('123');
  await page.getByRole('button', { name: 'Search' }).click();
 
  // Wait for search results to load
  await page.waitForLoadState('networkidle', { timeout: 10000 });
  await page.waitForTimeout(1000); // Extra wait for table to render
 
  // Click the delete button (image inside the link) - with better selector
  const deleteButton = page.getByRole('link').filter({ hasText: /^$/ }).nth(2);
  deleteButton.click();
  const dialogPromise = page.waitForEvent('dialog');
 
  const dialog = await dialogPromise;
 
  console.log('Dialog type:', dialog.type());
  console.log('Dialog message:', dialog.message());
 
  await dialog.accept();
 
  // Verify the record was deleted
  const recordDeleted = await page.locator('tr:nth-child(4)').isVisible().catch(() => false);
  console.log(`Record deleted: ${!recordDeleted}`);
 
 
 
});
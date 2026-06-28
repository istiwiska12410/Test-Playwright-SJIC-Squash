// @TestmoId:129
import { test, expect, Page } from '@playwright/test';
import { login } from '../../utils/login';
import { expectSelectHasExactOptions,selectDropdownByText,generateQAText,expectSuccessTextVisible } from '../../utils/global';
import { appProperties } from '../../config/properties';

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('[TC-129] Category dropdown should contain exactly five Water Treatment categories', async ({ page }) => {
  await test.step('Open Add Container form', async () => {
    await page.getByRole('link', { name: 'Operational Data' }).click();
    await page.getByRole('link', { name: 'Maintain Laboratory Module' }).click();
    await page.getByRole('link', { name: 'Water Treatment Container' }).click();
    await page.getByRole('link', { name: 'Add Container' }).click();
  });

  await test.step('Verify Category dropdown options', async () => {

    await expectSelectHasExactOptions(page, '#categoryId', [
      'Raw Water Analysis',
      'Softener Water Analysis',
      'Feed Water Analysis',
      'Boiler Water Analysis',
      'Effluent Water Analysis',
    ]);
  });
});

test('[TC-135] Data Persistence and List View Accuracy', async ({ page }) => {
  await test.step('Open Add Container form', async () => {
    await page.getByRole('link', { name: 'Operational Data' }).click();
    await page.getByRole('link', { name: 'Maintain Laboratory Module' }).click();
    await page.getByRole('link', { name: 'Water Treatment Container' }).click();
    await page.getByRole('link', { name: 'Add Container' }).click();
  });

  await test.step('Add New Water Treatment Container', async () => {
    const qaNumber = generateQAText();
    await selectDropdownByText(page, '#categoryId', 'Raw Water Analysis');
    await selectDropdownByText(page, '#machine', 'NUT STATION');
    await page.locator('#sample_0').click();
    await page.locator('#sample_0').fill(qaNumber);
    await page.locator('#target').click();
    await page.locator('#target').fill('45');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.getByText('Added').click();
    await expectSuccessTextVisible(page, 'Added', qaNumber);
  });
});
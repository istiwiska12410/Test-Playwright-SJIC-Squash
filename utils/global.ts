import { expect, Page } from '@playwright/test';

export async function expectSelectHasExactOptions(
  page: Page,
  selectSelector: string,
  expectedOptions: string[],
  placeholderValue: string = '0'
): Promise<void> {
  const select = page.locator(selectSelector);
  const options = page.locator(`${selectSelector} option:not([value="${placeholderValue}"])`);

  await expect(select).toBeVisible();
  await expect(options).toHaveCount(expectedOptions.length);
  await expect(options).toHaveText(expectedOptions);
}

export async function selectDropdownByText(
  page: Page,
  selector: string,
  optionText: string
): Promise<void> {
  const dropdown = page.locator(selector);

  await expect(dropdown).toBeVisible();
  await expect(dropdown).toBeEnabled();

  await page.waitForFunction(
    ({ selector, optionText }) => {
      const select = document.querySelector(selector) as HTMLSelectElement | null;
      if (!select) return false;

      return Array.from(select.options).some(
        option => option.textContent?.trim() === optionText
      );
    },
    { selector, optionText },
    { timeout: 10000 }
  );

  const selectedValue = await dropdown.locator('option').evaluateAll(
    (options, optionText) => {
      const matched = options.find(
        option => option.textContent?.trim() === optionText
      ) as HTMLOptionElement | undefined;

      return matched?.value;
    },
    optionText
  );

  if (!selectedValue) {
    const availableOptions = await dropdown.locator('option').allTextContents();

    throw new Error(
      `Option "${optionText}" tidak ditemukan di dropdown "${selector}". Available options: ${availableOptions.join(', ')}`
    );
  }

  await dropdown.selectOption(selectedValue);

  await expect(dropdown.locator('option:checked')).toHaveText(optionText);
}

export function generateQAText(prefix: string = 'QA'): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14);

  const randomNumber = Math.floor(1000 + Math.random() * 9000);

  return `${prefix} Auto Text ${timestamp}${randomNumber}`;
}

export async function expectTextVisible(
  page: Page,
  text: string,
  timeout: number = 15000
): Promise<void> {
  await expect(page.getByText(text, { exact: true })).toBeVisible({ timeout });
}

export async function expectSuccessTextVisible(
  page: Page,
  successText: string,
  generatedData?: string,
  timeout: number = 15000
): Promise<void> {
  await expectTextVisible(page, successText, timeout);

  if (generatedData) {
    console.log(`Sukses menambahkan data: ${generatedData}`);
  } else {
    console.log(`Sukses: ${successText}`);
  }
}
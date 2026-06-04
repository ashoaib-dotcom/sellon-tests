import { Page, expect } from '@playwright/test';

export class ProductFormPage {
  constructor(private page: Page) {}

  // Actions
  async fillField(labelText: string, value: string) {
    const filled = await this.page.evaluate(({ label, val }) => {
      const allElements = document.querySelectorAll('[class*="label"], label, span, div');
      for (const el of allElements) {
        const text = el.textContent?.trim();
        if (text === label && el.children.length === 0) {
          let parent = el.parentElement;
          for (let i = 0; i < 5 && parent; i++) {
            const input = parent.querySelector('input:not([type="hidden"]):not([type="checkbox"]), textarea');
            if (input && (input as HTMLElement).offsetParent !== null) {
              (input as HTMLInputElement).focus();
              (input as HTMLInputElement).value = val;
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
              input.dispatchEvent(new Event('blur', { bubbles: true }));
              return { found: true, tag: input.tagName };
            }
            parent = parent.parentElement;
          }
        }
      }
      return { found: false, tag: '' };
    }, { label: labelText, val: value });

    console.log(`  ${labelText} = "${value}" → ${filled.found ? 'OK' : 'NOT FOUND'}`);
    await this.page.waitForTimeout(500);
    return filled.found;
  }

  async fillTitle(value: string) {
    return await this.page.evaluate((val) => {
      const allElements = document.querySelectorAll('[class*="label"], label, span, div');
      for (const el of allElements) {
        if (el.textContent?.trim() === 'Title' && el.children.length === 0) {
          let parent = el.parentElement;
          for (let i = 0; i < 8 && parent; i++) {
            const input = parent.querySelector('input:not([type="hidden"]):not([type="checkbox"])');
            if (input && (input as HTMLElement).offsetParent !== null) {
              (input as HTMLInputElement).focus();
              (input as HTMLInputElement).value = val;
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
              return true;
            }
            parent = parent.parentElement;
          }
        }
      }
      return false;
    }, value);
  }

  async fillDescription(value: string) {
    return await this.page.evaluate((val) => {
      const textareas = document.querySelectorAll('textarea');
      for (const ta of textareas) {
        if ((ta as HTMLElement).offsetParent !== null) {
          ta.focus();
          ta.value = val;
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          ta.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
      }
      return false;
    }, value);
  }

  async clickTab(tabName: string) {
    await this.page.getByText(tabName, { exact: true }).click();
    await this.page.waitForTimeout(3000);
  }

  async clickSave() {
    await this.page.getByText('Save', { exact: true }).click();
    await this.page.waitForTimeout(15000);
  }

  // Assertions
  async expectFormVisible() {
    await expect(this.page.getByText('Save', { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(this.page.getByText('Master data', { exact: true })).toBeVisible();
  }

  async expectFieldValue(value: string) {
    const found = await this.page.evaluate((val) => {
      const inputs = document.querySelectorAll('input');
      for (const i of inputs) { if (i.value === val) return true; }
      return false;
    }, value);
    expect(found).toBeTruthy();
  }

  async expectBodyContains(text: string) {
    const bodyText = await this.page.locator('body').innerText();
    expect(bodyText).toContain(text);
  }

  async expectBodyContainsError() {
    const bodyText = await this.page.locator('body').innerText();
    const hasError = bodyText.toLowerCase().includes('error') ||
                     bodyText.toLowerCase().includes('mandatory') ||
                     bodyText.toLowerCase().includes('required') ||
                     bodyText.toLowerCase().includes('checksum');
    expect(hasError).toBeTruthy();
  }
}
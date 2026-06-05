import { Page, expect } from '@playwright/test';

export class ProductFormPage {
  constructor(private page: Page) {}

  // Find the DOM index of an input associated with a label — used so we can
  // fill it with Playwright's .fill() rather than direct .value assignment,
  // which React resets on every re-render.
  private async findInputIndex(labelText: string): Promise<number> {
    return this.page.evaluate(({ label }) => {
      const normalize = (t: string | null | undefined) => t?.replace(/\s+/g, ' ').trim() || '';
      // Exact match only — startsWith would match ancestor containers whose
      // descendant text begins with the label, returning the wrong first input.
      const matches = (text: string, lbl: string) =>
        text === lbl ||
        text === `${lbl}*` ||
        text === `${lbl} *` ||
        text === `${lbl}:`;

      const allInputs = Array.from(
        document.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]), textarea')
      );

      const findInput = (el: Element): number => {
        // Walk up at most 5 levels to find a container with a visible input.
        let parent: Element | null = el.parentElement;
        for (let i = 0; i < 5 && parent; i++) {
          const input = parent.querySelector(
            'input:not([type="hidden"]):not([type="checkbox"]), textarea'
          );
          if (input && (input as HTMLElement).offsetParent !== null) {
            return allInputs.indexOf(input as HTMLInputElement | HTMLTextAreaElement);
          }
          parent = parent.parentElement;
        }
        return -1;
      };

      // Strategy 1: proper <label> elements (most reliable)
      for (const el of document.querySelectorAll('label')) {
        if (matches(normalize(el.textContent), label)) {
          const forId = el.getAttribute('for');
          if (forId) {
            const input = document.getElementById(forId);
            if (input && (input as HTMLElement).offsetParent !== null)
              return allInputs.indexOf(input as HTMLInputElement);
          }
          const idx = findInput(el);
          if (idx >= 0) return idx;
        }
      }

      // Strategy 2: leaf/near-leaf elements only — skip containers that have
      // block-level children (their textContent would span multiple fields).
      for (const el of document.querySelectorAll('[class*="label"], span, div')) {
        const hasBlockChildren = Array.from(el.children).some(
          (c) => !['SPAN', 'EM', 'STRONG', 'B', 'I', 'ABBR'].includes(c.tagName)
        );
        if (hasBlockChildren) continue;
        if (matches(normalize(el.textContent), label)) {
          const idx = findInput(el);
          if (idx >= 0) return idx;
        }
      }

      return -1;
    }, { label: labelText });
  }

  // Fill any field by its label
  async fillField(labelText: string, value: string): Promise<boolean> {
    // Try accessible label first (handles proper ARIA/for associations)
    try {
      const byLabel = this.page.getByLabel(labelText, { exact: false }).first();
      if (await byLabel.count() > 0) {
        await byLabel.fill(value);
        await this.page.waitForTimeout(300);
        console.log(`  ${labelText} = "${value}" → OK`);
        return true;
      }
    } catch {}

    // Find the input via DOM traversal, then fill via Playwright locator so
    // Angular/React's synthetic event handlers are properly triggered.
    const idx = await this.findInputIndex(labelText);
    if (idx >= 0) {
      const input = this.page.locator(
        'input:not([type="hidden"]):not([type="checkbox"]), textarea'
      ).nth(idx);
      await input.fill(value);
      await this.page.waitForTimeout(300);
      console.log(`  ${labelText} = "${value}" → OK`);
      return true;
    }

    console.log(`  ${labelText} = "${value}" → NOT FOUND`);
    return false;
  }

  // Fill Title field (special - inside tabbed section)
  async fillTitle(value: string): Promise<boolean> {
    const idx = await this.page.evaluate(() => {
      const allInputs = Array.from(
        document.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"])')
      );
      const labelEls = document.querySelectorAll('[class*="label"], label, span, div');
      for (const el of labelEls) {
        if (el.textContent?.trim() === 'Title' && el.children.length === 0) {
          let parent = el.parentElement;
          for (let i = 0; i < 8 && parent; i++) {
            const input = parent.querySelector('input:not([type="hidden"]):not([type="checkbox"])');
            if (input && (input as HTMLElement).offsetParent !== null) {
              return allInputs.indexOf(input as HTMLInputElement);
            }
            parent = parent.parentElement;
          }
        }
      }
      return -1;
    });

    if (idx >= 0) {
      const input = this.page.locator(
        'input:not([type="hidden"]):not([type="checkbox"])'
      ).nth(idx);
      await input.fill(value);
      await this.page.waitForTimeout(300);
      console.log(`  Title = "${value}" → OK`);
      return true;
    }

    console.log(`  Title = "${value}" → NOT FOUND`);
    return false;
  }

  // Fill Description field (textarea)
  async fillDescription(value: string): Promise<boolean> {
    const textarea = this.page.locator('textarea').filter({ visible: true }).first();
    if (await textarea.count() > 0) {
      await textarea.fill(value);
      await this.page.waitForTimeout(300);
      console.log(`  Description = "${value.substring(0, 40)}..." → OK`);
      return true;
    }
    console.log(`  Description = "${value.substring(0, 40)}..." → NOT FOUND`);
    return false;
  }

  // Select the first available option in the Category custom dropdown
  async selectFirstCategory(): Promise<boolean> {
    // Strategy 1: Use findInputIndex to locate the lb-select's internal <input>,
    // click it for proper focus (which opens the dropdown), then wait for options
    // to finish loading (categories are fetched async — spinner appears first)
    // before navigating with ArrowDown + Enter.
    const idx = await this.findInputIndex('Category');
    if (idx >= 0) {
      const input = this.page.locator(
        'input:not([type="hidden"]):not([type="checkbox"]), textarea'
      ).nth(idx);

      // Snapshot the number of ALREADY-VISIBLE option-items (e.g. the page's
      // always-present "all / inverse / none" column-picker items).  We then
      // wait until the count grows, which means the async category list loaded.
      const beforeCount = await this.page.locator('[class*="option-item"]')
        .filter({ visible: true }).count();

      await input.click();

      // Wait until new option-items appear (category list finished loading)
      await this.page.waitForFunction(
        (prev) =>
          Array.from(document.querySelectorAll('[class*="option-item"]'))
            .filter((el) => (el as HTMLElement).offsetParent !== null).length > prev,
        beforeCount,
        { timeout: 15000 }
      );

      // Categories are now loaded — navigate and select the first one
      await this.page.keyboard.press('ArrowDown');
      await this.page.waitForTimeout(300);
      await this.page.keyboard.press('Enter');
      await this.page.waitForTimeout(500);
      console.log('  Category → selected via internal input + keyboard');
      return true;
    }

    // Strategy 2: fallback — click the label's parent to open the dropdown
    const categoryLabel = this.page.getByText('Category', { exact: true }).first();
    if (await categoryLabel.count() === 0) {
      console.log('  Category → label not found');
      return false;
    }

    for (const xp of ['xpath=..', 'xpath=../..']) {
      try {
        await categoryLabel.locator(xp).click({ timeout: 3000 });
        break;
      } catch {}
    }

    await this.page.waitForTimeout(300);
    await this.page.keyboard.press('ArrowDown');
    await this.page.waitForTimeout(200);
    await this.page.keyboard.press('Enter');
    await this.page.waitForTimeout(400);
    console.log('  Category → selected via fallback keyboard');
    return true;
  }

  // Navigate to the Media tab and add an image URL
  async fillMediaUrl(url: string): Promise<boolean> {
    await this.clickTab('Media');
    await this.page.waitForTimeout(1500);

    // The Image URL section has a disabled input by default.
    // Clicking the green "+ New" button (inside the tab, not the toolbar) creates
    // a new row and enables the URL input.
    const allNewBtns = this.page.locator('button').filter({ hasText: 'New' }).filter({ visible: true });
    const btnCount = await allNewBtns.count();
    if (btnCount > 0) {
      // The toolbar "New" is typically first; the Media section "+ New" is last.
      await allNewBtns.last().click();
      await this.page.waitForTimeout(1000);
    }

    // After clicking New, look for an enabled URL input
    const urlInput = this.page.locator('input[inputmode="url"]').filter({ visible: true }).first();
    if (await urlInput.count() > 0 && await urlInput.isEnabled()) {
      await urlInput.fill(url);
      await this.page.waitForTimeout(400);
      console.log(`  Media URL = "${url}" → OK`);
      return true;
    }

    // Fallback: force-click the URL input in case it needs a click to activate
    if (await urlInput.count() > 0) {
      await urlInput.click({ force: true });
      await this.page.waitForTimeout(300);
      if (await urlInput.isEnabled()) {
        await urlInput.fill(url);
        await this.page.waitForTimeout(400);
        console.log(`  Media URL = "${url}" → OK (after force click)`);
        return true;
      }
    }

    // Last resort: any enabled visible text input in the tab
    const anyInput = this.page.locator('input:not([disabled]):not([type="hidden"])').filter({ visible: true }).last();
    if (await anyInput.count() > 0) {
      await anyInput.fill(url);
      await this.page.waitForTimeout(400);
      console.log(`  Media URL = "${url}" → OK (fallback input)`);
      return true;
    }

    console.log('  Media URL → no enabled input found');
    return false;
  }

  // Click a tab (Master data, Price & stock, Media, etc.)
  async clickTab(tabName: string) {
    await this.page.getByText(tabName, { exact: true }).click();
    await this.page.waitForTimeout(3000);
  }

  // Click Save button
  async clickSave() {
    await this.page.getByText('Save', { exact: true }).click();
    await this.page.waitForTimeout(15000);
  }

  // Verify form is open
  async expectFormVisible() {
    await expect(this.page.getByText('Save', { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(this.page.getByText('Master data', { exact: true })).toBeVisible();
  }

  // Verify a specific value exists in any input
  async expectFieldValue(value: string) {
    const found = await this.page.evaluate((val) => {
      const controls = Array.from(document.querySelectorAll('input, textarea, select'));
      for (const el of controls) {
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          if (el.value === val) return true;
        }
        if (el instanceof HTMLSelectElement) {
          if (Array.from(el.selectedOptions).some((opt) => opt.value === val || opt.text === val)) return true;
        }
      }
      const textFields = Array.from(document.querySelectorAll('[role="textbox"]'));
      for (const el of textFields) {
        if ((el.textContent || '').trim() === val) return true;
      }
      return false;
    }, value);
    expect(found).toBeTruthy();
  }

  // Verify a specific labeled field contains the expected value
  async expectFieldValueByLabel(labelText: string, value: string) {
    // Try accessible label first
    const field = this.page.getByLabel(labelText, { exact: false }).first();
    if (await field.count() > 0) {
      await expect(field).toHaveValue(value, { timeout: 15000 });
      return;
    }

    // Find the input via DOM traversal and assert with Playwright
    const idx = await this.findInputIndex(labelText);
    if (idx >= 0) {
      const input = this.page.locator(
        'input:not([type="hidden"]):not([type="checkbox"]), textarea'
      ).nth(idx);
      await expect(input).toHaveValue(value, { timeout: 15000 });
      return;
    }

    throw new Error(`Field with label "${labelText}" not found on the page`);
  }

  // Verify page body contains text
  async expectBodyContains(text: string) {
    const bodyText = await this.page.locator('body').innerText();
    expect(bodyText).toContain(text);
  }

  // Verify page shows an error (red validation banner is visible)
  async expectHasError() {
    // Primary check: a red/error banner is visible on the page
    const redBanner = this.page.locator('[class*="alert"], [class*="error"], [class*="danger"], [class*="invalid"]')
      .filter({ visible: true }).first();
    if (await redBanner.count() > 0) return;

    // Fallback: keyword matching in body text
    const bodyText = await this.page.locator('body').innerText();
    const lower = bodyText.toLowerCase();
    const hasError = lower.includes('error') ||
                     lower.includes('mandatory') ||
                     lower.includes('required') ||
                     lower.includes('checksum') ||
                     lower.includes('must not') ||
                     lower.includes('invalid') ||
                     lower.includes('between') ||
                     lower.includes('allowed') ||
                     lower.includes('mustn') ||
                     lower.includes('exceeded');
    expect(hasError).toBeTruthy();
  }
}

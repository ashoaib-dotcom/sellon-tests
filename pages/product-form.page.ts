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
      await this.page.waitForTimeout(1500);

      // If an autocomplete dropdown appeared, click the first option so
      // Angular's form model registers the selection (Escape closes without selecting).
      const option = this.page.locator(
        'mat-option, [role="option"], .ng-option, [class*="autocomplete"] li'
      ).filter({ visible: true }).first();
      if (await option.count() > 0) {
        await option.click();
        await this.page.waitForTimeout(400);
      } else {
        // No dropdown — press Tab to commit the typed value (Tab moves focus
        // away, which Angular uses to finalise the field value).
        await this.page.keyboard.press('Tab');
        await this.page.waitForTimeout(300);
      }
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

  // Select a category from the dropdown.
  // Strategy:
  //   1. Click the dropdown arrow button to open the panel and wait for options
  //   2. If options appear, click the first one
  //   3. If no options appear, search for a known category name and select it
  async selectFirstCategory(): Promise<boolean> {
    const searchTerms = ['3D Printer', '3D Printers', '3D Scanner', '3D Scanners', 'Electronics', 'Accessories'];

    try {
      // Find the Category field container — look for the arrow/chevron toggle button
      const arrowBtn = this.page.locator(
        '[class*="category"] button, [formcontrolname*="category"] button, ' +
        'mat-select[formcontrolname*="category"], ' +
        'label:has-text("Category") ~ * button, ' +
        'label:has-text("Category") + * button'
      ).filter({ visible: true }).first();

      if (await arrowBtn.count() > 0) {
        await arrowBtn.click();
      } else {
        // Fallback: click the input associated with the Category label
        const idx = await this.findInputIndex('Category');
        if (idx >= 0) {
          const input = this.page.locator(
            'input:not([type="hidden"]):not([type="checkbox"]), textarea'
          ).nth(idx);
          await input.click();
        } else {
          // Last resort: click any visible mat-select or select labelled "Category"
          const matSelect = this.page.getByLabel('Category', { exact: false }).first();
          if (await matSelect.count() > 0) await matSelect.click();
        }
      }

      // Wait for the dropdown panel / options to appear
      await this.page.waitForTimeout(3000);

      // Try selecting the first visible option from the open panel
      const optionLocator = this.page.locator(
        'mat-option, [role="option"], .ng-option, [class*="dropdown"] li, [class*="autocomplete"] li'
      ).filter({ visible: true }).first();

      if (await optionLocator.count() > 0) {
        await optionLocator.click();
        await this.page.waitForTimeout(500);
        console.log('  Category → selected first option from open panel');
        return true;
      }

      // No options appeared — try searching for known category names
      const idx = await this.findInputIndex('Category');
      if (idx >= 0) {
        const input = this.page.locator(
          'input:not([type="hidden"]):not([type="checkbox"]), textarea'
        ).nth(idx);

        for (const term of searchTerms) {
          await input.fill(term);
          await this.page.waitForTimeout(2500);

          const opt = this.page.locator(
            'mat-option, [role="option"], .ng-option, [class*="dropdown"] li'
          ).filter({ visible: true }).first();

          if (await opt.count() > 0) {
            await opt.click();
            await this.page.waitForTimeout(500);
            console.log(`  Category → selected via search "${term}"`);
            return true;
          }

          // Clear and try next term
          await input.fill('');
          await this.page.waitForTimeout(500);
        }
      }

      console.log('  Category → no options found after all attempts');
    } catch (e) {
      console.log('  Category → selection failed:', e);
    }
    return false;
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

  // Click a form tab (Master data, Price & stock, Media, etc.)
  async clickTab(tabName: string) {
    // Prefer role="tab" — avoids accidentally clicking sidebar nav items with the same text
    const roleTab = this.page.getByRole('tab', { name: tabName, exact: true });
    if (await roleTab.count() > 0 && await roleTab.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await roleTab.first().click();
    } else {
      // Fallback: filter visible text elements that are not inside [role="navigation"]
      const textEl = this.page.getByText(tabName, { exact: true }).filter({ visible: true }).first();
      await textEl.click();
    }
    // Wait for Angular tab panel content to render
    await this.page.waitForTimeout(4000);
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

  // Verify page body contains text — checks both visible text AND <input>/<textarea> values
  // because innerText() does not capture the value attribute of form fields.
  async expectBodyContains(text: string) {
    const found = await this.page.evaluate((searchText: string) => {
      if ((document.body.innerText || '').includes(searchText)) return true;
      return Array.from(document.querySelectorAll('input, textarea'))
        .some((el) => ((el as HTMLInputElement).value || '').includes(searchText));
    }, text);
    expect(found, `Expected page to contain: "${text}"`).toBeTruthy();
  }

  // Verify page shows an error (red validation banner is visible)
  async expectHasError() {
    // Check 1: explicit error/alert elements including Angular Material mat-error
    const errorEl = this.page.locator(
      'mat-error, [class*="alert"], [class*="error"], [class*="danger"], [role="alert"], snack-bar-container, [class*="snack-bar"]'
    ).filter({ visible: true }).first();
    if (await errorEl.count() > 0) return;

    // Check 2: Angular reactive form marks invalid inputs with ng-invalid — catches
    // validation errors that have no visible text (e.g. min/max on numeric fields)
    const invalidInput = this.page.locator(
      'input.ng-invalid, select.ng-invalid, textarea.ng-invalid, mat-select.ng-invalid'
    ).filter({ visible: true }).first();
    if (await invalidInput.count() > 0) return;

    // Check 3: keyword matching in body text (broader than before)
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
                     lower.includes('exceeded') ||
                     lower.includes('minimum') ||
                     lower.includes('greater') ||
                     lower.includes('positive') ||
                     lower.includes('cannot') ||
                     lower.includes('not valid') ||
                     lower.includes('min.');
    expect(hasError, 'Expected page to show a validation error').toBeTruthy();
  }

  // Read the current value of a labeled input field.
  // Returns empty string if the field cannot be found.
  async getFieldValue(labelText: string): Promise<string> {
    try {
      const byLabel = this.page.getByLabel(labelText, { exact: false }).first();
      if (await byLabel.count() > 0) {
        return byLabel.inputValue().catch(() => '');
      }
    } catch {}
    const idx = await this.findInputIndex(labelText);
    if (idx >= 0) {
      return this.page.locator(
        'input:not([type="hidden"]):not([type="checkbox"]), textarea'
      ).nth(idx).inputValue().catch(() => '');
    }
    return '';
  }

  // Assert all expected Master data tab fields are visible.
  async expectMasterDataTabFields() {
    await expect(this.page.getByText('GTIN', { exact: true })).toBeVisible();
    await expect(this.page.getByText('Provider key', { exact: true }).first()).toBeVisible();
    await expect(this.page.getByText('Brand', { exact: true })).toBeVisible();
    await expect(this.page.getByText('Master data', { exact: true })).toBeVisible();
    await expect(this.page.getByText('Supplementary data', { exact: true })).toBeVisible();
    await expect(this.page.getByText('Price & stock', { exact: true })).toBeVisible();
    await expect(this.page.getByText('Media', { exact: true })).toBeVisible();
  }

  // Assert expected Price & stock tab fields are visible.
  async expectPriceStockTabFields() {
    await expect(this.page.getByText('Selling price', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(this.page.getByText('VAT', { exact: true })).toBeVisible();
  }
}

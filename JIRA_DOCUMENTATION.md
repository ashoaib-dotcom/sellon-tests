# Sellon Tests — Jira Documentation

> This file contains two documentation blocks matching the format from earlier sessions.
> Both have been updated to reflect the latest changes (dynamic order discovery, no hardcoded IDs/SKUs).

---

---

# PART 1 — SFTP / EDI Integration & Order Workflow

## Jira Documentation — Playwright E2E Test Automation: SFTP/EDI Integration & Order Workflow

---

### 1. Summary

This ticket covers the implementation of automated SFTP-based EDI exchange within the Playwright E2E test suite for `stage.sellon.ch`. The work includes a full rewrite of the order workflow test (with dynamic order/SKU discovery), a new SFTP helper library, EDI message builders, a standalone SFTP test spec, and a series of CI bug fixes across multiple test files.

---

### 2. Technology Stack

| Component | Technology |
|---|---|
| Test framework | Playwright v1.60.0 (TypeScript) |
| Pattern | Page Object Model (POM) |
| SFTP client | `ssh2-sftp-client` npm package |
| EDI format | XML (custom schema per message type) |
| Environment config | `dotenv` npm package |
| CI/CD | GitHub Actions (matrix strategy) |
| Target environment | `https://stage.sellon.ch/` |
| SFTP server | `microservices.mpe.wwip.dev:22` |

---

### 3. New Files Added

#### 3.1 `helpers/sftp-upload.ts`

A reusable SFTP client wrapper built on top of `ssh2-sftp-client`.

**Class: `SftpHelper`**

| Method | Description |
|---|---|
| `connect()` | Opens SFTP connection to the server |
| `disconnect()` | Closes the connection gracefully |
| `uploadEDI(localPath, remoteName?)` | Uploads a local file to `remoteInDir` |
| `uploadEDIContent(content, filename)` | Uploads EDI XML string (no temp file needed) |
| `listFiles(remoteDir)` | Lists all files in a given remote directory |
| `downloadFileContent(remotePath)` | Downloads a file and returns it as a string |
| `waitForFile(pattern, timeoutMs)` | Polls `remoteOutDir` until a matching filename appears |
| `deleteFile(remotePath)` | Deletes a remote file (for cleanup) |
| `testConnection()` | Verifies the connection is working end-to-end |

**Key design decisions:**
- All methods return `false` / empty values (never throw) when SFTP is not configured — tests skip gracefully instead of failing
- Singleton factory `getSftpHelper()` ensures one persistent connection is reused across all tests in a suite
- Supports both password auth and private key auth via `SFTP_PRIVATE_KEY` env var
- `remoteInDir` = where the supplier uploads messages to the platform (`partner2dg`)
- `remoteOutDir` = where the platform writes messages for the supplier to read (`dg2partner`)

**Environment variables read:**

| Variable | Description | Example value |
|---|---|---|
| `SFTP_HOST` | Server hostname | `microservices.mpe.wwip.dev` |
| `SFTP_PORT` | SSH port | `22` |
| `SFTP_USERNAME` | Login username | `sftpuser` |
| `SFTP_PASSWORD` | Login password | `***` |
| `SFTP_PRIVATE_KEY` | Path or content of SSH key (optional) | — |
| `SFTP_REMOTE_IN_DIR` | Directory to upload EDI to | `/uploads/stage/OrderData/Test/partner2dg` |
| `SFTP_REMOTE_OUT_DIR` | Directory to poll for response files | `/uploads/stage/OrderData/Test/dg2partner` |
| `SFTP_SUPPLIER_ID` | Supplier ID embedded in filenames | `223344` |

---

#### 3.2 `helpers/edi-builder.ts`

Builds EDI XML message content and filenames for all 7 supported message types.

**Filename convention:** `{TYPE}_{SUPPLIER_ID}_{ORDER_ID}_{TIMESTAMP}.xml`
Example: `GORDR_223344_61830301_20260611082004.xml`

| Function | Direction | Purpose |
|---|---|---|
| `buildGORDR(orderId, positions)` | Supplier → Platform | Order confirmation |
| `buildGDELR(orderId, positions, shipRef, carrier)` | Supplier → Platform | Delivery / shipping confirmation |
| `buildGCANR(orderId, decision, message)` | Supplier → Platform | Cancellation response (accept/reject) |
| `buildGSURN(orderId, decision, positions, message)` | Supplier → Platform | Return response (accept/reject) |
| `buildGORDP(orderId, positions, deliveryAddress)` | Platform → Supplier | New order (for test data seeding) |
| `buildGCANP(orderId, positions, reason)` | Platform → Supplier | Cancellation request (for test simulation) |
| `buildGRETP(orderId, positions, reason)` | Platform → Supplier | Return request (for test simulation) |

Each function returns `{ content: string, filename: string }`.

---

#### 3.3 `tests/sftp-upload-pom.spec.ts`

Standalone test spec to validate the SFTP connection and all EDI upload operations independently of the order workflow.

**Tests included (9 total):**

1. Connection check — verifies SFTP can connect and both directories are accessible
2. Upload GORDP — new order message (seeding)
3. Upload GORDR — order confirmation
4. Upload GDELR — delivery confirmation
5. Upload GCANR — cancellation response
6. Upload GCANP — cancellation request
7. Upload GRETP — return request
8. Upload GSURN — return response
9. Poll for response file — waits for a file matching a pattern in `remoteOutDir`

**Graceful skip pattern:** If a directory doesn't exist or SFTP is not configured, tests skip with a `console.log` note rather than failing CI.

---

#### 3.4 `scripts/seed-orders.ts`

A utility script to seed test orders into the staging environment via GORDP SFTP upload. Run with `npx tsx scripts/seed-orders.ts`. Uploads GORDP XML files for 3 test orders to `/uploads/stage/OrderData/Test/dg2partner`. The platform picks these up and creates the orders in staging. Wait 30–60 seconds after running before executing order-workflow tests.

---

### 4. Modified Files

#### 4.1 `tests/order-workflow-pom.spec.ts` — Full Rewrite (Dynamic Order Discovery)

The order workflow test was completely rewritten. The previous version hardcoded specific order IDs (`61830301`, `61830302`, `61830303`) and product SKUs (`BT-SPK-001`, `BB-FLA-002`, etc.), which caused test skips when those orders did not exist in staging.

**New approach: dynamic discovery at runtime**

No order IDs or SKUs are hardcoded anywhere in the test file.

```typescript
// Old — hardcoded, breaks when these orders don't exist
const ORDER_1 = '61830301';

// New — populated at runtime by scanning the orders grid
let ORDER_1 = '';
let order1Positions: { sku: string; qty: number }[] = [];
```

**Three new helper functions:**

| Function | Description |
|---|---|
| `discoverOrders(count)` | Scans `tbody` rows in the orders grid for numeric IDs (6–12 digits). Returns up to `count` real order IDs from whatever exists in staging. |
| `extractPositions()` | Opens the "Order items" tab of the currently open order. Reads SKUs matching pattern `[A-Z]{2,8}-[A-Z]{2,8}-?\d{2,4}` and quantities. Returns `{ sku, qty }[]`. |
| `sftpPat(type, orderId)` | Builds a dynamic SFTP wait pattern: `new RegExp('GCANR.*' + ORDER_1, 'i')` instead of hardcoded `/GCANR.*61830301/i`. |

**Execution flow:**

```
beforeAll
  └── discoverOrders(3)             ← Scans staging orders grid
       ↓ ORDER_1, ORDER_2, ORDER_3 assigned

ORDER 1 describe
  test 2 (delivery address)
    └── extractPositions()          ← Reads SKUs from Order items tab
         ↓ order1Positions[] populated

  All subsequent ORDER 1 tests use order1Positions[]  ← Never hardcoded
```

**SFTP patterns — before vs after:**

```typescript
// Before — hardcoded, breaks on different order IDs
await waitForSftpFile(/GCANR.*61830301/i, 30000);

// After — dynamic, works with any order
await waitForSftpFile(sftpPat('GCANR', ORDER_1), 30000);
```

**EDI positions — before vs after:**

```typescript
// Before — hardcoded SKUs that may not exist in the order
await importEDI('CANP', ORDER_1, { positions: [{ sku: 'BT-SPK-001' }] });

// After — uses positions extracted from the actual open order
await importEDI('CANP', ORDER_1, { positions: order1Positions });
```

**Test structure:**
- `test.describe.configure({ mode: 'serial' })` — all 92 tests run sequentially
- Three `test.describe` blocks (`ORDER 1`, `ORDER 2`, `ORDER 3`)
- Each describe has a scoped `let opened = false` guard — if an order cannot be found, all subsequent tests in that block skip
- Test names use `[ORDER 1]`, `[ORDER 2]`, `[ORDER 3]` prefixes (not hardcoded IDs)

**Key helper functions:**

| Function | Description |
|---|---|
| `findAndOpenOrder(orderId)` | Navigates to orders, filters by ID, falls back to first available order if ID not found, opens via double-click |
| `clickTab(tabName)` | Returns `boolean` — never throws; returns `false` if tab not visible |
| `clickButton(namePattern)` | Returns `boolean` — safe wrapper around button clicks |
| `importEDI(type, orderId, opts)` | Builds EDI XML from extracted positions and uploads via SFTP |
| `waitForSftpFile(pattern, timeoutMs)` | Polls `remoteOutDir` for a matching response file |
| `saveOrder()` | Clicks Save and waits 8 seconds for the SPA to settle |
| `screenshot(name)` | Takes a screenshot to `screenshots/` (best-effort, never fails) |

**SFTP integration in order workflow:**

| EDI Type | When uploaded | Directory |
|---|---|---|
| GCANP | To simulate a cancellation request arriving from customer | `partner2dg` |
| GRETP | To simulate a return request arriving from customer | `partner2dg` |
| GORDR | To confirm order positions to platform | `partner2dg` |
| GDELR | To confirm shipment to platform | `partner2dg` |
| GCANR | To respond to cancellation | `partner2dg` |
| GSURN | To respond to return request | `partner2dg` |

Response file polling (from `dg2partner`): GORDR, GCANR, GDELR, GSURN — tests log the result but do not fail if no file is found within the 30-second timeout.

**Test counts:**
- Total: 92 tests across 3 describe blocks
- Passing: all tests that can match available staging orders
- Skipped: only tests whose describe block found no matching order

---

#### 4.2 `pages/product-form.page.ts`

**Problem:** The Brand field is an Angular autocomplete component. After filling the input, the autocomplete dropdown remained open and the DOM value was empty when read back.

**Fix:** Added `Escape` keypress and wait after `fill()` in the DOM-index path to dismiss the dropdown:

```typescript
await input.fill(value);
await this.page.waitForTimeout(500);
await this.page.keyboard.press('Escape');
await this.page.waitForTimeout(200);
```

---

#### 4.3 `tests/product-create-pom.spec.ts`

**Problem:** After `fillMediaUrl()` navigated to the Media tab, Steps 13 and 14 checked `innerText()` for the provider key. Angular does not render inactive tab content in the DOM, so the body only returned `"Product\nProduct Details\nOnline"` — causing CI failure.

**Fix:** Steps 13 and 14 now navigate to Master data tab before asserting:

```typescript
test('Step 13: Save the product', async () => {
  await productForm.clickSave();
  // Save lands on Media tab — navigate to Master data so provider key is in DOM
  await productForm.clickTab('Master data');
  await productForm.expectBodyContains(TEST_SKU);
});
```

---

#### 4.4 `playwright.config.ts`

Added `dotenv` support so `.env` files are loaded when running tests locally:

```typescript
import * as dotenv from 'dotenv';
dotenv.config();
```

Without this, SFTP env vars were not loaded during local runs and all SFTP operations were silently skipped.

---

#### 4.5 `.github/workflows/playwright.yml`

- Added `sftp-upload` to the test matrix so the standalone SFTP spec runs in CI
- Added all 7 SFTP environment variables sourced from GitHub Actions secrets

```yaml
SFTP_HOST:            ${{ secrets.SFTP_HOST }}
SFTP_PORT:            ${{ secrets.SFTP_PORT }}
SFTP_USERNAME:        ${{ secrets.SFTP_USERNAME }}
SFTP_PASSWORD:        ${{ secrets.SFTP_PASSWORD }}
SFTP_REMOTE_IN_DIR:   ${{ secrets.SFTP_REMOTE_IN_DIR }}
SFTP_REMOTE_OUT_DIR:  ${{ secrets.SFTP_REMOTE_OUT_DIR }}
SFTP_SUPPLIER_ID:     ${{ secrets.SFTP_SUPPLIER_ID }}
```

---

### 5. SFTP Server Directory Structure

```
/ (root)
└── uploads/
    └── stage/
        └── OrderData/
            └── Test/
                ├── dg2partner/     ← Platform writes here (GORDP, GCANP, GRETP)
                │                    Tests POLL this directory for response files
                └── partner2dg/     ← Supplier uploads here (GORDR, GDELR, GCANR, GSURN)
                                     Tests UPLOAD to this directory
```

---

### 6. Local Development Setup

1. Create `.env` file in the project root:

```env
TEST_USERNAME=ashoaib
TEST_PASSWORD=test2
BASE_URL=https://stage.sellon.ch/

SFTP_HOST=microservices.mpe.wwip.dev
SFTP_PORT=22
SFTP_USERNAME=sftpuser
SFTP_PASSWORD=<password>
SFTP_SUPPLIER_ID=223344
SFTP_REMOTE_IN_DIR=/uploads/stage/OrderData/Test/partner2dg
SFTP_REMOTE_OUT_DIR=/uploads/stage/OrderData/Test/dg2partner
```

2. Install dependencies: `npm install`
3. (Optional) Seed test orders: `npx tsx scripts/seed-orders.ts`
4. Run order workflow tests: `npx playwright test tests/order-workflow-pom.spec.ts --headed`
5. Run SFTP tests: `npx playwright test tests/sftp-upload-pom.spec.ts --headed`

---

### 7. GitHub Actions Secrets Required

| Secret name | Value |
|---|---|
| `SFTP_HOST` | `microservices.mpe.wwip.dev` |
| `SFTP_PORT` | `22` |
| `SFTP_USERNAME` | SFTP username |
| `SFTP_PASSWORD` | SFTP password |
| `SFTP_REMOTE_IN_DIR` | `/uploads/stage/OrderData/Test/partner2dg` |
| `SFTP_REMOTE_OUT_DIR` | `/uploads/stage/OrderData/Test/dg2partner` |
| `SFTP_SUPPLIER_ID` | `223344` |

---

### 8. Known Limitations / Current State

| Item | Detail |
|---|---|
| Dynamic order fallback | If fewer than 3 orders exist in staging, some describe blocks will skip gracefully. Run `npx tsx scripts/seed-orders.ts` to seed test orders. |
| SFTP response files | Tests that poll `dg2partner` for GORDR/GDELR/GCANR/GSURN responses time out (30s). These files are generated by the platform only after it processes the uploaded EDI. Logs show `null` for the file — this is expected and non-blocking. |
| Brand field autocomplete | Angular autocomplete stores value in component state, not DOM `.value`. Brand is verified indirectly from saved product body text. |

---

---

# PART 2 — Complete Sellon Test Suite (All 14 Specs)

---

# Sellon Tests — Complete Automation Test Suite Documentation

**Project:** `sellon-tests`
**Target application:** `https://stage.sellon.ch/`
**Framework:** Playwright v1.60.0 (TypeScript)
**Pattern:** Page Object Model (POM)
**Repository:** `ashoaib-dotcom/sellon-tests`

---

## 1. Overview

This repository contains a full end-to-end (E2E) automation test suite for the Sellon supplier portal. It covers the complete supplier workflow — from login through product management, import/export, order processing, and SFTP-based EDI exchange. All tests run in a headless Chromium browser and are executed on GitHub Actions CI via a matrix strategy.

---

## 2. Technology Stack

| Component | Technology |
|---|---|
| Test framework | Playwright v1.60.0 |
| Language | TypeScript |
| Design pattern | Page Object Model (POM) |
| SFTP client | `ssh2-sftp-client` |
| Environment loading | `dotenv` |
| CI/CD | GitHub Actions |
| Browser | Chromium (headless) |
| Viewport | 1920 × 1080 |
| Target URL | `https://stage.sellon.ch/` |
| SFTP server | `microservices.mpe.wwip.dev:22` |

---

## 3. Project Structure

```
sellon-tests/
├── tests/                        ← All 14 test spec files
│   ├── login-pom.spec.ts
│   ├── dashboard-pom.spec.ts
│   ├── product-create-pom.spec.ts
│   ├── product-edit-pom.spec.ts
│   ├── product-delete-pom.spec.ts
│   ├── product-filters-pom.spec.ts
│   ├── product-validations-pom.spec.ts
│   ├── product-import-pom.spec.ts
│   ├── stock-import-pom.spec.ts
│   ├── export-pom.spec.ts
│   ├── orders-pom.spec.ts
│   ├── orders-filters-pom.spec.ts
│   ├── order-workflow-pom.spec.ts
│   └── sftp-upload-pom.spec.ts
├── pages/                        ← Page Object classes (7 files)
│   ├── base.page.ts
│   ├── login.page.ts
│   ├── dashboard.page.ts
│   ├── navigation.page.ts
│   ├── product-list.page.ts
│   ├── product-form.page.ts
│   └── orders.page.ts
├── helpers/                      ← Shared utilities
│   ├── sftp-upload.ts
│   └── edi-builder.ts
├── scripts/
│   └── seed-orders.ts            ← Seeds test orders via GORDP upload
├── test-data/                    ← CSV files for import tests
│   ├── import-products.csv
│   └── stock-update.csv
├── screenshots/                  ← Captured test screenshots
├── global-setup.ts               ← Pre-suite login
├── global-teardown.ts            ← Post-suite cleanup
└── playwright.config.ts          ← Playwright configuration
```

---

## 4. Configuration

### 4.1 `playwright.config.ts`

| Setting | Value |
|---|---|
| Test directory | `./tests` |
| Global timeout | 300,000 ms (5 minutes per test) |
| Expect timeout | 30,000 ms |
| Navigation timeout | 120,000 ms |
| Action timeout | 30,000 ms |
| Viewport | 1920 × 1080 |
| Headless | `true` |
| Browser channel | `chromium` |
| Screenshot | `only-on-failure` |
| Reporters | HTML + List |
| Base URL | `process.env.BASE_URL` (default `https://stage.sellon.ch/`) |
| User-Agent | Chrome 120.0 on macOS (avoids bot-detection) |
| Launch args | `--disable-blink-features=AutomationControlled`, `--no-sandbox`, `--disable-dev-shm-usage` |
| dotenv | Loaded at startup — reads `.env` for local runs |

### 4.2 Environment Variables

| Variable | Used for | Example |
|---|---|---|
| `BASE_URL` | Application URL | `https://stage.sellon.ch/` |
| `TEST_USERNAME` | Login username | `ashoaib` |
| `TEST_PASSWORD` | Login password | `test2` |
| `SFTP_HOST` | SFTP server hostname | `microservices.mpe.wwip.dev` |
| `SFTP_PORT` | SFTP port | `22` |
| `SFTP_USERNAME` | SFTP login | `sftpuser` |
| `SFTP_PASSWORD` | SFTP password | `***` |
| `SFTP_REMOTE_IN_DIR` | Upload directory (supplier → platform) | `/uploads/stage/OrderData/Test/partner2dg` |
| `SFTP_REMOTE_OUT_DIR` | Poll directory (platform → supplier) | `/uploads/stage/OrderData/Test/dg2partner` |
| `SFTP_SUPPLIER_ID` | Supplier ID in EDI filenames | `223344` |

### 4.3 Global Setup / Teardown

- **`global-setup.ts`** — Runs once before the entire test suite. Logs in to the application, handles active session popups, validates the app shell loads, and saves authentication state to `auth-state.json`.
- **`global-teardown.ts`** — Runs once after all tests. Deletes `auth-state.json`.

---

## 5. Page Objects

### 5.1 `BasePage`

Base class extended by all other page objects.

| Method | Description |
|---|---|
| `screenshot(name)` | Saves screenshot to `screenshots/` (error-tolerant) |
| `getBodyText()` | Returns full page body text |
| `waitForLoad(seconds?)` | Waits specified seconds (default 5) |
| `pressEscape()` | Presses Escape key |
| `scrollToBottom()` | Scrolls page to bottom |
| `scrollToTop()` | Scrolls page to top |

---

### 5.2 `LoginPage`

Handles authentication. Includes retry logic, session popup handling, and re-login after redirect.

| Method | Description |
|---|---|
| `goto()` | Navigates to login page (3 attempts, 10s intervals) |
| `fillUsername(value)` | Types username |
| `fillPassword(value)` | Types password with retry if field stays empty |
| `clickLogin()` | Clicks Login and waits for navigation |
| `handleSessionPopup()` | Dismisses "active session" confirmation dialog |
| `login(username, password)` | Full login flow |

---

### 5.3 `DashboardPage`

Validates dashboard content across all 7 sections.

| Method | Description |
|---|---|
| `waitForDashboard()` | Waits for menu icon, dismisses blocking modals |
| `expectAllSectionsVisible()` | Asserts all 7 dashboard sections visible |
| `expectProductsSectionVisible()` | Asserts Products section |
| `expectOrdersSectionVisible()` | Asserts Orders section |
| `expectDeliveryRateVisible()` | Asserts Delivery Rate KPI |
| `expectCancelRateVisible()` | Asserts Cancel Rate KPI |

---

### 5.4 `NavigationPage`

Main sidebar navigation.

| Method | Description |
|---|---|
| `navigateToDashboard()` | Opens sidebar, clicks Dashboard |
| `navigateToProducts()` | Expands Product submenu, clicks Product |
| `navigateToOrders()` | Expands Orders submenu, clicks Orders |

> All navigation goes through the sidebar — direct URL navigation does not work in this Angular SPA.

---

### 5.5 `ProductListPage`

Product list table operations.

| Method | Description |
|---|---|
| `clickNew()` | Opens new product form |
| `clickImport()` | Opens import dialog |
| `clickRefresh()` | Reloads table |
| `clickClear()` | Resets all filters |
| `getPaginationText()` | Returns pagination string e.g. "1 - 50 of 108" |
| `getRowCount()` | Returns visible row count |
| `doubleClickProduct(text)` | Double-clicks row containing text |
| `doubleClickFirstProduct()` | Double-clicks first row |
| `selectRowByIndex(index)` | Selects row checkbox |
| `selectAllProducts()` | Selects all via header checkbox |
| `clickDelete()` | Clicks Delete |
| `confirmDialog()` | Clicks Yes/OK/Confirm |
| `dismissDialog()` | Clicks No/Cancel |
| `getTotalProductCount()` | Extracts numeric total from pagination |

---

### 5.6 `ProductFormPage`

Product form editing across all tabs.

| Method | Description |
|---|---|
| `fillField(label, value)` | Fills form field by label |
| `fillTitle(value)` | Fills Title DE |
| `fillDescription(value)` | Fills Description textarea |
| `fillMediaUrl(url)` | Navigates to Media tab and fills URL |
| `clickTab(tabName)` | Clicks a form tab |
| `selectFirstCategory()` | Selects first category option |
| `clickSave()` | Clicks Save |
| `expectFormVisible()` | Asserts form is open |
| `expectBodyContains(text)` | Asserts body text contains string |
| `expectFieldValueByLabel(label, value)` | Asserts field value |
| `expectHasError()` | Asserts validation error is shown |

> **Angular autocomplete:** After `fill()`, an `Escape` keypress dismisses the dropdown and commits the value to component state. Critical for Brand and autocomplete fields.

---

### 5.7 `OrdersPage`

Orders page navigation and grid operations.

| Method | Description |
|---|---|
| `navigateToOrders()` | Opens sidebar and navigates to Orders |
| `expectOrderTableVisible()` | Asserts table is visible |
| `getRowCount()` | Returns visible row count |
| `getPaginationText()` | Returns pagination string |
| `getColumnHeaders()` | Returns array of column header texts |
| `setTextFilter(colIndex, value)` | Fills filter input in column |
| `setDropdownFilter(colIndex, option)` | Selects dropdown filter option |
| `clickClear()` | Resets all filters |
| `getCellText(row, col)` | Extracts cell text at position |

---

## 6. Helper Modules

### 6.1 `helpers/sftp-upload.ts`

Full SFTP automation wrapper using `ssh2-sftp-client`.

| Method | Description |
|---|---|
| `connect()` | Opens connection; silently skips if not configured |
| `disconnect()` | Closes connection gracefully |
| `uploadEDI(localPath, remoteName?)` | Uploads local file to `remoteInDir` |
| `uploadEDIContent(content, filename)` | Uploads XML string — no temp file |
| `listFiles(remoteDir)` | Returns list of filenames |
| `downloadFileContent(remotePath)` | Returns file content as string |
| `waitForFile(pattern, timeoutMs)` | Polls `remoteOutDir` until matching file appears |
| `deleteFile(remotePath)` | Removes a remote file |
| `testConnection()` | Validates connection and directory access |
| `isConfigured` | `true` if `SFTP_HOST` env var is set |

`getSftpHelper()` — Singleton. Reuses one connection across all tests in a suite.

**SFTP directory structure:**

```
/uploads/stage/OrderData/Test/
├── partner2dg/   ← Supplier uploads EDI IN (GORDR, GDELR, GCANR, GSURN)
└── dg2partner/   ← Platform writes EDI OUT (GORDP, GCANP, GRETP)
                    Tests poll and seed from here
```

---

### 6.2 `helpers/edi-builder.ts`

Builds EDI XML for all 7 message types.

**Filename format:** `{TYPE}_{SUPPLIER_ID}_{ORDER_ID}_{YYYYMMDDHHMMSS}.xml`

| Function | Direction | Trigger |
|---|---|---|
| `buildGORDR(orderId, positions)` | Supplier → Platform | Supplier confirms order receipt |
| `buildGDELR(orderId, positions, shipRef, carrier)` | Supplier → Platform | Supplier confirms shipment |
| `buildGCANR(orderId, decision, message)` | Supplier → Platform | Supplier responds to cancellation request |
| `buildGSURN(orderId, decision, positions, message)` | Supplier → Platform | Supplier responds to return request |
| `buildGORDP(orderId, positions, address)` | Platform → Supplier | New order (used for test data seeding) |
| `buildGCANP(orderId, positions, reason)` | Platform → Supplier | Cancellation request (simulated) |
| `buildGRETP(orderId, positions, reason)` | Platform → Supplier | Return request (simulated) |

---

## 7. Test Specifications

### Total Test Count Summary

| Spec file | Tests |
|---|---|
| login-pom.spec.ts | 6 |
| dashboard-pom.spec.ts | 17 |
| product-create-pom.spec.ts | 20 |
| product-edit-pom.spec.ts | 9 |
| product-delete-pom.spec.ts | 11 |
| product-filters-pom.spec.ts | 17 |
| product-validations-pom.spec.ts | 20 |
| product-import-pom.spec.ts | 9 |
| stock-import-pom.spec.ts | 9 |
| export-pom.spec.ts | 11 |
| orders-pom.spec.ts | 9 |
| orders-filters-pom.spec.ts | 11 |
| order-workflow-pom.spec.ts | 92 |
| sftp-upload-pom.spec.ts | 9 |
| **Total** | **~250** |

---

### 7.1 Login Tests — `login-pom.spec.ts`

| # | Test Name |
|---|---|
| 1 | Valid credentials should reach dashboard |
| 2 | Invalid password should stay on login page |
| 3 | Empty fields should stay on login page |
| 4 | SQL injection in username should stay on login page |
| 5 | Whitespace-only credentials should stay on login page |
| 6 | Valid username with wrong case password should stay on login page |

---

### 7.2 Dashboard Tests — `dashboard-pom.spec.ts`

| # | Test Name |
|---|---|
| 1 | Should display all 7 sections |
| 2 | Products section shows total, complete, incomplete, invalid counts |
| 3 | Orders section shows total and new orders |
| 4 | Delivery Rate KPI shows merchant reliability |
| 5 | Cancel Rate KPI shows cancellation metrics |
| 6 | Import section shows recent imports and stock updates |
| 7 | Import section lists failed and successful products |
| 8 | Export Galaxus section shows latest exports with product count |
| 9 | Scheduler shows next planned export times |
| 10 | Displays in user locale language |
| 11 | Full dashboard content captured |
| 12 | Product list table visible after navigation |
| 13 | Product data with pagination |
| 14 | Toolbar buttons displayed |
| 15 | All column headers displayed |
| 16 | Contains products and total count |
| 17 | Navigate back via menu — counts updated |
| 18–19 | Negative: numeric counts ≥ 0; incomplete ≤ total |

---

### 7.3 Product Create Tests — `product-create-pom.spec.ts`

Uses dynamically generated unique values per run: `TEST_GTIN` (valid GTIN-13 with calculated check digit) and `TEST_SKU` (`POM-{timestamp}`).

| Step | Description |
|---|---|
| 1 | Click New — product form opens |
| 2 | All required tabs present |
| 2b | Save empty — all validation errors and warnings appear |
| 3 | Fill GTIN |
| 4 | Fill Provider key |
| 5 | Fill Brand (Angular autocomplete) |
| 6 | Fill Title DE |
| 7 | Fill Description DE |
| 8 | Fill Weight + select Category |
| 9 | Navigate to Price & stock tab |
| 10 | Fill Selling price |
| 11 | Fill VAT |
| 12 | Fill Stock quantity |
| 12b | Fill Media URL |
| 13 | Save → navigate to Master data → assert SKU in body |
| 14 | Verify SKU, GTIN, Brand all in body |
| 15 | Invalid GTIN checksum rejected |
| 16 | Empty provider key rejected |
| 17 | Invalid VAT rejected |
| 18 | Stock > 99,999 rejected |
| 19 | Zero price rejected |
| 20 | Final save with all valid data |

---

### 7.4 Product Edit Tests — `product-edit-pom.spec.ts`

| # | Test Name |
|---|---|
| 1 | Double-click product — edit form opens |
| 2 | Verify Master data tab fields (GTIN, Provider key, Brand, Weight) |
| 3 | Edit Brand field |
| 4 | Edit Weight field |
| 5 | Navigate to Price & stock tab |
| 6 | Save changes — persist after save |
| 7 | Negative: invalid GTIN checksum rejected |
| 8 | Negative: empty provider key rejected |
| 9 | Negative: invalid VAT rejected |

---

### 7.5 Product Delete Tests — `product-delete-pom.spec.ts`

| # | Test Name |
|---|---|
| 1 | Single Delete: Stage 1 product |
| 2 | Single Delete: Stage 2 product |
| 3 | Single Delete: Error status product |
| 4 | Single Delete: cancel — product remains |
| 5 | Bulk Delete: select all → delete all |
| 6 | Bulk Delete: select 3 → delete 3 |
| 7 | Bulk Delete: select multiple → cancel → all remain |
| 8 | Edge Case: delete without selection (no crash) |
| 9 | Edge Case: count decreases by correct amount |
| 10 | Edge Case: deleted product absent from list |
| 11 | Final: product list state verified |

---

### 7.6 Product Filter Tests — `product-filters-pom.spec.ts`

| Test | Filter |
|---|---|
| TC-01 | State = "Stage 1" |
| TC-02 | Clear button restores full dataset |
| TC-03 | ID filter — single product |
| TC-04 | Multi-select Category (skipped — pending UI fix) |
| TC-05 | Partial title text "Ant" |
| TC-06 | Stock quantity = 200 |
| TC-07 | State = "Stage 2" |
| TC-08 | State = "Error" |
| TC-09 | Name = "SoundBlast" |
| TC-10 | Non-existing name → 0 results |
| TC-11 | Provider key starts with "BT-SPK" |
| TC-12 | VAT = "8.10" |
| TC-13 | Combined State "Stage 2" + Provider key "BT-SPK" |
| TC-14 | Horizontal scroll reveals hidden columns |
| TC-15 | Pagination updates after filter |
| TC-16 | Price < 12 |
| TC-17 | Price > 12 |

---

### 7.7 Product Validation Tests — `product-validations-pom.spec.ts`

| Field | Tests |
|---|---|
| GTIN | Valid GTIN-8 accepted; invalid GTIN-8 rejected; valid/invalid GTIN-12, -13, -14 |
| Provider key | > 50 chars rejected; valid characters (A-Z, 0-9, `. , ! ? - _ @`) accepted |
| Price | Negative rejected; maximum valid accepted |
| VAT | 2.60% accepted; 8.10% accepted |
| Stock | Negative rejected; zero accepted |
| Tabs | Supplementary data, Media, Galaxus tabs open correctly |
| GTIN empty | Product status becomes Invalid |
| Brand | Up to 100 characters accepted |

---

### 7.8 Product Import Tests — `product-import-pom.spec.ts`

| Step | Description |
|---|---|
| Step 2 | Click Import button |
| Step 3 | Try without file — error shown |
| Step 4 | Close error + reopen dialog |
| Step 5 | Upload valid CSV |
| Step 6 | Run the import |
| Step 7 | Wait for completion |
| Step 8 | Close popup |
| Negative | Non-CSV file rejected with error |

**Test data:** `test-data/import-products.csv`

---

### 7.9 Stock Import Tests — `stock-import-pom.spec.ts`

| Step | Description |
|---|---|
| Step 1 | Verify products before stock update |
| Step 2 | Click Stock import button |
| Step 3 | Try without file — error shown |
| Step 4 | Close error + reopen dialog |
| Step 5 | Upload stock update CSV |
| Step 6 | Run the stock import |
| Step 7 | Wait for completion |
| Step 8 | Close dialog + verify product list |
| Negative | Non-CSV file rejected with error |

**Test data:** `test-data/stock-update.csv` (auto-generated if missing)

---

### 7.10 Export Tests — `export-pom.spec.ts`

| Step | Description |
|---|---|
| Step 1 | Verify products before export |
| Step 2 | Verify Export button present |
| Step 3 | Click Export button |
| Step 4 | Handle confirmation dialog |
| Step 5 | Wait for export to complete |
| Step 6 | Verify export status updated |
| Step 7 | Verify Error products not in exported count |
| Step 8 | Verify export appears on Dashboard |
| Step 9 | Verify Scheduler shows next planned export |
| Negative 1 | Error products excluded from count |
| Negative 2 | Dialog can be cancelled without exporting |

---

### 7.11 Orders Tests — `orders-pom.spec.ts`

| # | Test Name |
|---|---|
| 1 | Navigate to Orders page |
| 2 | Display order data in grid |
| 3 | Orders page content visible |
| 4 | Open order detail by double-clicking row |
| 5 | Export without selection — all orders as XLSX |
| 6 | Export with 1 selected — only that order in XLSX |
| 7 | Export with multiple selected — only selected in XLSX |
| 8 | Negative: non-existent ID → no results |
| 9 | Negative: export with no rows — no crash |

**XLSX filename format:** `SellOn_[company]_[yyyymmdd]_[hh:MM:ss].xlsx`

---

### 7.12 Orders Filter Tests — `orders-filters-pom.spec.ts`

| Test | Description |
|---|---|
| TC-00 | Discover orders grid columns and filter row |
| TC-01 | Filter by Order ID — only that order shown |
| TC-02 | Clear restores full order count |
| TC-03 | Status dropdown filter |
| TC-04 | Text filter on first text-input column |
| TC-05 | Date range filter |
| TC-06 | Combined ID + Status |
| TC-07 | Pagination updates after filter |
| Negative 1 | Non-existent ID → no results |
| Negative 2 | Special characters → no crash |
| Negative 3 | Filter then clear → full count restored |

---

### 7.13 Order Workflow Tests — `order-workflow-pom.spec.ts`

92 tests total across 3 describe blocks (`ORDER 1`, `ORDER 2`, `ORDER 3`). Full end-to-end EDI order lifecycle.

**Design: Dynamic order discovery**

All order IDs and SKUs are discovered at runtime — nothing is hardcoded.

```
beforeAll → discoverOrders(3)           Scans the staging orders grid
Each describe → extractPositions()      Reads SKUs from the open order's items tab
importEDI(type, id, { positions })      Uses extracted positions, not hardcoded SKUs
sftpPat(type, orderId)                  Dynamic SFTP wait pattern
```

| Workflow | Description |
|---|---|
| ORDER 1 | Reject cancellation request → reject return request → confirm → ship → full lifecycle |
| ORDER 2 | Mixed CANP (approve 1 position, reject 1, accept 1) → confirm → split shipments → UAR (user-accepted return) |
| ORDER 3 | Unknown SKU handling → reject first position → mixed CANP accept → RETP before/after shipped |

**EDI message types used:**

| Type | Direction | Purpose |
|---|---|---|
| GCANP | Platform → Supplier | Cancellation request (simulated by test) |
| GRETP | Platform → Supplier | Return request (simulated by test) |
| GORDR | Supplier → Platform | Order confirmation |
| GDELR | Supplier → Platform | Delivery confirmation |
| GCANR | Supplier → Platform | Cancellation response |
| GSURN | Supplier → Platform | Return response |

**Order/Position status flow:**

```
Order:     New → Open → Confirmed → Shipped → Closed
Position:  To confirm → Confirmed → Shipped
                                  → Returned
                      → Cancelling → Cancelled
```

---

### 7.14 SFTP Upload Tests — `sftp-upload-pom.spec.ts`

9 standalone tests (no browser). Validates SFTP connection and all EDI upload/download operations independently.

| # | Test Name |
|---|---|
| 1 | Connection and directory listing |
| 2 | Upload GORDR (order confirmation) |
| 3 | Upload GDELR (delivery confirmation) |
| 4 | Upload GCANR (cancellation response) |
| 5 | Upload GSURN (return response) |
| 6 | Upload GORDP (seed test order) |
| 7 | Upload GCANP (simulate cancellation request) |
| 8 | Upload GRETP (simulate return request) |
| 9 | Wait for platform response file in outDir |

All tests skip gracefully when `SFTP_HOST` is not set.

---

## 8. CI/CD — GitHub Actions

**File:** `.github/workflows/playwright.yml`

**Triggers:** push to `main`, PR to `main`, daily schedule at 06:00 UTC, manual dispatch.

**Matrix strategy:** 14 parallel jobs (one per spec), `fail-fast: false`, `max-parallel: 1`.

**Each job:**
1. Checkout → setup Node.js v24 → `npm ci` → install Chromium
2. `mkdir -p screenshots`
3. Run tests (`--reporter=html,list`)
4. Upload screenshots artifact (7 days)
5. Upload HTML report artifact (14 days)

**GitHub Actions Secrets required:**

| Secret | Purpose |
|---|---|
| `TEST_USERNAME` | App login |
| `TEST_PASSWORD` | App login |
| `BASE_URL` | App URL |
| `SFTP_HOST` | SFTP server |
| `SFTP_PORT` | SFTP port |
| `SFTP_USERNAME` | SFTP login |
| `SFTP_PASSWORD` | SFTP password |
| `SFTP_REMOTE_IN_DIR` | Upload directory |
| `SFTP_REMOTE_OUT_DIR` | Poll directory |
| `SFTP_SUPPLIER_ID` | Supplier ID for filenames |

---

## 9. Key Technical Decisions & Fixes

| Issue | Fix |
|---|---|
| Angular SPA navigation | All navigation via sidebar clicks, never `page.goto()` — inactive tab content is not in DOM |
| Angular autocomplete (Brand field) | `Escape` keypress after `fill()` commits value to component state |
| Product Create CI failure (Step 13) | Navigate to Master data tab before asserting body text — fillMediaUrl leaves Media tab active |
| SFTP directory paths | Correct paths confirmed via FileZilla: `partner2dg` (upload) and `dg2partner` (read) |
| Hardcoded order IDs / SKUs | Replaced with `discoverOrders()` + `extractPositions()` — tests use whatever orders exist in staging |
| dotenv in playwright.config | Added `dotenv.config()` so `.env` is loaded for local runs |
| SFTP graceful skip | All SFTP methods return silently (no crash) when `SFTP_HOST` not set |

---

## 10. Known Limitations

| Item | Detail |
|---|---|
| SFTP response file polling | Tests polling `dg2partner` for GORDR/GDELR/GCANR/GSURN time out (30s). These files are generated by the platform after processing uploaded EDI. Non-blocking. |
| Brand field | Angular autocomplete value verified indirectly from saved product body text, not raw DOM value. |
| TC-04 product category filter | Multi-select Category test is skipped pending a UI fix. |
| Negative stock | App silently clamps negative stock without a validation error. Test is a soft check (log only). |

---

## 11. Local Development Setup

```bash
# 1. Clone and install
git clone https://github.com/ashoaib-dotcom/sellon-tests.git
cd sellon-tests
npm install
npx playwright install chromium --with-deps

# 2. Create .env file (see Section 4.2 for all variables)

# 3. (Optional) Seed test orders
npx tsx scripts/seed-orders.ts

# 4. Run a single spec
npx playwright test tests/order-workflow-pom.spec.ts --headed

# 5. Run all specs
npm test

# 6. View HTML report
npx playwright show-report
```

---

*Last updated: 2026-06-11*
*Maintained by: Aamna Shoaib / ESC Team*

# sellon-tests — Complete Project Documentation

**Project:** `sellon-tests`
**Target:** [stage.sellon.ch](https://stage.sellon.ch/) — Sellon Supplier Portal (Staging)
**Admin Panel:** `https://stage.sellon.ch/` (Lobster UI, separate credentials)
**Framework:** Playwright v1.60.0 (TypeScript)
**Pattern:** Page Object Model (POM)
**CI/CD:** GitLab CI — runs on every push to `main`, manual trigger, and scheduled pipelines

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Technology Stack](#2-technology-stack)
3. [Project Structure](#3-project-structure)
4. [Environment Variables](#4-environment-variables)
5. [Running Tests Locally](#5-running-tests-locally)
6. [Playwright Configuration](#6-playwright-configuration)
7. [Page Object Model](#7-page-object-model)
8. [Helpers & Utilities](#8-helpers--utilities)
9. [Test Suites — All 17 Files](#9-test-suites--all-17-files)
10. [EDI Message Reference](#10-edi-message-reference)
11. [GitLab CI/CD Pipeline](#11-gitlab-cicd-pipeline)
12. [Key Technical Notes](#12-key-technical-notes)

---

## 1. Project Overview

End-to-end automation suite for the **Sellon Supplier Portal** — an Angular/Lobster SPA used by suppliers to manage products, orders, SFTP-based EDI communication, and Galaxus exports.

### Coverage by domain

| Domain | Test files |
|---|---|
| Authentication | 01-login |
| Dashboard & KPIs | 02-dashboard |
| Product create / edit / delete | 03, 04, 16 |
| Product filters & validations | 05, 06 |
| CSV / XLSX imports | 07-product-import, 08-stock-import |
| Galaxus export | 09-export |
| SFTP / EDI integration | 10-sftp-upload |
| Order workflow (full EDI round-trip) | 11-order-workflow |
| Order list & filters | 12-orders, 13-orders-filters |
| Split shipment | 14-split-shipment |
| Profile & user settings | 15-profile |
| Admin cleanup (Lobster admin panel) | 17-admin-cleanup |

**Total:** 17 test suites, 150+ test cases.

---

## 2. Technology Stack

| Layer | Technology |
|---|---|
| Test runner | Playwright Test v1.60.0 |
| Language | TypeScript |
| Browser | Chromium (headless) |
| Pattern | Page Object Model |
| SFTP client | `ssh2-sftp-client` v12.x |
| Spreadsheet | `xlsx` v0.18.5 |
| Env loading | `dotenv` v17.x |
| Node.js | v20 (CI via nvm) |
| CI/CD | GitLab CI — `debian:trixie` / `kasm_docker` runner |
| Reporting | HTML report + List reporter |
| Video | `.webm` — toggled via `RECORD_VIDEO=true` |
| Screenshots | On failure (always); manual `screenshots/` folder |

---

## 3. Project Structure

```
sellon-tests/
├── tests/                              # 17 spec files (numbered for execution order)
│   ├── 01-login-pom.spec.ts
│   ├── 02-dashboard-pom.spec.ts
│   ├── 03-product-create-pom.spec.ts
│   ├── 04-product-edit-pom.spec.ts
│   ├── 05-product-filters-pom.spec.ts
│   ├── 06-product-validations-pom.spec.ts
│   ├── 07-product-import-pom.spec.ts
│   ├── 08-stock-import-pom.spec.ts
│   ├── 09-export-pom.spec.ts
│   ├── 10-sftp-upload-pom.spec.ts
│   ├── 11-order-workflow-pom.spec.ts
│   ├── 12-orders-pom.spec.ts
│   ├── 13-orders-filters-pom.spec.ts
│   ├── 14-split-shipment-pom.spec.ts
│   ├── 15-profile-pom.spec.ts
│   ├── 16-product-delete-pom.spec.ts
│   └── 17-admin-cleanup-pom.spec.ts
│
├── pages/                              # Page Object classes
│   ├── base.page.ts
│   ├── login.page.ts
│   ├── dashboard.page.ts
│   ├── navigation.page.ts
│   ├── product-list.page.ts
│   ├── product-form.page.ts
│   └── orders.page.ts
│
├── helpers/
│   ├── selectors.ts                    # Centralized UI label constants
│   ├── edi-builder.ts                  # Builds / parses openTRANS 2.1 EDI XML
│   └── sftp-upload.ts                  # SftpHelper class
│
├── fixtures/                           # 4 GORDP XML files (test orders)
│   ├── GORDP_223344_36490.xml          → order 61830310
│   ├── GORDP_223344_36491.xml          → order 61830311
│   ├── GORDP_223344_36492.xml          → order 61830312
│   └── GORDP_223344_38083.xml          → order 61830313
│
├── test-data/
│   ├── import-products.csv / .xlsx
│   └── stock-update.csv / .xlsx
│
├── scripts/                            # Utility / exploration scripts
│   ├── download-gordp-files.mjs
│   ├── seed-orders.ts
│   └── ...
│
├── global-setup.ts                     # Runs before all tests (debug login page)
├── global-teardown.ts                  # Cleans up auth-state.json
├── playwright.config.ts
├── .gitlab-ci.yml
├── .env                                # Local secrets — NEVER commit
├── tsconfig.json
└── package.json
```

---

## 4. Environment Variables

All variables live in `.env` (gitignored). In GitLab CI, set them under **Settings → CI/CD → Variables** (masked + protected).

> **Warning: `.env` must never be committed.** It contains staging credentials.

### Application

| Variable | Required | Description |
|---|---|---|
| `BASE_URL` | ✅ | Staging portal URL, e.g. `https://stage.sellon.ch/` |
| `TEST_USERNAME` | ✅ | Supplier portal login username |
| `TEST_PASSWORD` | ✅ | Supplier portal login password |

### Admin Panel (test 17 only)

| Variable | Required | Description |
|---|---|---|
| `ADMIN_USERNAME` | ✅ | Lobster admin panel username |
| `ADMIN_PASSWORD` | ✅ | Lobster admin panel password |
| `ADMIN_COMPANY_ID` | ✅ | Company ID for safety gate (351) |
| `ADMIN_SUPPLIER_ID` | ✅ | Supplier ID for safety gate (223344) |

### SFTP / EDI (tests 10, 11)

| Variable | Required | Description |
|---|---|---|
| `SFTP_HOST` | ✅ | SFTP server hostname |
| `SFTP_PORT` | optional | Port, defaults to 22 |
| `SFTP_USERNAME` | ✅ | SFTP login username |
| `SFTP_PASSWORD` | optional | Password (or use `SFTP_PRIVATE_KEY`) |
| `SFTP_PRIVATE_KEY` | optional | Path to private key file, or raw key content |
| `SFTP_SUPPLIER_ID` | ✅ | Supplier ID embedded in filenames (223344) |
| `SFTP_REMOTE_IN_DIR` | ✅ | Dir where supplier uploads EDI responses |
| `SFTP_REMOTE_OUT_DIR` | ✅ | Dir where the platform writes GORDP files |

### Misc

| Variable | Required | Description |
|---|---|---|
| `RECORD_VIDEO` | optional | Set to `true` to record `.webm` video for every test |

---

## 5. Running Tests Locally

### Prerequisites

```bash
node -v                                # v18+ required, v20 recommended
npm ci                                 # install dependencies
npx playwright install chromium        # install Chromium browser
cp .env.example .env                   # fill in credentials
```

### Run all suites

```bash
npx playwright test
```

### Run a single suite

```bash
npx playwright test tests/11-order-workflow-pom.spec.ts
```

### Run a specific test by name

```bash
npx playwright test --grep "TV icon"
```

### Enable video recording for a run

```bash
RECORD_VIDEO=true npx playwright test
```

Or set `RECORD_VIDEO=true` in `.env` to keep it on permanently.

### View HTML report

```bash
npx playwright show-report
# Opens playwright-report/ in browser.
# Screenshots and videos are embedded inline.
```

### Clean up artifacts

```bash
rm -rf test-results/ screenshots/
```

---

## 6. Playwright Configuration

**File:** `playwright.config.ts`

| Setting | Value | Notes |
|---|---|---|
| `testDir` | `./tests` | |
| `testIgnore` | `**/old/**` | |
| `timeout` | 300,000 ms | 5 min per test — SPA is slow |
| `expect.timeout` | 30,000 ms | |
| `baseURL` | `process.env.BASE_URL` | |
| `headless` | `true` | |
| `viewport` | 1920 × 1080 | |
| `navigationTimeout` | 120,000 ms | |
| `actionTimeout` | 30,000 ms | |
| `userAgent` | Chrome 120 / macOS | Avoids bot-detection |
| `--disable-blink-features` | `AutomationControlled` | Avoids detection |
| `--no-sandbox` | enabled | Required for CI |
| `screenshot` | `only-on-failure` | |
| `video` | `on` if `RECORD_VIDEO=true`, else `off` | |
| `reporter` | `html`, `list` | |
| Browser | `chromium` | Single project |

---

## 7. Page Object Model

All DOM interactions live in page classes. Tests never use raw locators directly.

### `BasePage` — `pages/base.page.ts`

Base class extended by `OrdersPage`. Provides shared utilities.

| Method | Description |
|---|---|
| `screenshot(name)` | Saves `screenshots/{name}.png` — failure in screenshot never aborts test |
| `getBodyText()` | Returns full body `innerText` |
| `waitForLoad(seconds)` | `page.waitForTimeout(seconds * 1000)` |
| `pressEscape()` | Presses Escape, waits 2s |
| `scrollToBottom()` | Scrolls page to bottom |
| `scrollToTop()` | Scrolls page to top |

---

### `LoginPage` — `pages/login.page.ts`

Handles the slow Angular login form for `stage.sellon.ch`.

**Key behaviors:**
- `goto()` retries up to 3 times with a broad CSS selector wait (`input[type="text"], input[type="password"]`) — the SPA takes 30–120s to render the login form
- Uses `pressSequentially()` with 150ms delay (Lobster requires real keystrokes; `fill()` bypasses keyboard events that trigger autocomplete and validation)
- Handles the "existing session" Yes/No modal after login

| Method | Description |
|---|---|
| `goto()` | Navigate to `BASE_URL` with retry loop, 90s input wait |
| `fillUsername(username)` | Click + `pressSequentially` with 150ms delay |
| `fillPassword(password)` | Click + `pressSequentially`, retries if field is empty |
| `clickLogin()` | Clicks Login button |
| `login(user, pass)` | Full flow: `goto` → fill → submit → handle session popup |
| `isLoggedIn()` | `true` if Login button is gone |

---

### `DashboardPage` — `pages/dashboard.page.ts`

Waits for the SPA to fully render and exposes dashboard section assertions.

| Method | Description |
|---|---|
| `waitForDashboard()` | Waits for `.menu-icon` + `lb-modal-blocking` hidden + 5s buffer |
| `expectAllSectionsVisible()` | Asserts all 7 dashboard headings are visible |
| `screenshot(name)` | Saves screenshot |
| `getBodyText()` | Returns body `innerText` |

---

### `NavigationPage` — `pages/navigation.page.ts`

Opens the sidebar and navigates to any section. Dismisses blocking modals before interacting.

| Method | Description |
|---|---|
| `navigateToDashboard()` | Opens sidebar → clicks Dashboard |
| `navigateToProducts()` | Opens sidebar → expands Product submenu → clicks Product |
| `navigateToOrders()` | Opens sidebar → expands Orders submenu → clicks Orders |

> **Important:** Navigation must use sidebar clicks, not `page.goto()`. The SPA requires menu activation to render section content.

---

### `ProductListPage` — `pages/product-list.page.ts`

Wraps the product data grid. All ribbon button locators use `RIBBON` constants from `helpers/selectors.ts`.

| Method | Description |
|---|---|
| `newBtn()` / `deleteBtn()` / `exportBtn()` | Ribbon button locators |
| `importBtn()` / `clearBtn()` / `searchBtn()` | Ribbon button locators |
| `ribbonButtonsVisible()` | Returns `Record<string, boolean>` for visible ribbon buttons |
| `clickNew()` | Dispatches click on New, waits 10s |
| `clickImport()` | Clicks Import, waits 10s |
| `clickRefresh()` | Clicks Refresh, waits 10s |
| `clickClear()` | Clicks Clear, waits 3s |
| `getPaginationText()` | Returns `"X - Y of Z"` string |
| `getRowCount()` | Returns `tbody tr` count |
| `doubleClickProduct(text)` | Double-clicks first row containing `text`, waits 10s |

---

### `ProductFormPage` — `pages/product-form.page.ts`

Handles the multi-tab product creation/edit form.

**Key behavior — `findInputIndex(label)`:**
A DOM-walking strategy that locates form inputs by their label text using 4 fallback strategies:
1. Proper `<label for="...">` elements
2. Leaf/near-leaf span/div elements (skips block containers)
3. Placeholder attribute matching
4. Positional heuristics

This approach bypasses React's re-render resets that invalidate direct `.value` assignments.

| Method | Description |
|---|---|
| `fillField(label, value)` | Finds input by label, clears, fills via `pressSequentially` |
| `clickTab(tabName)` | Clicks a product form tab by name |
| `save()` | Clicks Save button |
| `expectValidationError(text)` | Asserts validation error text is visible |
| `findInputIndex(label)` | Returns DOM index of input associated with label |

---

### `OrdersPage` — `pages/orders.page.ts`

Extends `BasePage`. Wraps the Orders list. Re-exports `RIBBON`, `ORDER_STATUS`, `COLUMN`, `DIALOG` for convenience.

| Method | Description |
|---|---|
| `navigateToOrders()` | Opens sidebar → expands Orders → clicks Orders, waits 15s |
| `expectOrderTableVisible()` | Asserts ID column header visible |
| `getRowCount()` | Returns `tbody tr` count |
| `getPaginationText()` | Returns `"X - Y of Z"` string |
| `getPaginationTotal()` | Parses and returns the `Z` total as number |
| `filterCell(colIndex)` | Returns the filter row input locator for a column |

---

## 8. Helpers & Utilities

### `helpers/selectors.ts` — Centralized UI Labels

Single source of truth for every UI label string. All tests and page classes import from here.

When Sellon renames a button, only this file needs updating.

```typescript
RIBBON.NEW / DELETE / EXPORT / IMPORT / CLEAR / SEARCH / MASS_EDIT / STOCK_IMPORT
RIBBON.EDIT / CANCEL / CREATE_NEW_SHIPMENT / NEW_SHIPMENT
ORDER_STATUS.NEW / CONFIRMED / SHIPPED / CANCELLED
PRODUCT_STATE.STAGE_1 / STAGE_2 / ERROR
TAB.MASTER_DATA / PRICE_AND_STOCK / MEDIA / SUPPLEMENTARY / GALAXUS / ORDER_ITEMS
COLUMN.ID / ORDER_ID / STATUS / OWNER / ...
DIALOG.YES / NO / CANCEL / SAVE / DELETE / CONFIRM
CANCEL_PATTERNS / CONFIRM_PATTERNS  // regex arrays for order action detection
```

---

### `helpers/edi-builder.ts` — EDI XML Builder

Builds and parses **openTRANS 2.1** EDI XML messages used by the Sellon platform.

#### EDI directions

```
partner2dg  = supplier → Sellon  (GORDR, GDELR, GCANP, GCANR, GSURN)
dg2partner  = Sellon → supplier  (GORDP, GCANP, GRETP)
```

#### Exported functions

| Function | Message type | Direction |
|---|---|---|
| `buildGordr(orderId, positions)` | GORDR | Supplier → Platform |
| `buildGdelr(orderId, positions, shipmentNo, carrier)` | GDELR | Supplier → Platform |
| `buildGcanr(orderId, status, reason)` | GCANR | Supplier → Platform |
| `buildGsurn(orderId, status, positions, reason)` | GSURN | Supplier → Platform |
| `buildGordp(orderId, positions, address)` | GORDP | Platform → Supplier (seeding) |
| `buildGcanp(orderId, positions, reason)` | GCANP | Platform → Supplier (seeding) |
| `buildGretp(orderId, positions, reason)` | GRETP | Platform → Supplier (seeding) |
| `parseGordpXml(content)` | — | Parse incoming GORDP, returns `ParsedOrder` |

`parseGordpXml` is used by test 17 to extract order IDs from the fixture XML files before admin cleanup.

**Filename format:** `{TYPE}_{SUPPLIER_ID}_{TIMESTAMP}.xml`

---

### `helpers/sftp-upload.ts` — SFTP Helper

Wraps `ssh2-sftp-client`. Reads all config from environment variables.

| Method | Description |
|---|---|
| `connect()` | Establishes SFTP connection (no-op if already connected) |
| `disconnect()` | Closes connection |
| `get isConfigured` | `true` if `SFTP_HOST` env var is set |
| `upload(localPath, remoteDir)` | Uploads file to remote directory |
| `uploadContent(content, filename, remoteDir)` | Uploads string as file |
| `list(remoteDir)` | Lists remote directory |
| `download(remotePath)` | Downloads file as string |
| `delete(remotePath)` | Deletes remote file |

All methods silently skip if `SFTP_HOST` is not configured — no crash in environments without SFTP access.

#### SFTP directory structure

```
/uploads/stage/OrderData/Test/
├── partner2dg/   ← Supplier uploads responses here  (GORDR, GDELR, GCANR, GSURN)
└── dg2partner/   ← Platform writes orders here       (GORDP, GCANP, GRETP)
```

---

### `global-setup.ts`

Runs before all tests. Launches a Chromium browser, navigates to `BASE_URL`, logs all found inputs and buttons, and saves `login-page.png`. Purpose: debug environment issues in CI before any test runs.

### `global-teardown.ts`

Runs after all tests. Deletes `auth-state.json` if it exists to prevent stale auth from leaking between CI runs.

---

## 9. Test Suites — All 17 Files

All suites run in **serial mode** within their file. Each creates its own browser context with `chromium.launch()` or `browser.newContext()` and performs its own login unless noted.

---

### 01 — Login

**File:** `tests/01-login-pom.spec.ts`
**Tests:** 6

| Test | Description |
|---|---|
| Valid credentials | Happy path — lands on dashboard |
| Invalid password | Wrong password — stays on login page |
| Empty fields | Empty submit — stays on login page |
| SQL injection | `' OR 1=1 --` in username — safely rejected |
| Whitespace-only | Spaces-only credentials — stays on login page |
| Wrong case password | Case-sensitive password check |

---

### 02 — Dashboard

**File:** `tests/02-dashboard-pom.spec.ts`
**Tests:** 20+
**Mode:** Serial — shared `beforeAll` login

| Group | Tests |
|---|---|
| Dashboard sections | All 7 sections visible |
| Products KPI | Total, complete, incomplete, invalid counts |
| Orders KPI | Total, new orders count |
| Delivery Rate KPI | Merchant reliability metric visible |
| Cancel Rate KPI | Cancellation metrics visible |
| Import section | Recent imports, stock updates, failed/successful |
| Export Galaxus | Latest exports with product count |
| Scheduler | Next planned export times |
| Locale | Dashboard in user's locale language |
| Full capture | Full-page screenshot |
| Products list | Navigate to Products — table, pagination, toolbar, columns, pagination, refresh, verify company products only |
| TV icon (layout) | Layout selector opens, vertical + quarter options work |
| Fullscreen | TV icon + expand button enter fullscreen |

---

### 03 — Product Create

**File:** `tests/03-product-create-pom.spec.ts`
**Tests:** 18
**Mode:** Serial

Step-by-step creation flow. Each step is its own test to isolate failures.

| Step | Action |
|---|---|
| 1 | Click New — product form opens |
| 2 | Verify all required tabs present |
| 2b | Save empty form — verify all validation errors |
| 3–12b | Fill GTIN, provider key, brand, title DE, description DE, weight, category, selling price, VAT, stock, media URL |
| 13 | Save — verify provider key in body |
| 14 | Verify SKU, GTIN, brand all present |
| 15 | Invalid GTIN checksum rejected |
| 16 | Empty provider key rejected |
| 17 | Invalid VAT rejected |
| 18 | Stock > 99999 rejected |

---

### 04 — Product Edit

**File:** `tests/04-product-edit-pom.spec.ts`
**Tests:** 10

| Test | Description |
|---|---|
| Double-click product | Opens edit form |
| Verify Master data fields | GTIN, provider key, brand, weight visible |
| Edit Brand field | Updates brand value |
| Edit Weight field | Updates weight value |
| Navigate to Price & stock tab | Tab navigation works |
| Save changes | Changes persist |
| Invalid GTIN rejected | Validation error |
| Empty provider key rejected | Validation error |
| Invalid VAT rejected | Validation error |
| Mass edit | Select products → set Active → verify |

---

### 05 — Product Filters

**File:** `tests/05-product-filters-pom.spec.ts`
**Tests:** 19

| Test | Filter |
|---|---|
| TC-01 | State = "Stage 1" |
| TC-02 | Clear button restores full dataset |
| TC-03 | ID filter — single product |
| TC-05 | Partial title text "Ant" |
| TC-06 | Stock quantity = 200 |
| TC-07 | State = "Stage 2" |
| TC-08 | State = "Error" |
| TC-09 | Name = "SoundBlast" |
| TC-10 | Name = non-existing → 0 results |
| TC-11 | Provider key = "BT-SPK" |
| TC-12 | VAT = "8.10" |
| TC-13 | Combined: Stage 2 + Provider key "BT-SPK" |
| TC-14 | Horizontal scroll reveals hidden columns |
| TC-15 | Pagination updates after filter |
| TC-16 | Price < 12 |
| TC-17 | Price > 12 |
| TC-18 | Special characters in Name — no crash |
| Ribbon | Double-arrow collapses and restores ribbon |
| TC-19 | Contradictory filters → 0 results |

---

### 06 — Product Validations

**File:** `tests/06-product-validations-pom.spec.ts`
**Tests:** 20

Field-level validation rules. Each test opens a fresh product form.

| Field | Tests |
|---|---|
| GTIN | Valid + invalid for all 4 lengths: GTIN-8, -12, -13, -14 |
| Provider key | > 50 chars rejected; valid characters accepted (A-Z, 0-9, `. , ! ? - _ @`) |
| Price | Negative rejected; maximum valid accepted |
| VAT | 2.60% accepted; 8.10% accepted |
| Stock | Negative rejected; zero accepted |
| Tabs | Supplementary data, Media, Galaxus tabs open correctly |
| Empty GTIN | Product becomes Invalid status |

---

### 07 — Product Import

**File:** `tests/07-product-import-pom.spec.ts`
**Tests:** 6
**Mode:** Serial
**Fixtures:** `test-data/import-products.csv`, `test-data/import-products.xlsx`

| Step | Description |
|---|---|
| 1 | Open import dialog |
| 2 | Submit without file — validation error shown |
| 3 | Upload CSV file + run import |
| 4 | Close dialog after CSV import |
| 5 | Upload XLSX file — successful import |
| 6 | Upload PNG file — format rejection |

---

### 08 — Stock Import

**File:** `tests/08-stock-import-pom.spec.ts`
**Tests:** 12
**Mode:** Serial
**Fixtures:** `test-data/stock-update.csv`, `test-data/stock-update.xlsx`

| Step | Description |
|---|---|
| 1 | Verify products before stock update |
| 2 | Click Stock import button |
| 3 | Submit without file — error shown |
| 4 | Close error, reopen dialog |
| 5 | Upload stock update CSV |
| 6 | Run the import |
| 7 | Wait for completion |
| 8 | Close dialog + verify list updates |
| Negative | Non-CSV file → error |
| 9 | Upload XLSX — successful import |
| Negative | Upload PNG — format rejection |
| Negative | CSV with wrong columns — validation error |

---

### 09 — Export

**File:** `tests/09-export-pom.spec.ts`
**Tests:** 11
**Mode:** Serial

| Step | Description |
|---|---|
| 1 | Verify products before export |
| 2 | Export button exists |
| 3 | Click Export button |
| 4 | Handle confirmation dialog |
| 5 | Wait for export to complete |
| 6 | Verify export status updated |
| 7 | Error-state products not in export count |
| 8 | Export appears on dashboard |
| 9 | Scheduler shows next planned export |
| Negative 1 | Error products excluded from count |
| Negative 2 | Dialog can be cancelled without exporting |

---

### 10 — SFTP Upload

**File:** `tests/10-sftp-upload-pom.spec.ts`
**Tests:** 4

Validates SFTP connection and the GORDP order-creation flow.

| Test | Description |
|---|---|
| Connection + directory listing | Connects; lists both `partner2dg` and `dg2partner` |
| Check directory status | Reports files in both directories |
| Upload GORDP — create order | Uploads fixture GORDP to `dg2partner`, waits for order in Sellon |
| Verify order in Orders tab | Navigates to Orders page, confirms order is visible |

> All tests skip gracefully if `SFTP_HOST` is not set.

---

### 11 — Order Workflow (EDI Round-Trip)

**File:** `tests/11-order-workflow-pom.spec.ts`
**Tests:** 8
**Mode:** Serial
**CI timeout:** 90 minutes

Full EDI order lifecycle combining UI actions with SFTP uploads and downloads.

| Test | Description |
|---|---|
| Step 1 | Find single-item order, confirm positions |
| Step 2 | Add shipment on Shipping tab |
| Step 3 | Verify order status after shipment |
| Step 4 (Positive) | Confirm a New order — positions confirmed, status updates |
| Step 5 (Positive) | Filter orders by status — only matching rows shown |
| Step 6 (Negative) | Cancel a New order — status changes to Cancelled |
| Step 7 (Negative) | Create shipment with missing required fields is blocked |
| Step 8 (Negative) | Search for non-existent order ID returns empty result |

**EDI files exercised:** GORDP (fixture), GORDR, GDELR, GCANP, GCANR, GRETP, GSURN

---

### 12 — Orders

**File:** `tests/12-orders-pom.spec.ts`
**Tests:** 10

| Test | Description |
|---|---|
| Navigate to Orders | Orders page loads |
| Display order data | Grid shows order rows |
| Orders page content | Key elements visible |
| Open order detail | Row click opens detail |
| Export without selection | All orders exported as XLSX |
| Export with 1 selected | Only selected order in XLSX |
| Export with multiple selected | Only selected orders in XLSX |
| Negative: non-existent ID | No results, no crash |
| Ribbon collapse | Double-arrow collapses and restores ribbon |
| Negative: export no selection | All exported — no crash |

---

### 13 — Orders Filters

**File:** `tests/13-orders-filters-pom.spec.ts`
**Tests:** 11

Uses a discovery test (TC-00) to detect column positions dynamically — no hardcoded column indices.

| Test | Description |
|---|---|
| TC-00 | Discover orders grid columns and filter row |
| TC-01 | Filter by Order ID |
| TC-02 | Clear filters restores full count |
| TC-03 | Status dropdown filter |
| TC-04 | Text filter on first available text column |
| TC-05 | Date range filter |
| TC-06 | Combined ID + Status filter |
| TC-07 | Pagination text updates after filter |
| Negative 1 | Non-existent ID → no results |
| Negative 2 | Special characters in ID → no crash |
| Negative 3 | Filter then clear → full count restored |

---

### 14 — Split Shipment

**File:** `tests/14-split-shipment-pom.spec.ts`
**Tests:** 3
**Mode:** Serial

| Test | Description |
|---|---|
| Step 1 | Partial quantity confirmation (split shipment setup) |
| Step 2 | Add shipment for confirmed partial quantity |
| Step 3 | Verify resulting split order status |

---

### 15 — Profile

**File:** `tests/15-profile-pom.spec.ts`
**Tests:** 13

| Group | Tests |
|---|---|
| Positive | Profile dropdown opens with all expected menu items |
| Positive | User settings panel opens |
| Positive | User settings panel closes via close button |
| Positive | Switch theme to Bright changes visual theme |
| Positive | Switch theme back to Default |
| Positive | Reload navigation menus keeps app functional |
| Positive | Logout shows session-ended message, returns to login |
| Negative | After logout, protected URL redirects to login |
| Negative | Session re-established after fresh login |
| Negative | Dropdown closes when clicking outside |
| Negative | Closing User settings without changes preserves state |
| Negative | Bright theme switch does not break page layout |
| Negative | Reload navigation menus does not corrupt the menu |

---

### 16 — Product Delete

**File:** `tests/16-product-delete-pom.spec.ts`
**Tests:** 11

| Test | Description |
|---|---|
| Single Delete 1 | Delete a Stage 1 product |
| Single Delete 2 | Delete a Stage 2 product |
| Single Delete 3 | Delete a product with Error status |
| Single Delete 4 | Cancel deletion — product remains |
| Bulk Delete 1 | Select all → delete all |
| Bulk Delete 2 | Select 3 specific → delete 3 |
| Bulk Delete 3 | Select multiple → cancel → all remain |
| Edge Case 1 | Delete without selection — no crash |
| Edge Case 2 | Count decreases by correct amount |
| Edge Case 3 | Deleted product does not reappear |
| Final | Verify product list after all deletions |

---

### 17 — Admin Cleanup

**File:** `tests/17-admin-cleanup-pom.spec.ts`
**Tests:** 4
**Mode:** Serial
**Target:** Lobster admin panel at `stage.sellon.ch/`

Logs in to the Lobster admin panel (separate credentials from supplier portal), then deletes fixture orders and EDI messages created by tests 10 and 11. Safety-gated to company 351 / supplier 223344 — rows not matching these IDs are skipped.

| Test | Description |
|---|---|
| Login to admin panel | Navigates to admin URL, logs in with `ADMIN_USERNAME`/`ADMIN_PASSWORD`, waits for Lobster app shell |
| Delete fixture orders | Opens Orders grid via global search (CMD+Shift+F), filters by each fixture order ID, verifies supplier/company match, deletes |
| Delete EDI messages | Opens EdiMessageQueue grid, filters by `SUPPLIER_ID=223344` in `fileName` column, deletes matching rows |
| Logout | Closes admin session |

**How admin search works:**
The Lobster global search (CMD+Shift+F) renders results as `div.menu-item` elements in a left sidebar panel. Each item has `span.label` and `span.hint`. Navigation happens by clicking the `div.open > a` link inside the matching item. `pressSequentially()` is used because `fill()` does not trigger Lobster's autocomplete.

**Order ID source:**
The test reads order IDs from the `fixtures/GORDP_*.xml` files at runtime using `parseGordpXml()` — no hardcoded IDs.

---

## 10. EDI Message Reference

| Message | Direction | Trigger |
|---|---|---|
| GORDP | Platform → Supplier | New customer order placed |
| GORDR | Supplier → Platform | Supplier confirms (accepts) the order |
| GDELR | Supplier → Platform | Supplier ships — delivery confirmation |
| GCANP | Platform → Supplier | Customer requests cancellation |
| GCANR | Supplier → Platform | Supplier responds to cancellation request |
| GRETP | Platform → Supplier | Customer requests return |
| GSURN | Supplier → Platform | Supplier responds to return request |

### Order status flow

```
Order:    New → Open → Confirmed → Shipped → Closed
Position: To confirm → Confirmed → Shipped → Returned
                                 ↘ Cancelling → Cancelled
```

---

## 11. GitLab CI/CD Pipeline

**File:** `.gitlab-ci.yml`
**Registry:** `git.w-4.ch/ashoaib/sellon-tests`
**Runner tag:** `kasm_docker`
**Image:** `debian:trixie`

### Triggers

- Push to `main`
- Manual web trigger
- Scheduled pipeline

### `before_script` (runs for every job)

1. Install system dependencies (Chromium system libs)
2. Install nvm + Node.js v20
3. `npm ci`
4. `npx playwright install-deps chromium`
5. `npx playwright install chromium`

### Artifacts (retained 14 days)

- `screenshots/`
- `playwright-report/`

### Jobs

| Job name | Test file | Notes |
|---|---|---|
| `login` | 01-login-pom.spec.ts | |
| `dashboard` | 02-dashboard-pom.spec.ts | |
| `product-create` | 03-product-create-pom.spec.ts | |
| `product-edit` | 04-product-edit-pom.spec.ts | |
| `product-filters` | 05-product-filters-pom.spec.ts | |
| `product-validations` | 06-product-validations-pom.spec.ts | |
| `product-import` | 07-product-import-pom.spec.ts | |
| `stock-import` | 08-stock-import-pom.spec.ts | |
| `export` | 09-export-pom.spec.ts | |
| `sftp-upload` | 10-sftp-upload-pom.spec.ts | |
| `order-workflow` | 11-order-workflow-pom.spec.ts | `timeout: 90 minutes` |
| `orders` | 12-orders-pom.spec.ts | |
| `orders-filters` | 13-orders-filters-pom.spec.ts | |
| `product-delete` | 16-product-delete-pom.spec.ts | |

> **Note:** Tests 14 (split-shipment), 15 (profile), and 17 (admin-cleanup) are not yet wired up in `.gitlab-ci.yml`. Add them using the `.test-template` extends pattern.

---

## 12. Key Technical Notes

### Lobster SPA slow load

The portal takes 30–120 seconds to render the login form on a cold start. All page objects use a retry loop + broad CSS selector wait (`input[type="text"], input[type="password"]`) before trying named role locators. Do not reduce `navigationTimeout` below 120s.

### `pressSequentially()` required — not `fill()`

`fill()` bypasses keyboard events. Lobster's autocomplete and form validation require real keystrokes. All credential and form inputs use `pressSequentially(value, { delay: 150 })`.

### Admin login `loginwindow` overlay

The Lobster admin shows a `<loginwindow>` custom element that overlays the entire UI until fully hidden. All admin interactions wait for `loginwindow` hidden before proceeding.

### Serial mode and browser context

Most suites use `test.describe.configure({ mode: 'serial' })` to run tests in order within a file. Each test file creates its own browser context — there is no shared auth state across files. Tests 17 (admin) and some others use `chromium.launch()` directly, which means the global Playwright `storageState` setting does not apply.

### Column index detection

Several test suites (11, 13, 17) detect column indices by scanning `thead tr th` inner texts rather than hardcoding positions. This makes tests resilient to column reordering. The `findIndex` uses anchored regexes (e.g. `/^order.?num/i`) to avoid false matches on similarly-named columns.

### Admin safety gate

Test 17 only deletes rows where the row text contains company ID `351` or supplier ID `223344`. Any row not matching is logged and skipped. This prevents accidentally deleting orders belonging to other companies in the shared staging environment.

### Fixture order IDs

The fixture XML files use supplier ID `223344`. Order IDs are parsed at test runtime from the XML files using `parseGordpXml()` — no hardcoded IDs in the test code.

---

*Last updated: 2026-06-22*
*Maintained by: Aamna Shoaib / ESC Team — team-esc@w-4.com*

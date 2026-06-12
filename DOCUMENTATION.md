# Sellon Automation Test Suite — Complete Documentation

**Project:** `sellon-tests`
**Target Application:** [stage.sellon.ch](https://stage.sellon.ch/) (Sellon Supplier Portal — Staging)
**Framework:** Playwright v1.60.0 (TypeScript)
**Pattern:** Page Object Model (POM)
**CI/CD:** GitHub Actions — runs on every push to `main`, every PR, and daily at 06:00 UTC

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Technology Stack](#2-technology-stack)
3. [Project Structure](#3-project-structure)
4. [Environment Variables & Configuration](#4-environment-variables--configuration)
5. [Running Tests Locally](#5-running-tests-locally)
6. [CI/CD Pipeline](#6-cicd-pipeline)
7. [Page Object Model (Pages)](#7-page-object-model-pages)
8. [Helpers](#8-helpers)
9. [Test Specifications — All 14 Suites](#9-test-specifications--all-14-suites)
   - [1. login-pom](#91-login-pom)
   - [2. dashboard-pom](#92-dashboard-pom)
   - [3. product-create-pom](#93-product-create-pom)
   - [4. product-edit-pom](#94-product-edit-pom)
   - [5. product-delete-pom](#95-product-delete-pom)
   - [6. product-filters-pom](#96-product-filters-pom)
   - [7. product-validations-pom](#97-product-validations-pom)
   - [8. product-import-pom](#98-product-import-pom)
   - [9. stock-import-pom](#99-stock-import-pom)
   - [10. export-pom](#910-export-pom)
   - [11. orders-pom](#911-orders-pom)
   - [12. orders-filters-pom](#912-orders-filters-pom)
   - [13. order-workflow-pom](#913-order-workflow-pom)
   - [14. sftp-upload-pom](#914-sftp-upload-pom)
10. [Key Technical Decisions & Fixes](#10-key-technical-decisions--fixes)
11. [EDI Message Reference](#11-edi-message-reference)
12. [Seeding Test Orders](#12-seeding-test-orders)

---

## 1. Project Overview

This repository contains a complete end-to-end (E2E) automation test suite for the **Sellon Supplier Portal**, an Angular SPA used by suppliers to manage products, orders, exports, stock, and EDI-based communication with distribution partners (e.g. Galaxus/Digitec).

### What is tested

| Domain | Test Suites |
|---|---|
| Authentication | login-pom |
| Dashboard & KPIs | dashboard-pom |
| Product lifecycle | product-create-pom, product-edit-pom, product-delete-pom |
| Product discovery | product-filters-pom |
| Product validation | product-validations-pom |
| CSV imports | product-import-pom, stock-import-pom |
| Galaxus export | export-pom |
| Order management | orders-pom, orders-filters-pom |
| Order workflow (EDI) | order-workflow-pom |
| SFTP / EDI integration | sftp-upload-pom |

**Total test cases:** ~175 across 14 spec files.

---

## 2. Technology Stack

| Layer | Technology |
|---|---|
| Test runner | Playwright Test v1.60.0 |
| Language | TypeScript (strict) |
| Browser | Chromium (headless) |
| Pattern | Page Object Model (POM) |
| SFTP client | `ssh2-sftp-client` v12.x |
| Env loading | `dotenv` |
| Node.js | v24 (CI) |
| CI | GitHub Actions (matrix strategy, 14 parallel jobs) |
| Reporting | HTML report + List reporter |
| Screenshots | On failure (CI) + manual `screenshots/` folder |

---

## 3. Project Structure

```
sellon-tests/
├── tests/                          # All 14 spec files
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
│   ├── sftp-upload-pom.spec.ts
│   ├── global-setup.ts             # Shared login (saves auth state)
│   └── global-teardown.ts
├── pages/                          # Page Object classes
│   ├── base.page.ts
│   ├── login.page.ts
│   ├── navigation.page.ts
│   ├── dashboard.page.ts
│   ├── orders.page.ts
│   ├── product-list.page.ts
│   └── product-form.page.ts
├── helpers/
│   ├── edi-builder.ts              # Builds EDI XML for all message types
│   └── sftp-upload.ts              # SftpHelper class + singleton
├── scripts/
│   └── seed-orders.ts              # Seeds 3 test orders via GORDP SFTP upload
├── test-data/
│   └── *.csv                       # Sample CSV files for import tests
├── screenshots/                    # Manual + failure screenshots
├── playwright-report/              # HTML test reports
├── playwright.config.ts            # Playwright global config
├── .env                            # Local secrets (not committed)
├── .github/
│   └── workflows/
│       └── playwright.yml          # CI/CD GitHub Actions workflow
└── package.json
```

---

## 4. Environment Variables & Configuration

### `.env` (local only — never committed)

```env
# Application login
TEST_USERNAME=ashoaib
TEST_PASSWORD=test2
BASE_URL=https://stage.sellon.ch/

# SFTP — EDI exchange with the Sellon platform
SFTP_HOST=microservices.mpe.wwip.dev
SFTP_PORT=22
SFTP_USERNAME=<supplier_sftp_user>
SFTP_PASSWORD=<supplier_sftp_password>
SFTP_SUPPLIER_ID=223344

# Supplier → Platform (upload EDI IN messages: GORDR, GDELR, GCANR, GSURN)
SFTP_REMOTE_IN_DIR=/uploads/stage/OrderData/Test/partner2dg

# Platform → Supplier (read EDI OUT messages: GORDP, GCANP, GRETP)
SFTP_REMOTE_OUT_DIR=/uploads/stage/OrderData/Test/dg2partner
```

### GitHub Actions Secrets (CI)

All environment variables above are stored as repository secrets:
`TEST_USERNAME`, `TEST_PASSWORD`, `BASE_URL`, `SFTP_HOST`, `SFTP_PORT`, `SFTP_USERNAME`, `SFTP_PASSWORD`, `SFTP_REMOTE_IN_DIR`, `SFTP_REMOTE_OUT_DIR`, `SFTP_SUPPLIER_ID`

### `playwright.config.ts` key settings

| Setting | Value |
|---|---|
| `testDir` | `./tests` |
| `timeout` | 300,000 ms (5 min per test) |
| `expect.timeout` | 30,000 ms |
| `baseURL` | `process.env.BASE_URL \|\| 'https://stage.sellon.ch/'` |
| `headless` | `true` |
| `channel` | `chromium` |
| `viewport` | 1920 × 1080 |
| `navigationTimeout` | 120,000 ms |
| `actionTimeout` | 30,000 ms |
| `reporter` | `html`, `list` |

---

## 5. Running Tests Locally

### Prerequisites

```bash
node -v        # v18+ required, v24 recommended
npm ci         # install dependencies
npx playwright install chromium --with-deps
```

### Create `.env` file

Copy the template from Section 4 and fill in your credentials.

### Run a single suite

```bash
npx playwright test tests/login-pom.spec.ts
npx playwright test tests/order-workflow-pom.spec.ts
npx playwright test tests/sftp-upload-pom.spec.ts
```

### Run all suites

```bash
npm test
# or
npx playwright test
```

### Run with visible browser (headed mode)

```bash
npx playwright test tests/product-create-pom.spec.ts --headed
```

### View HTML report after run

```bash
npx playwright show-report
```

### npm scripts shorthand

| Command | Suite |
|---|---|
| `npm run test:login` | Login |
| `npm run test:dashboard` | Dashboard |
| `npm run test:create` | Product Create |
| `npm run test:edit` | Product Edit |
| `npm run test:delete` | Product Delete |
| `npm run test:filters` | Product Filters |
| `npm run test:validations` | Product Validations |
| `npm run test:import` | Product Import |
| `npm run test:stock` | Stock Import |
| `npm run test:export` | Export |
| `npm run test:orders` | Orders |
| `npm run test:orders-filters` | Orders Filters |

### Seed test orders (SFTP)

```bash
npx tsx scripts/seed-orders.ts
```

This uploads GORDP XML files for 3 test orders via SFTP. Wait 30–60 seconds for the platform to create the orders, then run the order-workflow tests.

---

## 6. CI/CD Pipeline

**File:** `.github/workflows/playwright.yml`

### Triggers

- `push` to `main` or `master`
- `pull_request` to `main` or `master`
- Scheduled: **daily at 06:00 UTC**
- Manual via `workflow_dispatch` (optionally specify a single test file)

### Strategy

- **14 parallel jobs**, one per test suite (matrix strategy)
- `fail-fast: false` — all suites run even if one fails
- `max-parallel: 1` — runs sequentially to avoid session conflicts on staging

### Artifacts (retained automatically)

| Artifact | Retention |
|---|---|
| `screenshots-<suite>` | 7 days |
| `playwright-report-<suite>` | 14 days |

### Job steps (per suite)

1. Checkout repository
2. Setup Node.js v24
3. `npm ci`
4. Install Chromium + dependencies
5. `mkdir -p screenshots`
6. Run tests with `--reporter=html,list`
7. Upload screenshots
8. Upload HTML report

---

## 7. Page Object Model (Pages)

### `LoginPage` (`pages/login.page.ts`)

| Method | Description |
|---|---|
| `login(username, password)` | Navigates to login page, fills credentials, submits, handles session popups |

### `NavigationPage` (`pages/navigation.page.ts`)

| Method | Description |
|---|---|
| `navigateToProducts()` | Clicks Products in sidebar |
| `navigateToOrders()` | Clicks Orders in sidebar |
| `navigateToDashboard()` | Clicks Dashboard in sidebar |

> **Important:** Navigation must use sidebar clicks, not `page.goto()`. The Angular SPA requires menu activation to render tab content in the DOM.

### `ProductListPage` (`pages/product-list.page.ts`)

| Method | Description |
|---|---|
| `expectTableVisible()` | Asserts the product grid is visible |
| `clickNew()` | Clicks the New button to open the product form |
| `getPaginationText()` | Returns pagination summary string |

### `ProductFormPage` (`pages/product-form.page.ts`)

| Method | Description |
|---|---|
| `fillField(label, value)` | Fills a form field by its label text |
| `fillTitle(text)` | Fills the German title field |
| `fillDescription(text)` | Fills the description textarea |
| `fillMediaUrl(url)` | Navigates to Media tab and fills the image URL |
| `fillField('Brand', value)` | Fills Angular autocomplete; sends Escape to commit value |
| `clickTab(tabName)` | Clicks a form tab by name |
| `clickSave()` | Clicks Save |
| `expectFormVisible()` | Asserts the form is open |
| `expectBodyContains(text)` | Asserts `page.body` contains text |
| `expectFieldValueByLabel(label, value)` | Asserts a field has the expected value |
| `expectHasError()` | Asserts at least one validation error is visible |
| `selectFirstCategory()` | Opens the category dropdown and picks the first option |

> **Angular autocomplete note:** After `fill()`, the helper sends `Escape` keypress to commit the value into the Angular component state. Without this, the autocomplete value is stored in the component but not in the raw DOM `.value`, causing assertion failures.

### `OrdersPage` (`pages/orders.page.ts`)

| Method | Description |
|---|---|
| `navigateToOrders()` | Navigates to the Orders list via sidebar |

### `DashboardPage` (`pages/dashboard.page.ts`)

| Method | Description |
|---|---|
| Various assertion helpers | KPI counts, section visibility |

---

## 8. Helpers

### `helpers/edi-builder.ts`

Builds EDI XML messages for both directions of EDI communication.

#### Supplier → Platform (uploaded to `partner2dg`)

| Function | Message | Purpose |
|---|---|---|
| `buildGORDR(orderId, positions)` | GORDR | Order confirmation (accept order) |
| `buildGDELR(orderId, positions, shipmentNo, carrier)` | GDELR | Delivery/shipment confirmation |
| `buildGCANR(orderId, status, reason)` | GCANR | Cancellation response |
| `buildGSURN(orderId, status, positions, reason)` | GSURN | Return response |

#### Platform → Supplier (read from `dg2partner`)

| Function | Message | Purpose |
|---|---|---|
| `buildGORDP(orderId, positions, address)` | GORDP | New order from platform (used for seeding) |
| `buildGCANP(orderId, positions, reason)` | GCANP | Cancellation request from customer |
| `buildGRETP(orderId, positions, reason)` | GRETP | Return request from customer |

**Filename format:** `{TYPE}_{SUPPLIER_ID}_{ORDER_ID}_{TIMESTAMP}.xml`

---

### `helpers/sftp-upload.ts`

`SftpHelper` class wrapping `ssh2-sftp-client`. Reads all connection details from environment variables.

| Method | Description |
|---|---|
| `connect()` | Establishes SFTP connection |
| `disconnect()` | Closes connection |
| `uploadEDI(localPath)` | Uploads a local file to `SFTP_REMOTE_IN_DIR` |
| `uploadEDIContent(content, filename)` | Uploads string content as a file (no temp file needed) |
| `listFiles(dir?)` | Lists files in a remote directory |
| `downloadFileContent(path)` | Downloads file content as string |
| `waitForFile(pattern, timeoutMs)` | Polls `SFTP_REMOTE_OUT_DIR` until a filename matching `pattern` appears |
| `deleteFile(path)` | Deletes a remote file |
| `testConnection()` | Tests connection and lists both directories |
| `isConfigured` | `true` if `SFTP_HOST` env var is set |

`getSftpHelper()` — singleton accessor. If `SFTP_HOST` is not set, all methods gracefully skip (no crash).

#### SFTP Directory Structure

```
/uploads/stage/OrderData/Test/
├── partner2dg/    ← Supplier uploads EDI IN here  (GORDR, GDELR, GCANR, GSURN)
└── dg2partner/    ← Platform writes EDI OUT here   (GORDP, GCANP, GRETP)
                      Supplier reads/seeds from here
```

---

## 9. Test Specifications — All 14 Suites

All suites use:
- `test.describe.configure({ mode: 'serial' })` — tests run sequentially within a suite
- `browser.newContext()` with 1920×1080 viewport
- Login via `LoginPage` in `beforeAll`
- `browser.close()` in `afterAll`

---

### 9.1 Login POM

**File:** `tests/login-pom.spec.ts`
**Test count:** 6

Validates the authentication flow against the Sellon login page.

| Test | Description |
|---|---|
| POM Login: valid credentials should reach dashboard | Happy path — valid user lands on dashboard |
| POM Login: invalid password should stay on login page | Wrong password — stays on login |
| POM Login: empty fields should stay on login page | Empty submit — stays on login |
| POM Login: SQL injection in username | `' OR 1=1 --` — safely rejected |
| POM Login: whitespace-only credentials | Spaces-only — stays on login |
| POM Login: valid username with wrong case password | Case-sensitive password check |

---

### 9.2 Dashboard POM

**File:** `tests/dashboard-pom.spec.ts`
**Test count:** ~17

Validates the Dashboard page and navigates to Products to verify cross-page data consistency.

| Section | Tests |
|---|---|
| Dashboard sections | All 7 sections visible |
| Products KPI | Total, Complete, Incomplete, Invalid counts |
| Orders KPI | Total orders, New orders count |
| Delivery Rate KPI | Merchant reliability metric visible |
| Cancel Rate KPI | Cancellation metrics visible |
| Import section | Recent imports, stock updates, failed/successful products |
| Export Galaxus | Latest exports with product count |
| Scheduler | Next planned export times visible |
| Locale | Dashboard displayed in user's locale language |
| Product list cross-check | Navigate to Products — table, pagination, toolbar, columns visible |
| Negative | All numeric counts ≥ 0; incomplete count ≤ total |

---

### 9.3 Product Create POM

**File:** `tests/product-create-pom.spec.ts`
**Test count:** 20 steps

Full product creation flow using dynamically generated unique values per run:
- `TEST_GTIN` — valid GTIN-13 (check-digit calculated at runtime)
- `TEST_SKU` — `POM-{timestamp}` (unique per run)

| Step | Action |
|---|---|
| 1 | Click New — product form opens |
| 2 | Verify all required tabs present (Master data, Price & stock, Media, Galaxus) |
| 2b | Save empty form — verify all expected validation errors and warnings appear |
| 3 | Fill GTIN |
| 4 | Fill Provider key (SKU) |
| 5 | Fill Brand (Angular autocomplete) |
| 6 | Fill Title DE |
| 7 | Fill Description DE |
| 8 | Fill Weight + select first Category |
| 9 | Navigate to Price & stock tab — verify fields visible |
| 10 | Fill Selling price |
| 11 | Fill VAT |
| 12 | Fill Stock quantity |
| 12b | Fill Media URL |
| 13 | Save — navigate to Master data tab — assert SKU in body |
| 14 | Verify SKU, GTIN, and Brand all present in body |
| 15 | Invalid GTIN checksum rejected |
| 16 | Empty provider key rejected |
| 17 | Invalid VAT (5.00) rejected |
| 18 | Stock > 99999 rejected |
| 19 | Zero price rejected |
| 20 | Final save with all valid data |

> **Known issue resolved:** After `fillMediaUrl()`, Angular renders the Media tab as active. Inactive tab content is not in the DOM. Steps 13 and 14 now navigate to **Master data tab** before asserting body text. This fixed a CI failure where `innerText()` only returned `"Product\nProduct Details\nOnline"`.

---

### 9.4 Product Edit POM

**File:** `tests/product-edit-pom.spec.ts`
**Test count:** 9

| Test | Description |
|---|---|
| Double-click product to open edit form | Opens an existing product |
| Verify Master data tab fields | GTIN, Provider key, Brand, Weight visible |
| Edit Brand field | Updates brand value |
| Edit Weight field | Updates weight value |
| Navigate to Price & stock tab | Tab navigation works |
| Save changes | Changes persist after save |
| Invalid GTIN checksum rejected | Validation error on bad GTIN |
| Empty provider key rejected | Validation error on empty SKU |
| Invalid VAT rejected | Validation error on invalid VAT |

---

### 9.5 Product Delete POM

**File:** `tests/product-delete-pom.spec.ts`
**Test count:** 10

| Test | Description |
|---|---|
| Single Delete 1 | Delete a Stage 1 product |
| Single Delete 2 | Delete a Stage 2 product |
| Single Delete 3 | Delete a product with Error status |
| Single Delete 4 | Cancel deletion — product remains |
| Bulk Delete 1 | Select all → delete all |
| Bulk Delete 2 | Select 3 specific → delete 3 |
| Bulk Delete 3 | Select multiple → cancel → all remain |
| Edge Case 1 | Delete button without selection — no crash |
| Edge Case 2 | Product count decreases by correct amount |
| Edge Case 3 | Deleted product does not reappear in list |
| Final | Verify list state after all deletions |

---

### 9.6 Product Filters POM

**File:** `tests/product-filters-pom.spec.ts`
**Test count:** 17

Validates all filter types on the Products grid.

| Test | Filter tested |
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
| TC-10 | Name = non-existing → 0 results |
| TC-11 | Provider key starts with "BT-SPK" |
| TC-12 | VAT = "8.10" |
| TC-13 | Combined: State "Stage 2" + Provider key "BT-SPK" |
| TC-14 | Horizontal scroll reveals hidden columns |
| TC-15 | Pagination indicator updates after filter |
| TC-16 | Price filter "< 12" |
| TC-17 | Price filter "> 12" |

---

### 9.7 Product Validations POM

**File:** `tests/product-validations-pom.spec.ts`
**Test count:** ~20

Field-level validation rules for the product form. Uses `beforeEach` to open a fresh product form for each test.

| Field | Tests |
|---|---|
| GTIN | Valid GTIN-8 accepted; invalid GTIN-8 rejected; valid/invalid GTIN-12, -13, -14 |
| Provider key | > 50 characters rejected; valid characters accepted (A-Z, 0-9, `. , ! ? - _ @`) |
| Price | Negative rejected; maximum valid accepted |
| VAT | 2.60% accepted; 8.10% accepted |
| Stock | Negative rejected; zero accepted |
| Supplementary data | Tab opens correctly |
| Media | Tab opens correctly |
| Galaxus | Tab opens correctly |
| GTIN empty | Product status becomes Invalid |
| Brand | Up to 100 characters accepted |

---

### 9.8 Product Import POM

**File:** `tests/product-import-pom.spec.ts`
**Test count:** 9

Tests CSV bulk import functionality.

| Step | Description |
|---|---|
| Step 2 | Click Import button |
| Step 3 | Try import without file — error shown |
| Step 4 | Close error and reopen import dialog |
| Step 5 | Upload valid CSV file |
| Step 6 | Run the import |
| Step 7 | Wait for import to complete |
| Step 8 | Close import popup |
| Negative | Non-CSV file upload shows error |

---

### 9.9 Stock Import POM

**File:** `tests/stock-import-pom.spec.ts`
**Test count:** 9

Tests the Stock Import (stock quantity update via CSV).

| Step | Description |
|---|---|
| Step 1 | Verify products before stock update — note baseline counts |
| Step 2 | Click Stock import button |
| Step 3 | Try import without file — error shown |
| Step 4 | Close error and reopen dialog |
| Step 5 | Upload stock update CSV |
| Step 6 | Run the stock import |
| Step 7 | Wait for completion |
| Step 8 | Close dialog + verify product list updates |
| Negative | Non-CSV file upload shows error |

---

### 9.10 Export POM

**File:** `tests/export-pom.spec.ts`
**Test count:** 11

Tests Galaxus product export workflow.

| Step | Description |
|---|---|
| Step 1 | Verify products before export |
| Step 2 | Verify Export button exists |
| Step 3 | Click Export button |
| Step 4 | Handle export confirmation dialog |
| Step 5 | Wait for export to complete |
| Step 6 | Verify export status updated |
| Step 7 | Verify products with errors not in export count |
| Step 8 | Verify export appears on Dashboard |
| Step 9 | Verify Scheduler shows next planned export |
| Negative 1 | Products with Error state not counted as exported |
| Negative 2 | Export dialog can be cancelled without exporting |

---

### 9.11 Orders POM

**File:** `tests/orders-pom.spec.ts`
**Test count:** 8

Validates the Orders list page and Excel export.

| Test | Description |
|---|---|
| Navigate to Orders | Orders page loads correctly |
| Display order data | Grid shows order rows |
| Orders page content | Key elements visible |
| Open order detail | Double-click opens order detail |
| Export without selection | All orders exported as XLSX |
| Export with 1 selected | Only selected order in XLSX |
| Export with multiple selected | Only selected orders in XLSX |
| Negative: non-existent ID | No results + no crash |
| Negative: export no rows | All exported — no crash |

---

### 9.12 Orders Filters POM

**File:** `tests/orders-filters-pom.spec.ts`
**Test count:** 11

Validates all filter types on the Orders grid. Uses a discovery test (TC-00) to detect column positions dynamically.

| Test | Description |
|---|---|
| TC-00 | Discover orders grid columns and filter row |
| TC-01 | Filter by Order ID — only that order shown |
| TC-02 | Clear filters restores full order count |
| TC-03 | Filter by Status dropdown — only matching orders |
| TC-04 | Text filter on first available text column |
| TC-05 | Date range filter |
| TC-06 | Combined ID + Status filter |
| TC-07 | Pagination text updates after filter |
| Negative 1 | Non-existent ID → no results |
| Negative 2 | Special characters in ID → no crash |
| Negative 3 | Filter then clear → full count restored |

---

### 9.13 Order Workflow POM

**File:** `tests/order-workflow-pom.spec.ts`
**Test count:** ~92 (across 3 describe blocks)

This is the most complex test suite. It covers the **full end-to-end EDI order lifecycle** across three orders, each exercising a different workflow path.

#### Architecture

```
beforeAll → discoverOrders(3)       ← Finds real order IDs from staging grid
            ↓ ORDER_1, ORDER_2, ORDER_3 populated at runtime

Each ORDER describe:
  Test 2 (delivery address) → extractPositions()  ← Reads SKUs from Order items tab
  All subsequent tests use order1/2/3Positions[]    ← No hardcoded SKUs
```

#### Key design: dynamic order discovery

No order IDs or SKUs are hardcoded. Two helper functions run at runtime:

- **`discoverOrders(count)`** — scans the orders grid `tbody` for numeric IDs (6–12 digits), returns up to `count` IDs
- **`extractPositions()`** — opens the "Order items" tab of the current order, reads provider key patterns (`[A-Z]{2,8}-[A-Z]{2,8}-?\d{2,4}`) and quantities
- **`sftpPat(type, orderId)`** — builds SFTP wait patterns: `new RegExp('GCANR.*' + ORDER_1, 'i')` instead of hardcoded `/GCANR.*61830301/i`

#### ORDER 1 — Reject/Return Workflow (32 tests)

| Phase | Tests |
|---|---|
| Discovery | Order found in overview; notification |
| Open | Delivery address verified; positions extracted |
| CANP handling | Import CANP; cancellation tab opens; order items locked; reject requires customer message |
| GCANR on SFTP | Wait for cancellation response file |
| Reject cancel | Fill reason; save; read-only after reject; GSURN-check |
| Confirm position | Set qty; save → Confirmed status; GORDR on SFTP |
| Ship | New shipment; fill carrier + shipment number; select position; GDELR on SFTP |
| RETP handling | Import RETP; return request tab; reason + amount + SKU visible; reject requires reason |
| Return rejection | Fill reason; save; GSURN on SFTP; tab read-only after reject |
| Final | Order status check |

#### ORDER 2 — Mixed CANP + Multi-Shipment + UAR Workflow (30 tests)

| Phase | Tests |
|---|---|
| Discovery | Order found in overview |
| Open | Delivery address; positions extracted |
| CANP mixed | Import CANP; approve position 1 (partial qty); reject position 2; accept position 3 |
| Save | Statuses: Cancelled / Rejected / Approved visible |
| Confirm | Confirm all open positions; GORDR + GCANR on SFTP |
| Split shipment | Shipment A — first 2 positions; carrier + shipment number; GDELR |
| Letter shipment | Shipment B — remaining position; Letter parcel type (no shipment number required); GDELR |
| Shipped status | Order becomes Shipped |
| UAR (User-Accepted Return) | Register return for position 2; status → To confirm → Confirmed; GSURN; Returned visible |
| Final | Order stays Shipped |

#### ORDER 3 — Unknown SKU + Pre-ship RETP + Full Accept Workflow (30 tests)

| Phase | Tests |
|---|---|
| Discovery | Notification; order in overview |
| Open | Status = New; delivery address; positions extracted |
| Unknown SKU | First position has Unknown status; only reject available for it |
| Reject position 1 | Click reject → Cancelling → save → Cancelled by vendor; EOLN/GCANR on SFTP |
| CANP | Import CANP; positions locked while pending; accept all 3 positions with quantities |
| GCANR | GCANR on SFTP after acceptance |
| Confirm | Confirm open positions; GORDR on SFTP |
| RETP before shipped | Import RETP; accept button disabled/errors before shipped |
| Ship all | New shipment with all positions; carrier + tracking; GDELR on SFTP |
| RETP after shipped | Accept return for position 2 → Returned; GSURN on SFTP |
| Cancel-only check | Position 1 (cancelled by vendor) — only cancel button available |
| Final status | Final order status check |

---

### 9.14 SFTP Upload POM

**File:** `tests/sftp-upload-pom.spec.ts`
**Test count:** 9

Validates the SFTP connection and EDI upload/download functionality in isolation.

| Test | Description |
|---|---|
| Connection and directory listing | Connects; lists both `partner2dg` and `dg2partner` directories |
| Upload GORDR | Uploads order confirmation XML; verifies upload |
| Upload GDELR | Uploads delivery confirmation XML |
| Upload GCANR | Uploads cancellation response (accepted) |
| Upload GSURN | Uploads return response (accepted) |
| Upload GORDP | Seeds a test order via GORDP upload |
| Upload GCANP | Simulates cancellation request |
| Upload GRETP | Simulates return request |
| Wait for platform response | Polls `dg2partner` for platform-generated response file |

> All tests skip gracefully if `SFTP_HOST` environment variable is not set.

---

## 10. Key Technical Decisions & Fixes

### 10.1 Angular SPA — Sidebar navigation required

**Problem:** Directly navigating via `page.goto(url)` causes Angular to render the component but not activate tabs. Inactive tab content is **not present in the DOM**.

**Fix:** All navigation uses sidebar menu clicks (`NavigationPage`). Tab content is only asserted after explicitly clicking the tab.

### 10.2 Angular autocomplete — `Escape` keypress after fill

**Problem:** Angular autocomplete stores the selected value in component state, not in the raw DOM `input.value`. After `fill()`, the value appeared empty to Playwright assertions.

**Fix:** `ProductFormPage.fillField()` for autocomplete fields sends `Escape` after `fill()` to commit the value:
```typescript
await input.fill(value);
await this.page.waitForTimeout(500);
await this.page.keyboard.press('Escape');
await this.page.waitForTimeout(200);
```

### 10.3 Product Create — inactive tab body text assertion

**Problem:** Step 12b (`fillMediaUrl`) navigates to the Media tab. When Steps 13/14 then checked `innerText()` for the provider key, they found only `"Product\nProduct Details\nOnline"` because the Master data tab was inactive and not rendered.

**Fix:** Steps 13 and 14 now explicitly click `await productForm.clickTab('Master data')` before asserting body text.

### 10.4 SFTP directory paths

**Correct paths** (confirmed via FileZilla inspection of the staging SFTP server):
- Upload (IN): `/uploads/stage/OrderData/Test/partner2dg`
- Read (OUT): `/uploads/stage/OrderData/Test/dg2partner`

Previous incorrect values (`/incoming`, `/outgoing`) caused SFTP file-not-found errors.

### 10.5 Dynamic order discovery — no hardcoded IDs or SKUs

**Problem:** Earlier versions hardcoded `ORDER_1 = '61830301'` etc. and SKUs like `BT-SPK-001`. When those specific orders didn't exist in staging, all related tests were skipped.

**Fix:** The suite now:
1. Calls `discoverOrders(3)` in `beforeAll` to find whatever orders exist in staging
2. Calls `extractPositions()` on the open order to read real SKUs at runtime
3. Uses `sftpPat(type, orderId)` for dynamic SFTP file patterns

### 10.6 SFTP graceful skip

All SFTP operations check `if (!sftp)` before attempting connections. If `SFTP_HOST` is not configured, tests log a skip message and continue — no crash.

### 10.7 `dotenv` in `playwright.config.ts`

Added `import * as dotenv from 'dotenv'; dotenv.config()` at the top of `playwright.config.ts` so `.env` values are available to all tests when running locally without a CI environment.

---

## 11. EDI Message Reference

| Message | Direction | Trigger | Description |
|---|---|---|---|
| GORDP | Platform → Supplier | New customer order | Order placement |
| GORDR | Supplier → Platform | Supplier confirms order | Order acceptance / confirmation |
| GDELR | Supplier → Platform | Supplier ships | Delivery / shipment confirmation |
| GCANP | Platform → Supplier | Customer cancellation request | Platform notifies supplier |
| GCANR | Supplier → Platform | Supplier responds to GCANP | Accept or reject the cancellation |
| GRETP | Platform → Supplier | Customer return request | Platform notifies supplier |
| GSURN | Supplier → Platform | Supplier responds to GRETP | Accept or reject the return |

### Order & Position Status Flow

```
Order:      New → Open → Confirmed → Shipped → Closed
Position:   To confirm → Confirmed → Shipped → Returned
                                   → Cancelling → Cancelled
```

---

## 12. Seeding Test Orders

When no suitable orders exist in staging, run the seed script to create them:

```bash
npx tsx scripts/seed-orders.ts
```

**What it does:**
1. Connects to SFTP
2. Builds GORDP XML for 3 orders with delivery address (Test Buyer, Bahnhofstrasse 1, Zurich 8001, CH)
3. Uploads each GORDP to `/uploads/stage/OrderData/Test/dg2partner`
4. The Sellon platform picks up the files and creates the orders in the staging database

**Wait:** 30–60 seconds after upload before running order-workflow tests.

> The order-workflow tests no longer depend on these specific seeded orders — `discoverOrders()` will use whatever orders it finds in the staging list.

---

*Last updated: 2026-06-11*
*Maintained by: Aamna Shoaib / ESC Team*

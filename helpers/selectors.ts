// ─── Centralized UI label constants ──────────────────────────────────────────
//
//  When Sellon renames a button, tab, or status, change it HERE only.
//  All tests and page classes reference these constants — no grep-and-replace.

// ── Ribbon / toolbar buttons ──────────────────────────────────────────────────

export const RIBBON = {
  // Shared
  EXPORT:         'Export',
  REFRESH:        'Refresh',
  CLEAR:          'Clear',
  SEARCH:         'Search',
  FILTER_SORTING: 'Filter and sorting',

  // Products page
  NEW:          'New',
  DELETE:       'Delete',
  IMPORT:       'Import',
  MASS_EDIT:    'Mass edit',
  STOCK_IMPORT: 'Stock import',

  // Orders page
  EDIT:   'Edit',
  CANCEL: 'Cancel',

  // Shipment ribbon
  CREATE_NEW_SHIPMENT: 'Create new shipment',
  NEW_SHIPMENT:        'New shipment',
} as const;

// ── Order statuses ────────────────────────────────────────────────────────────

export const ORDER_STATUS = {
  NEW:       'New',
  CONFIRMED: 'Confirmed',
  SHIPPED:   'Shipped',
  CANCELLED: 'Cancelled',
} as const;

// ── Product states ────────────────────────────────────────────────────────────

export const PRODUCT_STATE = {
  STAGE_1: 'Stage 1',
  STAGE_2: 'Stage 2',
  ERROR:   'Error',
} as const;

// ── Tab names ─────────────────────────────────────────────────────────────────

export const TAB = {
  // Product form tabs
  MASTER_DATA:       'Master data',
  PRICE_AND_STOCK:   'Price & stock',
  MEDIA:             'Media',
  SUPPLEMENTARY:     'Supplementary data',
  GALAXUS:           'Galaxus',

  // Order form tabs
  ORDER_ITEMS: 'Order items',

  // Shipping tab — Sellon uses different names depending on context
  SHIPPING_OPTIONS: ['Shipping', 'Shipment', 'Delivery', 'Lieferung', 'Versand'] as string[],
} as const;

// ── Dialog / modal button labels ──────────────────────────────────────────────

export const DIALOG = {
  YES:          'Yes',
  NO:           'No',
  OK:           'OK',
  CANCEL:       'Cancel',
  CLOSE:        'Close',
  CONFIRM:      'Confirm',
  DELETE:       'Delete',
  ADD_SHIPMENT: 'Add shipment',
} as const;

// ── Column header names (used in findColumnIndex) ─────────────────────────────

export const COLUMN = {
  // Orders table
  ID:           'ID',
  STATUS:       'Status',
  MARKETPLACE:  'Marketplace',
  TOTAL_ITEMS:  'Total items',
  TOTAL_PRICE:  'Total price',
  ORDER_NUMBER: 'Order number',
  ORDER_DATE:   'Order date',

  // Products table
  CATEGORY:       'Category',
  ACTIVE:         'Active',
  GTIN:           'GTIN',
  NAME:           'Name',
  PROVIDER_KEY:   'Provider key',
  STOCK_QUANTITY: 'Stock quantity',
  PRICE:          'Price',
  VAT:            'Vat',
  BRAND:          'Brand',
  TITLE_DE:       'titleDE',
  STATE:          'State (Galaxus)',
  EXPORT_STATUS:  'Export status',
} as const;

// ── Navigation labels ─────────────────────────────────────────────────────────

export const NAV = {
  DASHBOARD: 'Dashboard',
  ORDERS:    'Orders',
  PRODUCTS:  'Product',
  ONLINE:    'Online',
} as const;

// ── Cancel / reject order button patterns ─────────────────────────────────────

export const CANCEL_PATTERNS = [
  /cancel order/i,
  /reject order/i,
  /stornieren/i,
  /ablehnen/i,
  /cancel/i,
  /reject/i,
] as RegExp[];

// ── Confirm dialog patterns ───────────────────────────────────────────────────

export const CONFIRM_PATTERNS = [
  /yes/i,
  /confirm/i,
  /ok/i,
  /ja/i,
  /bestätigen/i,
] as RegExp[];

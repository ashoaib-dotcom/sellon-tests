// EDI message builders — openTRANS 2.1 format.
// Format derived from real GORDP/GORDR files used on stage.sellon.ch.
//
// EDI direction:
//   dg2partner  = Sellon/DG → supplier  (GORDPs: purchase orders we receive)
//   partner2dg  = supplier  → Sellon/DG (our responses: GORDR, GDELR, GCANP, etc.)

export interface EdiFile {
  content:  string;
  filename: string;
}

export interface EdiPosition {
  sku:          string;  // SUPPLIER_PID (provider key)
  qty:          number;
  price:        number;  // unit price CHF
  gtin?:        string;  // INTERNATIONAL_PID (barcode)
  buyerPid?:    string;  // BUYER_PID (Sellon/DG internal product ID)
  description?: string;
  vat?:         number;  // VAT rate, default 8.10
}

export interface ParsedOrder {
  orderId:   string;
  filename:  string;
  positions: EdiPosition[];
}

const supplierId = () => process.env.SFTP_SUPPLIER_ID || '223344';

function isoNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, '');
}

function tsCompact(): string {
  return isoNow().replace(/[-:T]/g, '').slice(0, 14);
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().replace(/\.\d{3}Z$/, '');
}

// ─── Parse an incoming GORDP XML from dg2partner ──────────────────────────────
// Returns order ID and line items, or null if the file can't be parsed.
export function parseGordpXml(content: string): ParsedOrder | null {
  const orderIdMatch = content.match(/<ORDER_ID>([^<]+)<\/ORDER_ID>/);
  if (!orderIdMatch) return null;
  const orderId = orderIdMatch[1].trim();

  const positions: EdiPosition[] = [];
  const itemRe  = /<ORDER_ITEM>([\s\S]*?)<\/ORDER_ITEM>/g;
  // Matches both <TAG> and <ns:TAG> and <TAG xmlns="...">
  const tagVal  = (tag: string, block: string) =>
    block.match(new RegExp(`<(?:[^:>]+:)?${tag}(?:\\s[^>]*)?>([^<]+)<\\/(?:[^:>]+:)?${tag}>`))?.[1]?.trim();

  let m;
  while ((m = itemRe.exec(content)) !== null) {
    const item     = m[1];
    const sku      = tagVal('SUPPLIER_PID', item);
    const qty      = parseInt(tagVal('QUANTITY', item) || '1');
    const price    = parseFloat(tagVal('PRICE_AMOUNT', item) || '0');
    const gtin     = tagVal('INTERNATIONAL_PID', item);
    const buyerPid = tagVal('BUYER_PID', item);
    if (sku) positions.push({ sku, qty, price, gtin, buyerPid });
  }

  if (positions.length === 0) return null;
  return { orderId, filename: '', positions };
}

// ─── GORDR — Order Response (openTRANS ORDERRESPONSE 2.1) ────────────────────
// Supplier confirms receipt of order.
// Upload to: partner2dg
export function buildGORDR(
  orderId:   string,
  positions: EdiPosition[],
): EdiFile {
  const now   = isoNow();
  const sid   = supplierId();
  const total = positions.reduce((s, p) => s + p.price * p.qty, 0).toFixed(2);

  const itemsXml = positions.map((p, i) => `    <ORDERRESPONSE_ITEM>
      <LINE_ITEM_ID>${i + 1}</LINE_ITEM_ID>
      <PRODUCT_ID>
        <bmecat:SUPPLIER_PID type="supplierProductKey">${p.sku}</bmecat:SUPPLIER_PID>
        <bmecat:INTERNATIONAL_PID type="gtin">${p.gtin || ''}</bmecat:INTERNATIONAL_PID>
        <bmecat:BUYER_PID type="DgProductId">${p.buyerPid || ''}</bmecat:BUYER_PID>
        <bmecat:DESCRIPTION_SHORT>${p.description || p.sku}</bmecat:DESCRIPTION_SHORT>
      </PRODUCT_ID>
      <QUANTITY>${p.qty}</QUANTITY>
      <bmecat:ORDER_UNIT>C62</bmecat:ORDER_UNIT>
      <PRODUCT_PRICE_FIX>
        <bmecat:PRICE_AMOUNT>${p.price.toFixed(2)}</bmecat:PRICE_AMOUNT>
      </PRODUCT_PRICE_FIX>
      <PRICE_LINE_AMOUNT>${(p.price * p.qty).toFixed(2)}</PRICE_LINE_AMOUNT>
    </ORDERRESPONSE_ITEM>`).join('\n');

  const content = `<?xml version="1.0" encoding="utf-8"?>
<ORDERRESPONSE xmlns="http://www.opentrans.org/XMLSchema/2.1"
               xmlns:bmecat="http://www.bmecat.org/bmecat/2005"
               version="2.1" type="standard">

  <ORDERRESPONSE_HEADER>
    <CONTROL_INFO>
      <GENERATION_DATE>${now}</GENERATION_DATE>
    </CONTROL_INFO>
    <ORDERRESPONSE_INFO>
      <ORDER_ID>${orderId}</ORDER_ID>
      <ORDERRESPONSE_DATE>${now}</ORDERRESPONSE_DATE>
      <PARTIES>
        <PARTY>
          <bmecat:PARTY_ID type="buyer_specific">406802</bmecat:PARTY_ID>
          <PARTY_ROLE>buyer</PARTY_ROLE>
        </PARTY>
        <PARTY>
          <bmecat:PARTY_ID type="buyer_specific">${sid}</bmecat:PARTY_ID>
          <PARTY_ROLE>supplier</PARTY_ROLE>
        </PARTY>
      </PARTIES>
      <ORDER_PARTIES_REFERENCE>
        <bmecat:BUYER_IDREF type="buyer_specific">406802</bmecat:BUYER_IDREF>
        <bmecat:SUPPLIER_IDREF type="buyer_specific">${sid}</bmecat:SUPPLIER_IDREF>
      </ORDER_PARTIES_REFERENCE>
      <bmecat:CURRENCY>CHF</bmecat:CURRENCY>
    </ORDERRESPONSE_INFO>
  </ORDERRESPONSE_HEADER>

  <ORDERRESPONSE_ITEM_LIST>
${itemsXml}
  </ORDERRESPONSE_ITEM_LIST>

  <ORDERRESPONSE_SUMMARY>
    <TOTAL_ITEM_NUM>${positions.length}</TOTAL_ITEM_NUM>
    <TOTAL_AMOUNT>${total}</TOTAL_AMOUNT>
  </ORDERRESPONSE_SUMMARY>

</ORDERRESPONSE>
`;
  return { content, filename: `GORDR_${sid}_${orderId}_${tsCompact()}.xml` };
}

// ─── GDELR — Delivery Notification (openTRANS DISPATCHNOTIFICATION 2.1) ───────
// Supplier confirms shipment of order.
// Upload to: partner2dg
export function buildGDELR(
  orderId:     string,
  positions:   EdiPosition[],
  shipmentRef: string,
  carrier:     string,
): EdiFile {
  const now = isoNow();
  const sid = supplierId();

  const itemsXml = positions.map((p, i) => `    <DISPATCHNOTIFICATION_ITEM>
      <LINE_ITEM_ID>${i + 1}</LINE_ITEM_ID>
      <PRODUCT_ID>
        <bmecat:SUPPLIER_PID type="supplierProductKey">${p.sku}</bmecat:SUPPLIER_PID>
        <bmecat:INTERNATIONAL_PID type="gtin">${p.gtin || ''}</bmecat:INTERNATIONAL_PID>
        <bmecat:BUYER_PID type="DgProductId">${p.buyerPid || ''}</bmecat:BUYER_PID>
        <bmecat:DESCRIPTION_SHORT>${p.description || p.sku}</bmecat:DESCRIPTION_SHORT>
      </PRODUCT_ID>
      <QUANTITY>${p.qty}</QUANTITY>
      <bmecat:ORDER_UNIT>C62</bmecat:ORDER_UNIT>
      <PACKAGE_INFO>
        <TRACKING_INFO>
          <TRACKING_ID_TYPE>other</TRACKING_ID_TYPE>
          <TRACKING_ID>${shipmentRef}</TRACKING_ID>
          <CARRIER_NAME>${carrier}</CARRIER_NAME>
        </TRACKING_INFO>
      </PACKAGE_INFO>
    </DISPATCHNOTIFICATION_ITEM>`).join('\n');

  const content = `<?xml version="1.0" encoding="utf-8"?>
<DISPATCHNOTIFICATION xmlns="http://www.opentrans.org/XMLSchema/2.1"
                      xmlns:bmecat="http://www.bmecat.org/bmecat/2005"
                      version="2.1" type="standard">

  <DISPATCHNOTIFICATION_HEADER>
    <CONTROL_INFO>
      <GENERATION_DATE>${now}</GENERATION_DATE>
    </CONTROL_INFO>
    <DISPATCHNOTIFICATION_INFO>
      <DISPATCHNOTIFICATION_ID>${shipmentRef}</DISPATCHNOTIFICATION_ID>
      <DISPATCHNOTIFICATION_DATE>${now}</DISPATCHNOTIFICATION_DATE>
      <ORDER_REFERENCE>
        <ORDER_ID>${orderId}</ORDER_ID>
      </ORDER_REFERENCE>
      <PARTIES>
        <PARTY>
          <bmecat:PARTY_ID type="buyer_specific">406802</bmecat:PARTY_ID>
          <PARTY_ROLE>buyer</PARTY_ROLE>
        </PARTY>
        <PARTY>
          <bmecat:PARTY_ID type="buyer_specific">${sid}</bmecat:PARTY_ID>
          <PARTY_ROLE>supplier</PARTY_ROLE>
        </PARTY>
      </PARTIES>
      <SHIPMENT_PARTIES_REFERENCE>
        <bmecat:BUYER_IDREF type="buyer_specific">406802</bmecat:BUYER_IDREF>
        <bmecat:SUPPLIER_IDREF type="buyer_specific">${sid}</bmecat:SUPPLIER_IDREF>
      </SHIPMENT_PARTIES_REFERENCE>
    </DISPATCHNOTIFICATION_INFO>
  </DISPATCHNOTIFICATION_HEADER>

  <DISPATCHNOTIFICATION_ITEM_LIST>
${itemsXml}
  </DISPATCHNOTIFICATION_ITEM_LIST>

  <DISPATCHNOTIFICATION_SUMMARY>
    <TOTAL_ITEM_NUM>${positions.length}</TOTAL_ITEM_NUM>
  </DISPATCHNOTIFICATION_SUMMARY>

</DISPATCHNOTIFICATION>
`;
  return { content, filename: `GDELR_${sid}_${orderId}_${tsCompact()}.xml` };
}

// ─── GCANR — Cancellation Response ────────────────────────────────────────────
// Supplier responds to a cancellation request from DG.
// Upload to: partner2dg
export function buildGCANR(orderId: string, decision: string, message: string): EdiFile {
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<EDI type="GCANR" supplierId="${supplierId()}" orderId="${orderId}" timestamp="${tsCompact()}">
  <CancellationResponse decision="${decision}">
    <Message>${message}</Message>
  </CancellationResponse>
</EDI>
`;
  return { content, filename: `GCANR_${supplierId()}_${orderId}_${tsCompact()}.xml` };
}

// ─── GSURN — Return Response ───────────────────────────────────────────────────
// Supplier responds to a return request from DG.
// Upload to: partner2dg
export function buildGSURN(
  orderId:   string,
  decision:  string,
  positions: { sku: string }[],
  message:   string,
): EdiFile {
  const posXml = positions
    .map(p => `    <Position sku="${p.sku}" decision="${decision}" />`)
    .join('\n');
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<EDI type="GSURN" supplierId="${supplierId()}" orderId="${orderId}" timestamp="${tsCompact()}">
  <ReturnResponse decision="${decision}">
    <Message>${message}</Message>
${posXml}
  </ReturnResponse>
</EDI>
`;
  return { content, filename: `GSURN_${supplierId()}_${orderId}_${tsCompact()}.xml` };
}

// ─── GCANP — Cancellation Request (supplier-initiated) ────────────────────────
// Supplier asks DG to cancel part of an order.
// Upload to: partner2dg
export function buildGCANP(orderId: string, positions: { sku: string }[], reason: string): EdiFile {
  const posXml = positions.map(p => `    <Position sku="${p.sku}" />`).join('\n');
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<EDI type="GCANP" supplierId="${supplierId()}" orderId="${orderId}" timestamp="${tsCompact()}">
  <CancellationRequest reason="${reason}">
${posXml}
  </CancellationRequest>
</EDI>
`;
  return { content, filename: `GCANP_${supplierId()}_${orderId}_${tsCompact()}.xml` };
}

// ─── GRETP — Return Request (supplier-initiated) ───────────────────────────────
// Supplier requests a return authorisation from DG.
// Upload to: partner2dg
export function buildGRETP(orderId: string, positions: { sku: string; qty: number }[], reason: string): EdiFile {
  const posXml = positions.map(p => `    <Position sku="${p.sku}" returnQty="${p.qty}" />`).join('\n');
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<EDI type="GRETP" supplierId="${supplierId()}" orderId="${orderId}" timestamp="${tsCompact()}">
  <ReturnRequest reason="${reason}">
${posXml}
  </ReturnRequest>
</EDI>
`;
  return { content, filename: `GRETP_${supplierId()}_${orderId}_${tsCompact()}.xml` };
}

// ─── GORDP — kept for reference / manual testing only ─────────────────────────
// In the real flow, GORDPs are generated by Sellon/DG (not the supplier).
// They appear in dg2partner for the supplier to download and process.
// This builder exists only if you need to craft a test GORDP for sandbox use.
export function buildGORDP(
  orderId: string,
  positions: EdiPosition[],
  deliveryAddress: {
    name:     string;
    street:   string;
    zip:      string;
    city:     string;
    country?: string;
    phone?:   string;
    email?:   string;
  },
): EdiFile {
  const now   = isoNow();
  const total = positions.reduce((s, p) => s + p.price * p.qty, 0).toFixed(2);
  const sid   = supplierId();

  const itemsXml = positions.map((p, i) => {
    const lineTotal = (p.price * p.qty).toFixed(2);
    const vat       = (p.vat ?? 8.10).toFixed(2);
    const end       = addDays(now, 7);
    return `        <ORDER_ITEM>
            <LINE_ITEM_ID>${i + 1}</LINE_ITEM_ID>
            <PRODUCT_ID>
                <SUPPLIER_PID type="supplierProductKey" xmlns="http://www.bmecat.org/bmecat/2005">${p.sku}</SUPPLIER_PID>
                <INTERNATIONAL_PID type="gtin" xmlns="http://www.bmecat.org/bmecat/2005">${p.gtin || ''}</INTERNATIONAL_PID>
                <BUYER_PID type="DgProductId" xmlns="http://www.bmecat.org/bmecat/2005">${p.buyerPid || ''}</BUYER_PID>
                <DESCRIPTION_SHORT xmlns="http://www.bmecat.org/bmecat/2005">${p.description || p.sku}</DESCRIPTION_SHORT>
            </PRODUCT_ID>
            <QUANTITY>${p.qty}</QUANTITY>
            <ORDER_UNIT xmlns="http://www.bmecat.org/bmecat/2005">C62</ORDER_UNIT>
            <PRODUCT_PRICE_FIX>
                <PRICE_AMOUNT xmlns="http://www.bmecat.org/bmecat/2005">${p.price.toFixed(2)}</PRICE_AMOUNT>
                <TAX_DETAILS_FIX>
                    <TAX_AMOUNT>${vat}</TAX_AMOUNT>
                </TAX_DETAILS_FIX>
            </PRODUCT_PRICE_FIX>
            <PRICE_LINE_AMOUNT>${lineTotal}</PRICE_LINE_AMOUNT>
            <DELIVERY_DATE type="optional">
                <DELIVERY_START_DATE>${now}</DELIVERY_START_DATE>
                <DELIVERY_END_DATE>${end}</DELIVERY_END_DATE>
            </DELIVERY_DATE>
        </ORDER_ITEM>`;
  }).join('\n');

  const country = deliveryAddress.country || 'Schweiz';
  const phone   = deliveryAddress.phone   || '+41440000000';
  const email   = deliveryAddress.email   || 'noreply@galaxus.ch';

  const content = `<?xml version="1.0" encoding="utf-8"?>
<ORDER xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
       xmlns:xsd="http://www.w3.org/2001/XMLSchema"
       version="2.1"
       type="standard"
       xmlns="http://www.opentrans.org/XMLSchema/2.1">

    <ORDER_HEADER>
        <CONTROL_INFO>
            <GENERATION_DATE>${now}</GENERATION_DATE>
        </CONTROL_INFO>

        <ORDER_INFO>
            <ORDER_ID>${orderId}</ORDER_ID>
            <ORDER_DATE>${now}</ORDER_DATE>

            <LANGUAGE xmlns="http://www.bmecat.org/bmecat/2005">ger</LANGUAGE>

            <PARTIES>
                <PARTY>
                    <PARTY_ID type="buyer_specific" xmlns="http://www.bmecat.org/bmecat/2005">406802</PARTY_ID>
                    <PARTY_ID type="gln" xmlns="http://www.bmecat.org/bmecat/2005">7640151820008</PARTY_ID>
                    <PARTY_ROLE>buyer</PARTY_ROLE>
                    <ADDRESS>
                        <NAME xmlns="http://www.bmecat.org/bmecat/2005">Digitec Galaxus AG</NAME>
                        <DEPARTMENT xmlns="http://www.bmecat.org/bmecat/2005">Accounting</DEPARTMENT>
                        <STREET xmlns="http://www.bmecat.org/bmecat/2005">Pfingstweidstrasse 60b</STREET>
                        <ZIP xmlns="http://www.bmecat.org/bmecat/2005">8005</ZIP>
                        <CITY xmlns="http://www.bmecat.org/bmecat/2005">Zürich</CITY>
                        <COUNTRY xmlns="http://www.bmecat.org/bmecat/2005">Schweiz</COUNTRY>
                        <COUNTRY_CODED xmlns="http://www.bmecat.org/bmecat/2005">CH</COUNTRY_CODED>
                        <EMAIL xmlns="http://www.bmecat.org/bmecat/2005">noreply@galaxus.ch</EMAIL>
                        <VAT_ID xmlns="http://www.bmecat.org/bmecat/2005">CHE-109.049.266</VAT_ID>
                    </ADDRESS>
                </PARTY>
                <PARTY>
                    <PARTY_ID type="buyer_specific" xmlns="http://www.bmecat.org/bmecat/2005">${sid}</PARTY_ID>
                    <PARTY_ROLE>supplier</PARTY_ROLE>
                    <ADDRESS>
                        <NAME xmlns="http://www.bmecat.org/bmecat/2005">Musterfirma AG</NAME>
                        <STREET xmlns="http://www.bmecat.org/bmecat/2005">Teststrasse 17</STREET>
                        <ZIP xmlns="http://www.bmecat.org/bmecat/2005">8000</ZIP>
                        <CITY xmlns="http://www.bmecat.org/bmecat/2005">Zürich</CITY>
                        <COUNTRY xmlns="http://www.bmecat.org/bmecat/2005">Schweiz</COUNTRY>
                        <COUNTRY_CODED xmlns="http://www.bmecat.org/bmecat/2005">CH</COUNTRY_CODED>
                        <EMAIL xmlns="http://www.bmecat.org/bmecat/2005">noreply@galaxus.ch</EMAIL>
                    </ADDRESS>
                </PARTY>
                <PARTY>
                    <PARTY_ID type="buyer_specific" xmlns="http://www.bmecat.org/bmecat/2005">2210705</PARTY_ID>
                    <PARTY_ROLE>delivery</PARTY_ROLE>
                    <ADDRESS>
                        <CONTACT_DETAILS>
                            <TITLE xmlns="http://www.bmecat.org/bmecat/2005">Herr</TITLE>
                            <FIRST_NAME xmlns="http://www.bmecat.org/bmecat/2005">${deliveryAddress.name.split(' ')[0]}</FIRST_NAME>
                            <CONTACT_NAME xmlns="http://www.bmecat.org/bmecat/2005">${deliveryAddress.name}</CONTACT_NAME>
                        </CONTACT_DETAILS>
                        <STREET xmlns="http://www.bmecat.org/bmecat/2005">${deliveryAddress.street}</STREET>
                        <ZIP xmlns="http://www.bmecat.org/bmecat/2005">${deliveryAddress.zip}</ZIP>
                        <CITY xmlns="http://www.bmecat.org/bmecat/2005">${deliveryAddress.city}</CITY>
                        <COUNTRY xmlns="http://www.bmecat.org/bmecat/2005">${country}</COUNTRY>
                        <COUNTRY_CODED xmlns="http://www.bmecat.org/bmecat/2005">CH</COUNTRY_CODED>
                        <PHONE xmlns="http://www.bmecat.org/bmecat/2005">${phone}</PHONE>
                        <EMAIL xmlns="http://www.bmecat.org/bmecat/2005">${email}</EMAIL>
                    </ADDRESS>
                </PARTY>
                <PARTY>
                    <PARTY_ID type="buyer_specific" xmlns="http://www.bmecat.org/bmecat/2005">10709476</PARTY_ID>
                    <PARTY_ROLE>marketplace</PARTY_ROLE>
                    <ADDRESS>
                        <NAME xmlns="http://www.bmecat.org/bmecat/2005">Digitec Galaxus AG</NAME>
                        <STREET xmlns="http://www.bmecat.org/bmecat/2005">Pfingstweidstrasse 60b</STREET>
                        <ZIP xmlns="http://www.bmecat.org/bmecat/2005">8005</ZIP>
                        <CITY xmlns="http://www.bmecat.org/bmecat/2005">Zürich</CITY>
                        <COUNTRY xmlns="http://www.bmecat.org/bmecat/2005">Schweiz</COUNTRY>
                        <COUNTRY_CODED xmlns="http://www.bmecat.org/bmecat/2005">CH</COUNTRY_CODED>
                        <EMAIL xmlns="http://www.bmecat.org/bmecat/2005">noreply@galaxus.ch</EMAIL>
                    </ADDRESS>
                </PARTY>
            </PARTIES>

            <CUSTOMER_ORDER_REFERENCE>
                <ORDER_ID>${orderId}</ORDER_ID>
            </CUSTOMER_ORDER_REFERENCE>

            <ORDER_PARTIES_REFERENCE>
                <BUYER_IDREF type="buyer_specific" xmlns="http://www.bmecat.org/bmecat/2005">406802</BUYER_IDREF>
                <SUPPLIER_IDREF type="buyer_specific" xmlns="http://www.bmecat.org/bmecat/2005">${sid}</SUPPLIER_IDREF>
            </ORDER_PARTIES_REFERENCE>

            <CURRENCY xmlns="http://www.bmecat.org/bmecat/2005">CHF</CURRENCY>

            <HEADER_UDX>
                <UDX.DG.CUSTOMER_TYPE>private_customer</UDX.DG.CUSTOMER_TYPE>
                <UDX.DG.DELIVERY_TYPE>direct_delivery</UDX.DG.DELIVERY_TYPE>
                <UDX.DG.IS_COLLECTIVE_ORDER>false</UDX.DG.IS_COLLECTIVE_ORDER>
                <UDX.DG.PHYSICAL_DELIVERY_NOTE_REQUIRED>false</UDX.DG.PHYSICAL_DELIVERY_NOTE_REQUIRED>
            </HEADER_UDX>

        </ORDER_INFO>
    </ORDER_HEADER>

    <ORDER_ITEM_LIST>
${itemsXml}
    </ORDER_ITEM_LIST>

    <ORDER_SUMMARY>
        <TOTAL_ITEM_NUM>${positions.length}</TOTAL_ITEM_NUM>
        <TOTAL_AMOUNT>${total}</TOTAL_AMOUNT>
    </ORDER_SUMMARY>

</ORDER>
`;
  return { content, filename: `GORDP_${sid}_${orderId}_${tsCompact()}.xml` };
}

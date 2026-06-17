// EDI message builders — openTRANS 2.1 format.
// Format derived from real GORDP files used on stage.sellon.ch.

export interface EdiFile {
  content:  string;
  filename: string;
}

export interface EdiPosition {
  sku:         string;  // SUPPLIER_PID (provider key)
  qty:         number;
  price:       number;  // unit price CHF
  gtin?:       string;  // INTERNATIONAL_PID (barcode)
  buyerPid?:   string;  // BUYER_PID (Sellon/DG internal product ID)
  description?: string;
  vat?:        number;  // VAT rate, default 8.10
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

// ─── GORDP — Order to supplier (openTRANS ORDER) ──────────────────────────────
// Upload to: partner2dg (Test or Live)
// Sellon reads this and creates the order visible in the Orders tab.
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
    const start     = now;
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
                <DELIVERY_START_DATE>${start}</DELIVERY_START_DATE>
                <DELIVERY_END_DATE>${end}</DELIVERY_END_DATE>
            </DELIVERY_DATE>
        </ORDER_ITEM>`;
  }).join('\n');

  const country    = deliveryAddress.country || 'Schweiz';
  const phone      = deliveryAddress.phone   || '+41440000000';
  const email      = deliveryAddress.email   || 'noreply@galaxus.ch';

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
                    <PARTY_ROLE>delivery</PARTY_ROLE>
                    <ADDRESS>
                        <NAME xmlns="http://www.bmecat.org/bmecat/2005">${deliveryAddress.name}</NAME>
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

  // Filename: GORDP_{supplierId}_{orderId}_{timestamp}.xml
  return { content, filename: `GORDP_${sid}_${orderId}_${tsCompact()}.xml` };
}

// ─── GORDR — Order Response (supplier confirms order) ─────────────────────────
export function buildGORDR(
  orderId: string,
  positions: { sku: string; qty: number }[],
): EdiFile {
  const posXml = positions
    .map(p => `    <Position sku="${p.sku}" confirmedQty="${p.qty}" />`)
    .join('\n');
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<EDI type="GORDR" supplierId="${supplierId()}" orderId="${orderId}" timestamp="${tsCompact()}">
  <OrderConfirmation status="Confirmed">
${posXml}
  </OrderConfirmation>
</EDI>
`;
  return { content, filename: `GORDR_${supplierId()}_${orderId}_${tsCompact()}.xml` };
}

// ─── GDELR — Delivery Confirmation (supplier ships order) ─────────────────────
export function buildGDELR(
  orderId: string,
  positions: { sku: string; qty: number }[],
  shipmentRef: string,
  carrier: string,
): EdiFile {
  const posXml = positions
    .map(p => `    <Position sku="${p.sku}" shippedQty="${p.qty}" />`)
    .join('\n');
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<EDI type="GDELR" supplierId="${supplierId()}" orderId="${orderId}" timestamp="${tsCompact()}">
  <Delivery shipmentRef="${shipmentRef}" carrier="${carrier}" shippedDate="${tsCompact()}">
${posXml}
  </Delivery>
</EDI>
`;
  return { content, filename: `GDELR_${supplierId()}_${orderId}_${tsCompact()}.xml` };
}

// ─── GCANR — Cancellation Response ────────────────────────────────────────────
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
export function buildGSURN(
  orderId: string,
  decision: string,
  positions: { sku: string }[],
  message: string,
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

// ─── GCANP — Cancellation Request ─────────────────────────────────────────────
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

// ─── GRETP — Return Request ────────────────────────────────────────────────────
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

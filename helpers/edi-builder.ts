// EDI message builders for the sellon / Lobster supplier integration.
// Each function returns the file CONTENT (string) and the FILENAME to use on SFTP.
// Customize the XML structure to match your actual EDI schema.

export interface EdiFile {
  content:  string;
  filename: string;
}

const supplierId = () => process.env.SFTP_SUPPLIER_ID || '223344';
const ts = () => new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14); // YYYYMMDDHHmmss

// ─── GORDR — Order Confirmation (supplier → platform) ─────────────────────────
// Send this after receiving a GORDP to confirm you accept the order.
export function buildGORDR(orderId: string, positions: { sku: string; qty: number }[]): EdiFile {
  const posXml = positions
    .map(p => `    <Position sku="${p.sku}" confirmedQty="${p.qty}" />`)
    .join('\n');
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<EDI type="GORDR" supplierId="${supplierId()}" orderId="${orderId}" timestamp="${ts()}">
  <OrderConfirmation status="Confirmed">
${posXml}
  </OrderConfirmation>
</EDI>
`;
  return { content, filename: `GORDR_${supplierId()}_${orderId}_${ts()}.xml` };
}

// ─── GDELR — Delivery Confirmation (supplier → platform) ──────────────────────
// Send this when goods are shipped to confirm delivery.
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
<EDI type="GDELR" supplierId="${supplierId()}" orderId="${orderId}" timestamp="${ts()}">
  <Delivery shipmentRef="${shipmentRef}" carrier="${carrier}" shippedDate="${ts()}">
${posXml}
  </Delivery>
</EDI>
`;
  return { content, filename: `GDELR_${supplierId()}_${orderId}_${ts()}.xml` };
}

// ─── GCANR — Cancellation Response (supplier → platform) ──────────────────────
// Send this in response to a GCANP cancellation request.
export function buildGCANR(orderId: string, decision: 'Accepted' | 'Rejected', message: string): EdiFile {
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<EDI type="GCANR" supplierId="${supplierId()}" orderId="${orderId}" timestamp="${ts()}">
  <CancellationResponse decision="${decision}">
    <Message>${message}</Message>
  </CancellationResponse>
</EDI>
`;
  return { content, filename: `GCANR_${supplierId()}_${orderId}_${ts()}.xml` };
}

// ─── GSURN — Return Response (supplier → platform) ────────────────────────────
// Send this in response to a GRETP return request.
export function buildGSURN(
  orderId: string,
  decision: 'Accepted' | 'Rejected',
  positions: { sku: string }[],
  message: string,
): EdiFile {
  const posXml = positions
    .map(p => `    <Position sku="${p.sku}" decision="${decision}" />`)
    .join('\n');
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<EDI type="GSURN" supplierId="${supplierId()}" orderId="${orderId}" timestamp="${ts()}">
  <ReturnResponse decision="${decision}">
    <Message>${message}</Message>
${posXml}
  </ReturnResponse>
</EDI>
`;
  return { content, filename: `GSURN_${supplierId()}_${orderId}_${ts()}.xml` };
}

// ─── GORDP — New Order (platform → supplier, normally RECEIVED not sent) ──────
// Useful for seeding test data: upload to remoteInDir to simulate a customer order.
export function buildGORDP(
  orderId: string,
  positions: { sku: string; qty: number; price: number }[],
  deliveryAddress: { name: string; street: string; city: string; zip: string; country: string },
): EdiFile {
  const posXml = positions
    .map(p => `    <Position sku="${p.sku}" qty="${p.qty}" price="${p.price}" />`)
    .join('\n');
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<EDI type="GORDP" supplierId="${supplierId()}" orderId="${orderId}" timestamp="${ts()}">
  <DeliveryAddress>
    <Name>${deliveryAddress.name}</Name>
    <Street>${deliveryAddress.street}</Street>
    <City>${deliveryAddress.city}</City>
    <Zip>${deliveryAddress.zip}</Zip>
    <Country>${deliveryAddress.country}</Country>
  </DeliveryAddress>
  <Positions>
${posXml}
  </Positions>
</EDI>
`;
  return { content, filename: `GORDP_${supplierId()}_${orderId}_${ts()}.xml` };
}

// ─── GCANP — Cancellation Request (platform → supplier, received not sent) ────
// Useful for testing: upload to simulate a cancellation request arriving.
export function buildGCANP(orderId: string, positions: { sku: string }[], reason: string): EdiFile {
  const posXml = positions
    .map(p => `    <Position sku="${p.sku}" />`)
    .join('\n');
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<EDI type="GCANP" supplierId="${supplierId()}" orderId="${orderId}" timestamp="${ts()}">
  <CancellationRequest reason="${reason}">
${posXml}
  </CancellationRequest>
</EDI>
`;
  return { content, filename: `GCANP_${supplierId()}_${orderId}_${ts()}.xml` };
}

// ─── GRETP — Return Request (platform → supplier, received not sent) ──────────
// Useful for testing: upload to simulate a return request arriving.
export function buildGRETP(orderId: string, positions: { sku: string; qty: number }[], reason: string): EdiFile {
  const posXml = positions
    .map(p => `    <Position sku="${p.sku}" returnQty="${p.qty}" />`)
    .join('\n');
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<EDI type="GRETP" supplierId="${supplierId()}" orderId="${orderId}" timestamp="${ts()}">
  <ReturnRequest reason="${reason}">
${posXml}
  </ReturnRequest>
</EDI>
`;
  return { content, filename: `GRETP_${supplierId()}_${orderId}_${ts()}.xml` };
}

import crypto from "node:crypto";

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_IMPORT_ROWS = 10000;
const EXPORT_HEADERS = ["Original Link *", "Sub_id1", "Sub_id2", "Sub_id3", "Sub_id4", "Sub_id5"];

function send(res, status, body) {
  res.status(status).setHeader("Cache-Control", "no-store").json(body);
}

function secretsMatch(actual, expected) {
  if (!actual || !expected) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && crypto.timingSafeEqual(actualBytes, expectedBytes);
}

function adminHeaders(secret, extra = {}) {
  const headers = { apikey: secret, ...extra };
  if (secret.startsWith("ey")) headers.Authorization = `Bearer ${secret}`;
  return headers;
}

function affiliateUrl(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "";
  const nested = metadata.affiliate && typeof metadata.affiliate === "object" && !Array.isArray(metadata.affiliate)
    ? metadata.affiliate
    : {};
  return [
    metadata.affiliate_url,
    metadata.affiliateUrl,
    metadata.affiliate_link,
    metadata.affiliateLink,
    nested.url,
    nested.href,
    nested.link,
  ].find((value) => typeof value === "string" && value.trim()) || "";
}

function canonicalUrl(product) {
  return `https://shopee.ph/product/${product.external_shop_id}/${product.external_product_id}`;
}

async function loadShopeeProducts(supabaseUrl, headers) {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const params = new URLSearchParams({
      select: "external_shop_id,external_product_id,metadata",
      platform: "eq.shopee",
      order: "id.asc",
      limit: String(pageSize),
      offset: String(offset),
    });
    const response = await fetch(`${supabaseUrl}/rest/v1/products?${params}`, { headers });
    if (!response.ok) throw new Error(`products_${response.status}`);
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error("products_invalid_response");
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function columnName(index) {
  let value = index + 1;
  let result = "";
  while (value) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function worksheetXml(rows) {
  const rowXml = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
      const style = rowIndex === 0 ? ' s="1"' : "";
      return `<c r="${reference}" t="inlineStr"${style}><is><t>${xmlEscape(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  const lastRow = Math.max(rows.length, 1);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:F${lastRow}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols><col min="1" max="1" width="72" customWidth="1"/><col min="2" max="6" width="18" customWidth="1"/></cols>
  <sheetData>${rowXml}</sheetData>
  <autoFilter ref="A1:F${lastRow}"/>
</worksheet>`;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipFiles(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const [name, content] of files) {
    const nameBytes = Buffer.from(name);
    const data = Buffer.from(content);
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    localParts.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }

  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

function workbookBuffer(products) {
  const rows = [EXPORT_HEADERS, ...products.map((product) => [canonicalUrl(product), "", "", "", "", ""])];
  return zipFiles([
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Missing Affiliate Links" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/worksheets/sheet1.xml", worksheetXml(rows)],
    ["xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><sz val="11"/><name val="Aptos"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`],
  ]);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else value += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(value);
      value = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      value = "";
    } else value += character;
  }
  row.push(value);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

function normalizedHeader(value) {
  return String(value || "").replace(/^\ufeff/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function productIds(value) {
  const match = String(value || "").match(/shopee\.ph\/product\/(\d+)\/(\d+)/i)
    || String(value || "").match(/shopee\.ph\/(?:[^/?#]+-)?i\.(\d+)\.(\d+)/i);
  return match ? { shopId: match[1], productId: match[2] } : null;
}

function validAffiliateUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:" && url.hostname === "s.shopee.ph" ? url.toString() : "";
  } catch {
    return "";
  }
}

function importEntries(csvText) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) throw new Error("empty_csv");
  if (rows.length - 1 > MAX_IMPORT_ROWS) throw new Error("too_many_rows");
  const headers = rows[0].map(normalizedHeader);
  const originalIndex = headers.findIndex((header) => header === "originallink");
  const convertedIndex = headers.findIndex((header) => header === "convertlink" || header === "convertedlink");
  const failedIndex = headers.findIndex((header) => header === "failedreason");
  if (originalIndex < 0 || convertedIndex < 0) throw new Error("invalid_headers");

  const entries = [];
  let failed = 0;
  let invalid = 0;
  const seen = new Set();
  for (const row of rows.slice(1)) {
    const failedReason = failedIndex >= 0 ? String(row[failedIndex] || "").trim() : "";
    if (failedReason) {
      failed += 1;
      continue;
    }
    const ids = productIds(row[originalIndex]);
    const affiliateUrl = validAffiliateUrl(row[convertedIndex]);
    if (!ids || !affiliateUrl) {
      invalid += 1;
      continue;
    }
    const key = `${ids.shopId}.${ids.productId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ shop_id: ids.shopId, product_id: ids.productId, affiliate_url: affiliateUrl });
  }
  return { entries, failed, invalid };
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") return send(res, 405, { error: "Method not allowed" });

  const expectedToken = process.env.ADMIN_HEALTH_TOKEN || "";
  const suppliedToken = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!secretsMatch(suppliedToken, expectedToken)) return send(res, 401, { error: "Unauthorized" });

  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!supabaseUrl || !secret) return send(res, 503, { error: "Affiliate tools are not configured" });

  try {
    const headers = adminHeaders(secret);
    if (req.method === "GET") {
      const products = await loadShopeeProducts(supabaseUrl, headers);
      const missing = products.filter((product) => !affiliateUrl(product.metadata));
      if (String(req.query?.action || "") === "export") {
        const workbook = workbookBuffer(missing);
        const date = new Date().toISOString().slice(0, 10);
        res.status(200);
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="PriceTrack-PH-Missing-Affiliate-Links-${date}.xlsx"`);
        return res.send(workbook);
      }
      return send(res, 200, {
        total: products.length,
        withAffiliate: products.length - missing.length,
        missing: missing.length,
      });
    }

    const csvText = typeof req.body?.csvText === "string" ? req.body.csvText : "";
    if (!csvText || Buffer.byteLength(csvText, "utf8") > MAX_IMPORT_BYTES) return send(res, 400, { error: "Select a Shopee result CSV smaller than 5 MB." });
    const parsed = importEntries(csvText);
    if (!parsed.entries.length) return send(res, 400, { error: "No valid converted Shopee links were found.", failed: parsed.failed, invalid: parsed.invalid });

    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/import_product_affiliate_links`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ entries: parsed.entries }),
    });
    if (!response.ok) throw new Error(`import_${response.status}`);
    const result = await response.json();
    const totals = Array.isArray(result) ? result[0] : result;
    return send(res, 200, {
      updated: Number(totals?.updated_count) || 0,
      skippedExisting: Number(totals?.skipped_existing_count) || 0,
      notFound: Number(totals?.not_found_count) || 0,
      failed: parsed.failed,
      invalid: parsed.invalid,
    });
  } catch (error) {
    console.error("Admin affiliate link operation failed", error);
    const message = error instanceof Error ? error.message : "";
    if (message === "empty_csv") return send(res, 400, { error: "The selected CSV has no result rows." });
    if (message === "too_many_rows") return send(res, 400, { error: "The CSV exceeds Shopee's 10,000-link batch limit." });
    if (message === "invalid_headers") return send(res, 400, { error: "This is not a Shopee Custom Link result CSV." });
    return send(res, 502, { error: "Unable to process affiliate links" });
  }
}

/**
 * 极简 XLSX 读写（零依赖，仅用 Node 内置 zlib）
 *
 * 导出：生成单表 .xlsx（inlineStr，无需 sharedStrings）
 * 导入：解析 .xlsx 首个工作表（支持 inlineStr / sharedStrings / 数字）
 *
 * 仅覆盖本项目所需：一行表头 + 数据行，无样式、无公式。
 */
'use strict';
const zlib = require('zlib');

/* ---------------- CRC32 ---------------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

/* ---------------- ZIP 写入 ---------------- */
function zipWrite(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const comp = zlib.deflateRawSync(raw);
    const crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    chunks.push(lh, nameBuf, comp);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([ch, nameBuf]));

    offset += lh.length + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, cd, eocd]);
}

/* ---------------- ZIP 读取 ---------------- */
function zipRead(buf) {
  // 从尾部找 EOCD
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 zip/xlsx 文件');
  const total = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const fnLen = buf.readUInt16LE(off + 28);
    const exLen = buf.readUInt16LE(off + 30);
    const cmLen = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    const name = buf.slice(off + 46, off + 46 + fnLen).toString('utf8');
    // 本地头
    const lfn = buf.readUInt16LE(lho + 26);
    const lex = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + lfn + lex;
    const data = buf.slice(start, start + compSize);
    out[name] = method === 8 ? zlib.inflateRawSync(data) : data;
    off += 46 + fnLen + exLen + cmLen;
  }
  return out;
}

/* ---------------- 列号 <-> 字母 ---------------- */
function colName(n) { // 0-based -> A, B, ... AA
  let s = '';
  n++;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function colIndex(ref) {
  const m = /^([A-Z]+)/.exec(ref);
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
  // 去掉 XML 非法控制字符
  .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

/* ---------------- 生成 xlsx ---------------- */
function buildXlsx(header, rows) {
  const all = [header, ...rows];
  const sheetRows = all.map((row, ri) => {
    const cells = row.map((v, ci) => {
      const ref = colName(ci) + (ri + 1);
      if (v === null || v === undefined || v === '') return `<c r="${ref}"/>`;
      const isNum = typeof v === 'number' || (/^-?\d+(\.\d+)?$/.test(String(v)) && String(v).trim() !== '');
      if (isNum) return `<c r="${ref}"><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    }).join('');
    return `<row r="${ri + 1}">${cells}</row>`;
  }).join('');

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`;

  const files = [
    {
      name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    },
    {
      name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
  ];
  return zipWrite(files);
}

/* ---------------- 解析 xlsx ---------------- */
function unesc(s) {
  return String(s == null ? '' : s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function parseXlsx(buf) {
  const files = zipRead(buf);
  // 共享字符串
  let shared = [];
  if (files['xl/sharedStrings.xml']) {
    const ss = files['xl/sharedStrings.xml'].toString('utf8');
    for (const si of ss.match(/<si>[\s\S]*?<\/si>/g) || []) {
      const t = (si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [])
        .map((x) => unesc(x.replace(/<[^>]+>/g, ''))).join('');
      shared.push(t);
    }
  }
  // 第一个工作表
  let sheetName = 'xl/worksheets/sheet1.xml';
  if (!files[sheetName]) {
    const k = Object.keys(files).find((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
    if (!k) throw new Error('未找到工作表');
    sheetName = k;
  }
  const xml = files[sheetName].toString('utf8');
  const rows = [];
  for (const rm of xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) || []) {
    const cells = [];
    for (const cm of rm.match(/<c[^>]*?\/>|<c[^>]*>[\s\S]*?<\/c>/g) || []) {
      const refM = /r="([A-Z]+\d+)"/.exec(cm);
      const ci = refM ? colIndex(refM[1]) : cells.length;
      let val = '';
      if (/t="inlineStr"/.test(cm)) {
        val = (cm.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map((x) => unesc(x.replace(/<[^>]+>/g, ''))).join('');
      } else {
        const vm = /<v>([\s\S]*?)<\/v>/.exec(cm);
        if (vm) {
          const raw = vm[1];
          if (/t="s"/.test(cm)) {
            const idx = parseInt(raw, 10);
            val = shared[idx] != null ? shared[idx] : '';
          } else val = unesc(raw);
        }
      }
      cells[ci] = val;
    }
    rows.push(cells);
  }
  // 补齐空洞
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  return rows.map((r) => {
    const out = [];
    for (let i = 0; i < width; i++) out.push(r[i] === undefined ? '' : r[i]);
    return out;
  });
}

module.exports = { buildXlsx, parseXlsx };

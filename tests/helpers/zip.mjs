// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A ZIP archive built in a test (deflated, as Office writes them), and a small Word document made with it.
import zlib from 'node:zlib';

/** A ZIP archive of { name: text } (deflated, as Office writes them). */
export function zip(files) {
  const locals = [], central = [];
  let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text), data = zlib.deflateRawSync(raw), n = Buffer.from(name);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8);
    h.writeUInt32LE(zlib.crc32(raw), 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(zlib.crc32(raw), 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    locals.push(h, n, data); central.push(c, n); off += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(central.length / 2, 8); e.writeUInt16LE(central.length / 2, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, e]);
}
const W = (body, extra = '') => `<?xml version="1.0"?><w:document xmlns:w="w"><w:body>${body}</w:body></w:document>${extra}`;
export const DOCX = zip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': W('<w:p><w:r><w:t>Quarterly report</w:t></w:r></w:p><w:p><w:r><w:t>Revenue</w:t></w:r><w:r><w:tab/><w:t xml:space="preserve">12 &amp; up</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'),
  'word/footer1.xml': '<w:ftr xmlns:w="w"><w:p><w:r><w:t>Page footer</w:t></w:r></w:p></w:ftr>' });

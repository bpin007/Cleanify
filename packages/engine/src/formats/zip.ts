/**
 * Lists the file names inside a zip (an .xlsx is a zip) by reading its central
 * directory. Nothing is decompressed, so this is cheap and safe on any file.
 */
export function zipEntryNames(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End of central directory record: signature 0x06054b50, at least 22 bytes from the end.
  let eocd = -1;
  const lowest = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= lowest; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return [];
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const names: string[] = [];
  const utf8 = new TextDecoder();
  for (let n = 0; n < count && p + 46 <= bytes.length; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    names.push(utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen)));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

/** Parts of an .xlsx that ExcelJS can't write back, by what the user would call them. */
export function partsDroppedOnExport(names: readonly string[]): string[] {
  const found: string[] = [];
  const has = (re: RegExp) => names.some((n) => re.test(n));
  if (has(/^xl\/charts\/chart\d*\.xml$/i) || has(/^xl\/chartsheets\//i)) found.push('charts');
  if (has(/^xl\/pivotTables\//i) || has(/^xl\/pivotCache\//i)) found.push('pivot tables');
  if (has(/^xl\/slicers\//i) || has(/^xl\/timelines\//i)) found.push('slicers and timelines');
  if (has(/^xl\/vbaProject\.bin$/i)) found.push('macros');
  return found;
}

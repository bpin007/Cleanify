import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { Change } from '../src/index';

/** The 27 characters Windows-1252 puts in 0x80–0x9F (section 19 #14). */
export const CP1252_SPECIALS = [...'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'];

const CP1252_HIGH: Record<number, string> = {
  0x80: '€',
  0x82: '‚',
  0x83: 'ƒ',
  0x84: '„',
  0x85: '…',
  0x86: '†',
  0x87: '‡',
  0x88: 'ˆ',
  0x89: '‰',
  0x8a: 'Š',
  0x8b: '‹',
  0x8c: 'Œ',
  0x8e: 'Ž',
  0x91: '‘',
  0x92: '’',
  0x93: '“',
  0x94: '”',
  0x95: '•',
  0x96: '–',
  0x97: '—',
  0x98: '˜',
  0x99: '™',
  0x9a: 'š',
  0x9b: '›',
  0x9c: 'œ',
  0x9e: 'ž',
  0x9f: 'Ÿ',
};

/** Test-side reference: bytes → text as Windows-1252 (undefined bytes become C1 controls). */
export function decodeCp1252(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += CP1252_HIGH[b] ?? String.fromCharCode(b);
  return s;
}

export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

/** Simulates the classic bug: UTF-8 text opened as Windows-1252. */
export const mojibake = (s: string): string => decodeCp1252(utf8(s));

export function bytes(...parts: (number[] | Uint8Array | string)[]): Uint8Array {
  const out: number[] = [];
  for (const p of parts) out.push(...(typeof p === 'string' ? utf8(p) : p));
  return Uint8Array.from(out);
}

export function utf16(s: string, endian: 'le' | 'be'): Uint8Array {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const hi = c >> 8;
    const lo = c & 0xff;
    out[i * 2] = endian === 'le' ? lo : hi;
    out[i * 2 + 1] = endian === 'le' ? hi : lo;
  }
  return out;
}

export const byStage = (changes: Change[], stage: Change['stage']) =>
  changes.filter((c) => c.stage === stage);

const fixturesDir = fileURLToPath(new URL('./fixtures/', import.meta.url));

export function readCorpus(): { name: string; text: string }[] {
  const dir = join(fixturesDir, 'corpus');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.txt'))
    .sort()
    .map((f) => ({ name: f, text: readFileSync(join(dir, f), 'utf8') }));
}

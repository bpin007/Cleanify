import { describe, expect, it } from 'vitest';
import { UnencodableError, decode, encodeText, loadIconvEncoder } from '../src/index';

describe('iconv-lite encoder (decision D1)', () => {
  it('writes Shift-JIS that decodes back to the same text', async () => {
    const enc = await loadIconvEncoder();
    const bytes = encodeText('テスト ok', 'shift_jis', 0, enc);
    expect([...bytes.slice(0, 2)]).toEqual([0x83, 0x65]);
    expect(decode(bytes, 'shift_jis').text).toBe('テスト ok');
  });

  it('blocks the save, listing the characters Shift-JIS does not have', async () => {
    const enc = await loadIconvEncoder();
    let error: unknown;
    try {
      encodeText('日本 😀 é', 'shift_jis', 0, enc);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(UnencodableError);
    expect((error as UnencodableError).chars).toEqual([
      { char: '😀', offset: 3 },
      { char: 'é', offset: 6 },
    ]);
  });
});

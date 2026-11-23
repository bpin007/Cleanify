/** Output encodings offered on save (PROJECT.md section 7, decision D1). */
import type { EncodingName } from '@cleanify/engine';
import type { SourceInfo } from '@cleanify/session';
import { ENCODING_LABELS } from './labels';

export interface Option {
  key: string;
  label: string;
  encoding: EncodingName;
  bomCount: number;
}

/** Encodings offered for saving. Shift-JIS is written by iconv-lite, loaded only when chosen. */
const SAVABLE: EncodingName[] = ['utf-8', 'windows-1252', 'utf-16le', 'utf-16be', 'shift_jis'];

export function saveOptions(source: SourceInfo, suggested: EncodingName): Option[] {
  const inputBom = source.bomCount > 0 ? 1 : 0;
  const opt = (encoding: EncodingName, bomCount: number): Option => ({
    key: `${encoding}:${bomCount}`,
    encoding,
    bomCount,
    label:
      ENCODING_LABELS[encoding]! +
      (encoding === 'utf-8' && bomCount ? ' with BOM' : '') +
      (encoding === source.encoding && bomCount === inputBom ? ' (same as the input)' : ''),
  });
  const list: Option[] = [];
  const add = (o: Option) => {
    if (!list.some((x) => x.key === o.key)) list.push(o);
  };
  const bomFor = (e: EncodingName) =>
    e.startsWith('utf-16') || e.startsWith('utf-32') ? 1 : e === source.encoding ? inputBom : 0;
  if (SAVABLE.includes(suggested) || suggested.startsWith('utf-32'))
    add(opt(suggested, bomFor(suggested)));
  add(opt('utf-8', 0));
  add(opt('utf-8', 1));
  if (
    source.encoding &&
    (SAVABLE.includes(source.encoding) || source.encoding.startsWith('utf-32'))
  )
    add(opt(source.encoding, bomFor(source.encoding)));
  add(opt('windows-1252', 0));
  add(opt('utf-16le', 1));
  add(opt('shift_jis', 0));
  return list;
}

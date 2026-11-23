import { describe, expect, it } from 'vitest';
import { checkFile, cleanedName } from '../src/lib/files';
import { formatBytes, locationLabel, summary } from '../src/lib/labels';
import { markerFor, showInvisible, withMarkers } from '../src/lib/markers';

describe('markers', () => {
  it('draws invisible characters as visible markers', () => {
    expect(showInvisible('a b​c')).toBe('a·NBSP·b⟨ZWSP⟩c');
    expect(markerFor(0x07)).toBe('⟨U+0007⟩');
    expect(markerFor(0xe0041)).toBe('⟨TAG U+E0041⟩');
    expect(markerFor(0x41)).toBeNull();
    expect(markerFor(0x0a)).toBeNull();
    expect(markerFor(0xfe0f)).toBeNull();
  });

  it('splits into plain runs and markers with a title', () => {
    expect(withMarkers('x﻿y')).toEqual([
      { text: 'x', marker: false },
      { text: '⟨BOM⟩', marker: true, title: 'U+FEFF (invisible character)' },
      { text: 'y', marker: false },
    ]);
  });
});

describe('labels', () => {
  it('summarises counts per stage in plan order', () => {
    expect(summary({ invisible: 3, encoding: 42, ascii: 1 })).toBe(
      '42 encoding fixes · 1 accent or symbol · 3 invisible characters',
    );
    expect(summary({})).toBe('No changes');
    expect(summary({ safety: 1200 })).toBe('1,200 formula guards');
  });

  it('labels locations', () => {
    expect(locationLabel({ type: 'text', line: 3, column: 5, offset: 0 })).toBe('Line 3, column 5');
    expect(locationLabel({ type: 'csv', row: 2, column: 3, header: 'city', charPos: 4 })).toBe(
      'Row 2, column 3 (city), character 4',
    );
    expect(locationLabel({ type: 'csv', row: 1, column: 1, charPos: 1 })).toBe('Row 1, column 1');
    expect(locationLabel({ type: 'sheet', sheet: 'S', cell: 'B4', charPos: 1 })).toBe('S!B4');
    expect(locationLabel({ type: 'sheet', sheet: 'S', cell: 'B4', charPos: 2 })).toBe(
      'S!B4, character 2',
    );
  });

  it('formats sizes', () => {
    expect([formatBytes(10), formatBytes(2048), formatBytes(3 * 1024 * 1024)]).toEqual([
      '10 B',
      '2.0 KB',
      '3.0 MB',
    ]);
  });
});

describe('files', () => {
  it('accepts text and CSV files, flags large ones, explains the rest', () => {
    expect(checkFile('a.CSV', 10)).toEqual({ ok: true, format: 'csv', large: false });
    expect(checkFile('notes.md', 60 * 1024 * 1024)).toEqual({
      ok: true,
      format: 'text',
      large: true,
    });
    for (const name of ['book.xlsx', 'old.XLS', 'calc.ods', 'shop.accdb', 'legacy.mdb'])
      expect(checkFile(name, 1)).toEqual({ ok: true, format: 'sheet', large: false });
    const xlsm = checkFile('macro.xlsm', 1);
    expect(!xlsm.ok && xlsm.reason).toMatch(/Save it as \.xlsx/);
    expect(checkFile('photo.png', 1).ok).toBe(false);
    expect(checkFile('Makefile', 1).ok).toBe(false);
  });

  it('names the cleaned file', () => {
    expect(cleanedName('report.csv')).toBe('report-clean.csv');
    expect(cleanedName('README')).toBe('README-clean');
    expect(cleanedName(null)).toBe('cleaned.txt');
    expect(cleanedName('book.xlsx', 'sheet')).toBe('book-clean.xlsx');
    expect(cleanedName('old.xls', 'sheet')).toBe('old-clean.xlsx');
    expect(cleanedName('shop.accdb', 'sheet')).toBe('shop-clean.xlsx');
  });
});

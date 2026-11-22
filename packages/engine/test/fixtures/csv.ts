/**
 * CSV round-trip fixtures (section 19 #1, #2, #17). Written as explicit strings so
 * every CR, LF, BOM and quote is visible. `rows` is the expected record count.
 */
export interface CsvFixture {
  name: string;
  source: string;
  rows: number;
  delimiter?: string;
}

export const CSV_FIXTURES: CsvFixture[] = [
  { name: 'simple LF, trailing newline', source: 'a,b,c\n1,2,3\n', rows: 2 },
  { name: 'simple LF, no trailing newline', source: 'a,b,c\n1,2,3', rows: 2 },
  { name: 'CRLF, trailing newline', source: 'a,b,c\r\n1,2,3\r\n', rows: 2 },
  { name: 'CRLF, no trailing newline', source: 'a,b,c\r\n1,2,3', rows: 2 },
  {
    name: 'quoted field with comma (reference bug #1)',
    source: 'name,city\n"Smith, John",Paris\n"Doe, Jane","São Paulo"\n',
    rows: 3,
  },
  {
    name: 'escaped quotes inside quoted field',
    source: 'id,quote\n1,"She said ""hi"""\n2,"""quoted"" start"\n',
    rows: 3,
  },
  {
    name: 'newline inside quoted field',
    source: 'id,note\r\n1,"line one\r\nline two"\r\n2,plain\r\n',
    rows: 3,
  },
  {
    name: 'unnecessarily quoted fields are kept quoted',
    source: '"a","b"\n"1","2"\n',
    rows: 2,
  },
  { name: 'empty fields and empty quoted fields', source: 'a,,c\n,"",\n', rows: 2 },
  { name: 'UTF-8 accents and emoji', source: 'name,mood\nCafé,😀\nMüller,ok\n', rows: 3 },
  { name: 'semicolon delimiter', source: 'a;b\n"x;y";2\n', rows: 2, delimiter: ';' },
  { name: 'tab delimiter', source: 'a\tb\n"x\ty"\t2\n', rows: 2, delimiter: '\t' },
  { name: 'trailing spaces outside quotes kept', source: 'a, b ,c\n1, 2 ,3\n', rows: 2 },
  { name: 'single column, blank last line', source: 'x\n1\n2\n', rows: 3 },
];

/**
 * Single-purpose tool pages (PROJECT.md section 8, site map): the same engine and tool
 * with the switches preset, plus a short explanation for people who arrive from search.
 */
import type { CleanSettings } from '@cleanify/session';

export interface ToolSection {
  heading: string;
  body: string[];
}

export interface Tool {
  slug: string;
  /** Short name for links. */
  name: string;
  title: string;
  intro: string;
  /** Switch settings applied when the page opens (the user can still change them). */
  preset: Partial<Omit<CleanSettings, 'asciiOptions'>>;
  placeholder?: string;
  example?: { before: string; after: string };
  sections: ToolSection[];
  /** Not available yet: the page explains and links to what works today. */
  comingSoon?: string;
}

export const TOOLS: Tool[] = [
  {
    slug: 'fix-garbled-text',
    name: 'Fix garbled text',
    title: 'Fix garbled text (mojibake)',
    intro:
      'Turns text like “CafÃ©” and “donâ€™t” back into “Café” and “don’t”. This happens when a file saved as UTF-8 is opened as Windows-1252 or Latin-1.',
    preset: { repair: true, ascii: false },
    placeholder: 'Paste garbled text, e.g. donâ€™t or CafÃ©…',
    example: { before: 'Ã‰tÃ© â€“ donâ€™t miss the cafÃ©', after: 'Été – don’t miss the café' },
    sections: [
      {
        heading: 'How it works',
        body: [
          'Each garbled run is checked by turning it back into bytes and reading them correctly. A repair is only proposed when the result is real, readable text.',
          'Valid text in French, German, Polish, Turkish, Chinese or Arabic is left alone. Unclear cases are shown with a reason and are not applied unless you accept them.',
        ],
      },
      {
        heading: 'What you can open',
        body: [
          'Pasted text, text files, CSV, Excel (.xlsx, .xls), OpenDocument (.ods) and Access (.accdb, .mdb). The file’s encoding is detected and shown, and you can pick another one if the guess is wrong.',
        ],
      },
    ],
  },
  {
    slug: 'remove-accents',
    name: 'Remove accents',
    title: 'Remove accents and convert to plain ASCII',
    intro:
      'Changes “Crème brûlée” to “Creme brulee”, smart quotes to straight quotes and symbols like € to EUR, for systems that only accept plain ASCII.',
    preset: { repair: true, ascii: true, asciiScope: 'all' },
    placeholder: 'Paste text with accents, e.g. Crème brûlée…',
    example: { before: '“Crème brûlée” – 5 €', after: '"Creme brulee" - 5 EUR' },
    sections: [
      {
        heading: 'What changes',
        body: [
          'Accented letters lose their accents (é → e), special letters are spelled out (ß → ss, Æ → AE), smart quotes and dashes become plain ones, and symbols become text (€ → EUR, ™ → TM).',
          'Other alphabets such as Cyrillic or Greek are kept as they are unless you choose to write them in Latin letters. Emoji are kept unless you choose otherwise.',
        ],
      },
      {
        heading: 'Nothing is hidden',
        body: [
          'Every change is listed. If some characters still aren’t ASCII when you’re done, you’ll see how many and where.',
        ],
      },
    ],
  },
  {
    slug: 'remove-invisible-characters',
    name: 'Remove invisible characters',
    title: 'Remove invisible characters',
    intro:
      'Finds and removes zero-width spaces, non-breaking spaces, byte order marks and control characters: the invisible things that break searches, imports and comparisons.',
    preset: { repair: true, ascii: true, asciiScope: 'invisible' },
    placeholder: 'Paste text that behaves strangely…',
    sections: [
      {
        heading: 'What it finds',
        body: [
          'Zero-width spaces and joiners, non-breaking spaces, soft hyphens, stray byte order marks, control characters, and hidden “tag” characters that can carry invisible text.',
          'Joiners that real words need, for example in Persian or Hindi, are kept. Emoji sequences are kept intact.',
        ],
      },
      {
        heading: 'See them before they go',
        body: [
          'Invisible characters are drawn as visible markers such as ·NBSP· and ⟨ZWSP⟩ in the before/after view, so you can check each one. Accents and other letters are not touched on this page.',
        ],
      },
    ],
  },
  {
    slug: 'translate-to-english',
    name: 'Translate to English',
    title: 'Translate to English',
    intro:
      'Translates the parts of your text or file that aren’t in English, and leaves numbers, emails, links and IDs exactly as they are.',
    preset: { repair: true, ascii: false },
    comingSoon:
      'Translation needs our server, so it arrives with the cloud features in a later update. You can already repair and clean your text below.',
    // Privacy details are added with the feature (owner decision, Phase 2 review).
    sections: [],
  },
  {
    slug: 'csv-cleaner',
    name: 'CSV cleaner',
    title: 'CSV cleaner',
    intro:
      'Repairs garbled text and removes invisible characters in CSV and TSV files, without breaking the file: only the cells that change are rewritten.',
    preset: { repair: true, ascii: false },
    placeholder: 'Paste CSV, or drop a .csv or .tsv file…',
    sections: [
      {
        heading: 'Your file stays your file',
        body: [
          'The delimiter, quoting, line endings and byte order mark are kept. With nothing accepted, the download is byte-for-byte the same as your file.',
          'Changes are listed by row and column, with the column name from the header row.',
        ],
      },
      {
        heading: 'Safe to open in a spreadsheet',
        body: [
          'Text cells that start with =, +, - or @ could run as formulas in Excel. They get a leading apostrophe, shown as a change you can reject. Real numbers like -42 are never changed.',
        ],
      },
    ],
  },
  {
    slug: 'excel-cleaner',
    name: 'Excel cleaner',
    title: 'Excel cleaner',
    intro:
      'Cleans the text cells of Excel, OpenDocument and Access files and gives you back an .xlsx. Numbers, dates and formulas are never touched.',
    preset: { repair: true, ascii: false },
    placeholder: 'Drop an .xlsx, .xls, .ods, .accdb or .mdb file…',
    sections: [
      {
        heading: 'What is kept',
        body: [
          '.xlsx files keep their formulas, number formats, dates, styles and merged cells. Only text cells change, including rich text, where each part keeps its font.',
          '.xls and .ods files keep values, formulas, number formats and merged cells, but not styles. Access databases become one sheet per table, with the column names as the first row.',
        ],
      },
      {
        heading: 'What you’re warned about',
        body: [
          'Charts and pivot tables can’t be written back. If your workbook has them, you’ll see a warning before you download.',
        ],
      },
    ],
  },
];

export const toolBySlug = (slug: string | undefined) => TOOLS.find((t) => t.slug === slug);

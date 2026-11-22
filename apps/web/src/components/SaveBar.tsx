/**
 * Download and copy (PROJECT.md section 8, step 6) with the output encoding choice
 * (section 7, decision D1): if some characters don't fit, the save is blocked and
 * they are listed, with "Save as UTF-8 instead".
 */
import * as Dialog from '@radix-ui/react-dialog';
import type { EncodingName } from '@cleanify/engine';
import { Check, Copy, Download } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import type { SourceInfo, UnencodableItem } from '../engine/protocol';
import { cleanedName } from '../lib/files';
import { ENCODING_LABELS } from '../lib/labels';
import { saveOptions } from '../lib/save';
import { showInvisible } from '../lib/markers';
import type { SaveResult } from '../session/SessionContext';

function downloadBytes(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(
    new Blob([bytes as BlobPart], { type: 'application/octet-stream' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface Props {
  source: SourceInfo;
  suggested: EncodingName;
  outputText: () => Promise<string>;
  save: (encoding: EncodingName, bomCount: number) => Promise<SaveResult>;
}

export function SaveBar({ source, suggested, outputText, save }: Props) {
  const options = useMemo(() => saveOptions(source, suggested), [source, suggested]);
  const [key, setKey] = useState(options[0]!.key);
  const [blocked, setBlocked] = useState<{
    encoding: EncodingName;
    chars: UnencodableItem[];
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const selectId = useId();
  const choice = options.find((o) => o.key === key) ?? options[0]!;
  const fileName = cleanedName(source.encoding === null ? null : source.name);

  const doSave = async (encoding: EncodingName, bomCount: number) => {
    setProblem(null);
    try {
      const r = await save(encoding, bomCount);
      if (r.ok) {
        downloadBytes(r.bytes, fileName);
        setBlocked(null);
      } else setBlocked({ encoding: r.encoding, chars: r.chars });
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  };

  const doCopy = async () => {
    setProblem(null);
    try {
      await navigator.clipboard.writeText(await outputText());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setProblem('Could not copy: your browser blocked clipboard access. Use Download instead.');
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={selectId} className="text-sm text-muted">
        Save as
      </label>
      <select
        id={selectId}
        value={choice.key}
        onChange={(e) => setKey(e.target.value)}
        className="rounded-lg border border-border bg-surface px-2 py-2 text-sm"
      >
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => doSave(choice.encoding, choice.bomCount)}
        className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90"
      >
        <Download aria-hidden="true" className="size-4" /> Download
      </button>
      <button
        type="button"
        onClick={doCopy}
        className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-surface-2"
      >
        {copied ? (
          <Check aria-hidden="true" className="size-4" />
        ) : (
          <Copy aria-hidden="true" className="size-4" />
        )}
        {copied ? 'Copied' : 'Copy'}
      </button>
      <span aria-live="polite" className="sr-only">
        {copied ? 'Copied to the clipboard' : ''}
      </span>
      {problem && (
        <p role="alert" className="w-full text-sm text-fix-invisible-text">
          {problem}
        </p>
      )}

      <Dialog.Root open={blocked !== null} onOpenChange={(o) => !o && setBlocked(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 grid max-h-[80vh] w-[min(92vw,32rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-hidden rounded-xl border border-border bg-surface p-5 text-text shadow-xl">
            <Dialog.Title className="text-lg font-semibold">
              {blocked?.chars.length === 500 ? '500+' : blocked?.chars.length} character
              {blocked?.chars.length === 1 ? '' : 's'} won’t fit in{' '}
              {blocked ? ENCODING_LABELS[blocked.encoding] : ''}
            </Dialog.Title>
            <Dialog.Description className="text-sm text-muted">
              Saving would replace them with “?”, so the file wasn’t saved. Save as UTF-8, which
              holds every character, or go back and change them.
            </Dialog.Description>
            <ul className="grid max-h-60 gap-1 overflow-auto rounded-lg border border-border p-2 text-sm">
              {blocked?.chars.map((c, i) => (
                <li key={i} className="flex gap-3">
                  <span className="w-10 font-mono">{showInvisible(c.char)}</span>
                  <span className="text-muted">
                    Line {c.line}, column {c.column}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap justify-end gap-2">
              <Dialog.Close className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-surface-2">
                Go back
              </Dialog.Close>
              <button
                type="button"
                onClick={() => doSave('utf-8', 0)}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90"
              >
                Save as UTF-8 instead
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

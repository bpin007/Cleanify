/** Paste box and drop zone in one (PROJECT.md section 9, components). */
import { FileText, Upload, X } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import type { InputFormat } from '../engine/protocol';
import { ACCEPT, checkFile } from '../lib/files';
import { formatBytes } from '../lib/labels';

export type DraftInput =
  | { kind: 'paste'; text: string }
  | { kind: 'file'; file: File; format: InputFormat; large: boolean };

interface Props {
  value: DraftInput;
  onChange: (v: DraftInput) => void;
  placeholder?: string | undefined;
}

export function PasteDrop({ value, onChange, placeholder }: Props) {
  const [dragging, setDragging] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const hintId = useId();

  const pick = (file: File | undefined) => {
    if (!file) return;
    const check = checkFile(file.name, file.size);
    if (!check.ok) {
      setProblem(check.reason);
      return;
    }
    setProblem(null);
    onChange({ kind: 'file', file, format: check.format, large: check.large });
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files[0]);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
      data-testid="drop-zone"
      className={
        'relative rounded-xl border bg-surface transition-colors ' +
        (dragging ? 'border-accent ring-2 ring-accent/30' : 'border-border')
      }
    >
      {value.kind === 'file' ? (
        <div className="flex min-h-64 flex-col items-center justify-center gap-3 p-6 text-center">
          <FileText aria-hidden="true" className="size-10 text-muted" />
          <div>
            <p className="font-medium break-all">{value.file.name}</p>
            <p className="text-sm text-muted">
              {value.format === 'csv' ? 'CSV' : value.format === 'sheet' ? 'Spreadsheet' : 'Text'}{' '}
              file · {formatBytes(value.file.size)}
            </p>
          </div>
          {value.large && (
            <p role="status" className="max-w-md text-sm text-fix-encoding-text">
              This file is over 50 MB. It is processed on your device, which may be slow or run out
              of memory on some computers.
            </p>
          )}
          <button
            type="button"
            onClick={() => onChange({ kind: 'paste', text: '' })}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted hover:bg-surface-2 hover:text-text"
          >
            <X aria-hidden="true" className="size-4" /> Remove file
          </button>
        </div>
      ) : (
        <textarea
          aria-label="Text to clean"
          aria-describedby={hintId}
          value={value.text}
          onChange={(e) => onChange({ kind: 'paste', text: e.target.value })}
          placeholder={placeholder ?? 'Paste text here, or drop a file…'}
          spellCheck={false}
          className="block min-h-64 w-full resize-y rounded-xl bg-transparent p-4 font-mono text-sm outline-none placeholder:text-muted"
        />
      )}

      {dragging && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-accent-bg/90 text-accent-text">
          <span className="flex items-center gap-2 font-medium">
            <Upload aria-hidden="true" className="size-5" /> Drop to open
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-sm">
        <p id={hintId} className="text-muted">
          Text, CSV, Excel (.xlsx, .xls), OpenDocument (.ods) or Access (.accdb, .mdb) files.
          Nothing is uploaded.
        </p>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 font-medium hover:bg-surface-2"
        >
          <Upload aria-hidden="true" className="size-4" /> Choose a file
        </button>
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          data-testid="file-input"
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>

      {problem && (
        <p
          role="alert"
          className="border-t border-border px-4 py-2.5 text-sm text-fix-invisible-text"
        >
          {problem}
        </p>
      )}
    </div>
  );
}

/**
 * The tool itself (PROJECT.md section 8): paste or drop, toggles, Clean. Used by the
 * home page and every single-purpose tool page.
 */
import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useSession } from '../session/SessionContext';
import { PasteDrop, type DraftInput } from './PasteDrop';
import { PipelineToggles } from './PipelineToggles';
import { ProgressBar } from './ProgressBar';

export function CleanTool({ placeholder }: { placeholder?: string | undefined }) {
  const session = useSession();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<DraftInput>({ kind: 'paste', text: '' });

  const empty = draft.kind === 'paste' && draft.text.length === 0;
  const nothingOn = !session.settings.repair && !session.settings.ascii;

  const onClean = async () => {
    const input =
      draft.kind === 'paste'
        ? ({ kind: 'paste', text: draft.text } as const)
        : ({
            kind: 'file',
            name: draft.file.name,
            format: draft.format,
            bytes: await draft.file.arrayBuffer(),
          } as const);
    if (await session.clean(input)) navigate('/result/local');
  };

  return (
    <div className="grid gap-5">
      <PasteDrop value={draft} onChange={setDraft} placeholder={placeholder} />
      <PipelineToggles settings={session.settings} onChange={session.setSettings} />

      {session.error && (
        <p
          role="alert"
          className="rounded-lg border border-fix-invisible bg-fix-invisible-bg px-4 py-3 text-sm"
        >
          Something went wrong: {session.error}
        </p>
      )}

      {session.progress ? (
        <ProgressBar progress={session.progress} onCancel={session.cancel} />
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onClean}
            disabled={empty || nothingOn}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 font-medium text-on-accent shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Sparkles aria-hidden="true" className="size-4" /> Clean
          </button>
          {nothingOn && (
            <span className="text-sm text-muted">Turn on at least one step above.</span>
          )}
        </div>
      )}
    </div>
  );
}

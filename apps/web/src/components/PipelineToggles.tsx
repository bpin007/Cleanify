/** The three pipeline switches and the mode selector (PROJECT.md sections 5, 6, 9). */
import * as Switch from '@radix-ui/react-switch';
import type { Stage } from '@cleanify/engine';
import { Cloud, Monitor } from 'lucide-react';
import { useId } from 'react';
import type { ReactNode } from 'react';
import type { CleanSettings } from '../engine/protocol';
import { StageIcon } from './StageIcon';

interface ToggleProps {
  stage: Stage;
  title: string;
  description: ReactNode;
  checked: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
  badge?: string;
}

function Toggle({ stage, title, description, checked, onChange, disabled, badge }: ToggleProps) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <Switch.Root
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        aria-describedby={`${id}-d`}
        className="relative mt-0.5 h-6 w-10 shrink-0 rounded-full border border-border bg-surface-2 transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Switch.Thumb className="block size-5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-4" />
      </Switch.Root>
      <div className="min-w-0">
        <label htmlFor={id} className="flex items-center gap-1.5 font-medium">
          <StageIcon stage={stage} />
          {title}
          {badge && (
            <span className="rounded-full border border-border px-2 py-0.5 text-xs font-normal text-muted">
              {badge}
            </span>
          )}
        </label>
        <p id={`${id}-d`} className="text-sm text-muted">
          {description}
        </p>
      </div>
    </div>
  );
}

function Choice<T extends string>(props: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <fieldset className="flex flex-wrap items-center gap-2 text-sm">
      <legend className="sr-only">{props.label}</legend>
      <span aria-hidden="true" className="w-36 text-muted">
        {props.label}
      </span>
      <div className="inline-flex rounded-lg border border-border bg-surface p-0.5">
        {props.options.map((o) => (
          <label
            key={o.value}
            className={
              'cursor-pointer rounded-md px-2.5 py-1 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ' +
              (props.value === o.value ? 'bg-accent text-on-accent' : 'text-muted hover:text-text')
            }
          >
            <input
              type="radio"
              className="sr-only"
              name={props.label}
              value={o.value}
              checked={props.value === o.value}
              onChange={() => props.onChange(o.value)}
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function PipelineToggles({
  settings,
  onChange,
}: {
  settings: CleanSettings;
  onChange: (s: CleanSettings) => void;
}) {
  const opts = settings.asciiOptions;
  const setOpt = (o: Partial<CleanSettings['asciiOptions']>) =>
    onChange({ ...settings, asciiOptions: { ...opts, ...o } });

  return (
    <div className="grid gap-6 rounded-xl border border-border bg-surface p-4 sm:p-5">
      <div className="grid gap-4 md:grid-cols-3">
        <Toggle
          stage="encoding"
          title="Repair garbled text"
          description={
            <>
              <span className="font-mono">donâ€™t</span> → <span className="font-mono">don’t</span>
            </>
          }
          checked={settings.repair}
          onChange={(repair) => onChange({ ...settings, repair })}
        />
        <Toggle
          stage="ascii"
          title="Convert to plain ASCII"
          description="Accents, smart quotes and invisible characters"
          checked={settings.ascii}
          onChange={(ascii) => onChange({ ...settings, ascii })}
        />
        <Toggle
          stage="translate"
          title="Translate to English"
          description="Needs our server, so it arrives with cloud features"
          checked={false}
          disabled
          badge="Coming soon"
        />
      </div>

      {settings.ascii && (
        <div className="grid gap-2 border-t border-border pt-4">
          <Choice
            label="What to change"
            value={settings.asciiScope}
            onChange={(asciiScope) => onChange({ ...settings, asciiScope })}
            options={[
              { value: 'all', label: 'Everything' },
              { value: 'invisible', label: 'Only invisible characters' },
            ]}
          />
        </div>
      )}
      {settings.ascii && settings.asciiScope === 'all' && (
        <div className="grid gap-2">
          <Choice
            label="Emoji"
            value={opts.emoji ?? 'keep'}
            onChange={(emoji) => setOpt({ emoji })}
            options={[
              { value: 'keep', label: 'Keep' },
              { value: 'text', label: 'As text :)' },
              { value: 'remove', label: 'Remove' },
            ]}
          />
          <Choice
            label="Other alphabets"
            value={opts.nonLatin ?? 'keep'}
            onChange={(nonLatin) => setOpt({ nonLatin })}
            options={[
              { value: 'keep', label: 'Keep' },
              { value: 'transliterate', label: 'Москва → Moskva' },
            ]}
          />
          <Choice
            label="« » quotes"
            value={opts.guillemets ?? 'angle'}
            onChange={(guillemets) => setOpt({ guillemets })}
            options={[
              { value: 'angle', label: '<< >>' },
              { value: 'quote', label: '"' },
            ]}
          />
        </div>
      )}

      <ModeSelector />
    </div>
  );
}

/** Browser mode only for now; cloud mode arrives with accounts (Phase 3). */
function ModeSelector() {
  return (
    <fieldset className="flex flex-wrap items-center gap-3 border-t border-border pt-4 text-sm">
      <legend className="sr-only">Where to process</legend>
      <span aria-hidden="true" className="text-muted">
        Process in
      </span>
      <label className="inline-flex items-center gap-2 rounded-lg border border-accent bg-accent-bg px-3 py-1.5 text-accent-text has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent">
        <input type="radio" name="mode" value="browser" defaultChecked className="sr-only" />
        <Monitor aria-hidden="true" className="size-4" />
        <span>
          <span className="font-medium">Browser</span> · nothing leaves your device
        </span>
      </label>
      <label className="inline-flex cursor-not-allowed items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-muted">
        <input type="radio" name="mode" value="cloud" disabled className="sr-only" />
        <Cloud aria-hidden="true" className="size-4" />
        <span>
          <span className="font-medium">Cloud</span> · coming soon
        </span>
      </label>
    </fieldset>
  );
}

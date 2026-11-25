/**
 * The cleaning session for this tab: settings, progress, the analysed document and
 * the user's decisions. Everything stays in memory in this tab (browser mode).
 */
import type { EncodingName } from '@cleanify/engine';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CancelledError, EngineClient } from '../engine/client';
import { DEFAULT_SETTINGS } from './defaults';
import type {
  AnalyzedData,
  CleanInput,
  CleanSettings,
  Decision,
  UnencodableItem,
  ViewData,
} from '@cleanify/session';

export type Mode = 'browser' | 'cloud';

const MODE_KEY = 'cleanify.mode';

function storedMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === 'cloud' ? 'cloud' : 'browser';
  } catch {
    return 'browser';
  }
}

export interface Progress {
  phase: string;
  fraction: number;
}

export type SaveResult =
  | { ok: true; bytes: Uint8Array }
  /** Cloud mode: a signed link to the file built on the server. */
  | { ok: true; url: string }
  | { ok: false; encoding: EncodingName; chars: UnencodableItem[] };

interface SessionValue {
  settings: CleanSettings;
  setSettings: (s: CleanSettings) => void;
  /** Where Clean runs: this device (default) or our server. */
  mode: Mode;
  setMode: (m: Mode) => void;
  progress: Progress | null;
  error: string | null;
  data: AnalyzedData | null;
  view: ViewData | null;
  busy: boolean;
  /** The user changed decisions since the last download (or since cleaning). */
  unsaved: boolean;
  clean: (input: CleanInput) => Promise<boolean>;
  reanalyze: (encoding: EncodingName) => Promise<boolean>;
  decide: (decisions: Decision[]) => Promise<void>;
  outputText: () => Promise<string>;
  save: (encoding: EncodingName, bomCount: number) => Promise<SaveResult>;
  cancel: () => void;
  reset: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const client = useRef<EngineClient | null>(null);
  const engine = () => (client.current ??= new EngineClient());

  const [settings, setSettings] = useState<CleanSettings>(DEFAULT_SETTINGS);
  const [mode, setModeState] = useState<Mode>(storedMode);
  const setMode = useCallback((m: Mode) => {
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      // Private window or blocked storage: the choice lasts for this tab only.
    }
  }, []);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AnalyzedData | null>(null);
  const [view, setView] = useState<ViewData | null>(null);
  const [busy, setBusy] = useState(false);
  const [unsaved, setUnsaved] = useState(false);

  const run = useCallback(
    async (request: Parameters<EngineClient['request']>[0], transfer: Transferable[] = []) => {
      setError(null);
      setProgress({ phase: 'Starting', fraction: 0 });
      try {
        const reply = await engine().request(
          request,
          (phase, fraction) => setProgress({ phase, fraction }),
          transfer,
        );
        if (reply.type !== 'analyzed') throw new Error(`Unexpected reply ${reply.type}`);
        setData(reply.data);
        setView(reply.data);
        setUnsaved(false);
        return true;
      } catch (e) {
        if (!(e instanceof CancelledError)) setError(e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        setProgress(null);
      }
    },
    [],
  );

  const clean = useCallback(
    (input: CleanInput) =>
      run({ type: 'analyze', input, settings }, input.kind === 'file' ? [input.bytes] : []),
    [run, settings],
  );

  const reanalyze = useCallback(
    (encoding: EncodingName) => run({ type: 'reanalyze', encoding, settings }),
    [run, settings],
  );

  const decide = useCallback(async (decisions: Decision[]) => {
    setBusy(true);
    try {
      const reply = await engine().request({ type: 'decide', decisions });
      if (reply.type === 'decided') {
        setView(reply.data);
        setUnsaved(true);
      }
    } catch (e) {
      if (!(e instanceof CancelledError)) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const outputText = useCallback(async () => {
    const reply = await engine().request({ type: 'output' });
    if (reply.type !== 'output') throw new Error('Could not read the output');
    return reply.text;
  }, []);

  const save = useCallback(
    async (encoding: EncodingName, bomCount: number): Promise<SaveResult> => {
      const reply = await engine().request({ type: 'serialize', encoding, bomCount });
      if (reply.type === 'serialized') {
        setUnsaved(false);
        return { ok: true, bytes: reply.bytes };
      }
      if (reply.type === 'unencodable')
        return { ok: false, encoding: reply.encoding, chars: reply.chars };
      throw new Error('Could not save the file');
    },
    [],
  );

  const cancel = useCallback(() => {
    engine().cancel();
    setProgress(null);
    setData(null);
    setView(null);
    setUnsaved(false);
  }, []);

  const reset = useCallback(() => {
    setData(null);
    setView(null);
    setError(null);
    setUnsaved(false);
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      settings,
      setSettings,
      mode,
      setMode,
      progress,
      error,
      data,
      view,
      busy,
      unsaved,
      clean,
      reanalyze,
      decide,
      outputText,
      save,
      cancel,
      reset,
    }),
    [
      settings,
      mode,
      setMode,
      progress,
      error,
      data,
      view,
      busy,
      unsaved,
      clean,
      reanalyze,
      decide,
      outputText,
      save,
      cancel,
      reset,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error('useSession must be used inside <SessionProvider>');
  return v;
}

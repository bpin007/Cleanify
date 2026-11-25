/**
 * The rules a run uses (PROJECT.md sections 5 and 6): a signed-in user's saved rules,
 * or an anonymous user's session-only rules, kept in this tab (sessionStorage) and
 * gone when it closes. Both modes use them: browser mode passes them to the worker,
 * cloud mode sends the session-only ones with the job (the API loads saved ones itself).
 */
import { toRuleSet, type RuleKind } from '@cleanify/shared';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { account } from './client';
import { useMe } from './queries';

export interface SessionRule {
  id: string;
  kind: RuleKind;
  name: string;
  from: string;
  to: string;
  enabled: boolean;
}

const KEY = 'cleanify.sessionRules';
export const RULES_KEY = ['rules'] as const;

function readSessionRules(): SessionRule[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? (list as SessionRule[]) : [];
  } catch {
    return [];
  }
}

function writeSessionRules(list: SessionRule[]) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage blocked: the rules last until this page is left.
  }
}

export function useRules() {
  const me = useMe();
  const signedIn = Boolean(me.data?.user);
  const saved = useQuery({
    queryKey: RULES_KEY,
    queryFn: () => account.rules(),
    enabled: signedIn,
  });
  const [local, setLocal] = useState<SessionRule[]>(readSessionRules);

  const updateLocal = useCallback((next: (l: SessionRule[]) => SessionRule[]) => {
    setLocal((l) => {
      const n = next(l);
      writeSessionRules(n);
      return n;
    });
  }, []);

  const list: SessionRule[] = useMemo(
    () => (signedIn ? (saved.data?.rules ?? []) : local),
    [signedIn, saved.data, local],
  );
  const ruleSet = useMemo(() => toRuleSet(list), [list]);

  return {
    signedIn,
    list,
    ruleSet,
    /** Signed in and the saved rules haven't arrived yet: don't run without them. */
    loading: signedIn && saved.isPending,
    error: signedIn ? saved.error : null,
    addSessionRule: (r: Omit<SessionRule, 'id' | 'enabled'>) =>
      updateLocal((l) => [...l, { ...r, id: crypto.randomUUID(), enabled: true }]),
    removeSessionRule: (id: string) => updateLocal((l) => l.filter((r) => r.id !== id)),
  };
}

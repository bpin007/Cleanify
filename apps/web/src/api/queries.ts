/** Server state shared across pages (React Query): who is signed in, and their quotas. */
import { QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MeResponse } from '@cleanify/shared';
import { ApiError, me } from './client';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 4xx answers won't change by asking again; network blips and a waking server might.
      retry: (count, e) =>
        !(e instanceof ApiError && e.status >= 400 && e.status < 500) && count < 2,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

export const ME_KEY = ['me'] as const;

export function useMe() {
  return useQuery<MeResponse>({ queryKey: ME_KEY, queryFn: () => me.get() });
}

/** Re-reads /me, e.g. after logging in or out. */
export function useRefreshMe() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ME_KEY });
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

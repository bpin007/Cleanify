/**
 * Cloudflare Pages Function: forwards /api/* on the web origin to the API on Render
 * (correction 6), so the browser talks to one site and auth cookies stay first-party.
 *
 * Set API_ORIGIN (e.g. https://cleanify-api.onrender.com) in the Pages dashboard.
 * Cookies, redirects (Google sign-in) and bodies pass through unchanged.
 */
interface Env {
  API_ORIGIN?: string;
}

/** Hop-by-hop and client-supplied forwarding headers are never passed on as is. */
const DROP = [
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'x-forwarded-for',
  'x-real-ip',
];

export async function proxy(
  request: Request,
  apiOrigin: string | undefined,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  if (!apiOrigin) {
    return Response.json(
      { error: { code: 'not_configured', message: 'The API address is not configured' } },
      { status: 503 },
    );
  }
  const url = new URL(request.url);
  const target = new URL(url.pathname + url.search, apiOrigin);

  const headers = new Headers(request.headers);
  for (const h of DROP) headers.delete(h);
  // The visitor's real IP, from Cloudflare (not from a header the visitor could fake),
  // for the API's rate limits.
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) headers.set('x-forwarded-for', ip);
  headers.set('x-forwarded-host', url.host);
  headers.set('x-forwarded-proto', url.protocol.replace(':', ''));

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  let upstream: Response;
  try {
    upstream = await fetchFn(target.toString(), {
      method: request.method,
      headers,
      body: hasBody ? request.body : null,
      redirect: 'manual',
      // Streaming request bodies need half-duplex.
      ...(hasBody ? { duplex: 'half' } : {}),
    } as RequestInit);
  } catch {
    // Render's free plan sleeps; the first request after a pause can fail or time out.
    return Response.json(
      {
        error: {
          code: 'api_unavailable',
          message: 'The server is waking up. Try again in a minute.',
        },
      },
      { status: 503, headers: { 'retry-after': '30' } },
    );
  }
  // Copying the response keeps every header, including several Set-Cookie lines.
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });
}

export const onRequest = (ctx: { request: Request; env: Env }) =>
  proxy(ctx.request, ctx.env.API_ORIGIN);

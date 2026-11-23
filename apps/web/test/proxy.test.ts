/** The Pages Function /api proxy (correction 6). */
import { describe, expect, it } from 'vitest';
import { proxy } from '../functions/api/[[path]]';

function recorder(response: Response | Error) {
  const calls: { url: string; init: RequestInit & { headers: Headers } }[] = [];
  const fn = (async (url: string, init: RequestInit & { headers: Headers }) => {
    calls.push({ url, init });
    if (response instanceof Error) throw response;
    return response;
  }) as unknown as typeof fetch;
  return { calls, fn };
}

describe('Pages Function /api proxy', () => {
  it('forwards method, path, query, body and cookies to the API origin', async () => {
    const r = recorder(new Response('{"ok":true}', { status: 201 }));
    const req = new Request('https://cleanify.pages.dev/api/auth/login?x=1', {
      method: 'POST',
      headers: {
        cookie: 'cl_csrf=abc',
        'x-csrf-token': 'abc',
        'content-type': 'application/json',
        'cf-connecting-ip': '203.0.113.7',
        'x-forwarded-for': '6.6.6.6',
      },
      body: '{"email":"a@b.c"}',
    });
    const res = await proxy(req, 'https://api.example.onrender.com', r.fn);
    expect(res.status).toBe(201);
    const call = r.calls[0]!;
    expect(call.url).toBe('https://api.example.onrender.com/api/auth/login?x=1');
    expect(call.init.method).toBe('POST');
    expect(call.init.redirect).toBe('manual');
    expect(call.init.headers.get('cookie')).toBe('cl_csrf=abc');
    expect(call.init.headers.get('x-csrf-token')).toBe('abc');
    // The client's own X-Forwarded-For is replaced by Cloudflare's view of the IP.
    expect(call.init.headers.get('x-forwarded-for')).toBe('203.0.113.7');
    expect(call.init.headers.get('x-forwarded-host')).toBe('cleanify.pages.dev');
    expect(call.init.headers.get('x-forwarded-proto')).toBe('https');
    expect(call.init.headers.get('host')).toBeNull();
    expect(await new Response(call.init.body).text()).toBe('{"email":"a@b.c"}');
  });

  it('passes every Set-Cookie and redirects back unchanged', async () => {
    const headers = new Headers({ location: 'https://cleanify.pages.dev/app' });
    headers.append('set-cookie', 'cl_at=1; Path=/api; HttpOnly');
    headers.append('set-cookie', 'cl_rt=2; Path=/api/auth; HttpOnly');
    const r = recorder(new Response(null, { status: 302, headers }));
    const res = await proxy(
      new Request('https://cleanify.pages.dev/api/auth/google/callback?code=x'),
      'https://api.example',
      r.fn,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://cleanify.pages.dev/app');
    expect(res.headers.getSetCookie()).toEqual([
      'cl_at=1; Path=/api; HttpOnly',
      'cl_rt=2; Path=/api/auth; HttpOnly',
    ]);
    expect(r.calls[0]!.init.body).toBeNull();
  });

  it('says clearly when the API origin is missing or the API is asleep', async () => {
    const missing = await proxy(new Request('https://x.dev/api/me'), undefined);
    expect(missing.status).toBe(503);
    expect((await missing.json()).error.code).toBe('not_configured');
    const asleep = await proxy(
      new Request('https://x.dev/api/me'),
      'https://api',
      recorder(new Error('timeout')).fn,
    );
    expect(asleep.status).toBe(503);
    expect(asleep.headers.get('retry-after')).toBe('30');
    expect((await asleep.json()).error.message).toMatch(/waking up/);
  });
});

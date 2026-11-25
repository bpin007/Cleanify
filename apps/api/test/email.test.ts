/** The Brevo email service (decision D17), against a fake fetch. */
import { describe, expect, it } from 'vitest';
import { BrevoEmail, EmailError } from '../src/services/email';
import { loadConfig } from '../src/config';

function fakeFetch(response: Response | Error) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (response instanceof Error) throw response;
    return response;
  }) as unknown as typeof fetch;
  return { calls, fn };
}

const OPTS = { apiKey: 'xkeysib-secret', from: 'no-reply@example.com', fromName: 'Cleanify' };
const MSG = { to: 'user@example.org', subject: 'Reset', text: 'Open https://x/y' };

describe('BrevoEmail', () => {
  it('posts a plain-text transactional email with the API key header', async () => {
    const f = fakeFetch(new Response('{"messageId":"<1@brevo>"}', { status: 201 }));
    await new BrevoEmail(OPTS, f.fn).send(MSG);
    expect(f.calls).toHaveLength(1);
    const { url, init } = f.calls[0]!;
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'api-key': 'xkeysib-secret',
      'content-type': 'application/json',
    });
    expect(JSON.parse(String(init.body))).toEqual({
      sender: { email: 'no-reply@example.com', name: 'Cleanify' },
      to: [{ email: 'user@example.org' }],
      subject: 'Reset',
      textContent: 'Open https://x/y',
    });
  });

  it('turns a refusal into an EmailError with Brevo’s code, never the key', async () => {
    const f = fakeFetch(
      new Response('{"code":"unauthorized","message":"Key not found"}', { status: 401 }),
    );
    const err = await new BrevoEmail(OPTS, f.fn).send(MSG).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EmailError);
    expect(String(err)).toContain('401, unauthorized: Key not found');
    expect(String(err)).not.toContain('xkeysib');
  });

  it('reports a network failure as an EmailError', async () => {
    const f = fakeFetch(new TypeError('fetch failed'));
    await expect(new BrevoEmail(OPTS, f.fn).send(MSG)).rejects.toThrow(
      'Brevo could not be reached: fetch failed',
    );
  });
});

describe('email config', () => {
  it('is on only with both a key and a sender; the name defaults to APP_NAME', () => {
    expect(loadConfig({ NODE_ENV: 'test', EMAIL_API_KEY: 'k' }).email).toBeNull();
    expect(
      loadConfig({ NODE_ENV: 'test', EMAIL_API_KEY: 'k', EMAIL_FROM: 'a@b.co' }).email,
    ).toEqual({ apiKey: 'k', from: 'a@b.co', fromName: 'Cleanify' });
  });
});

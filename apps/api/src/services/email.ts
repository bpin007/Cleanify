/**
 * Email (password reset, address verification). Behind one small interface so the
 * provider can change (decision D17: Brevo, card-free):
 * - development: messages are printed to the API console, links included;
 * - tests: messages are kept in memory for assertions;
 * - production: Brevo's transactional API when EMAIL_API_KEY and EMAIL_FROM are set,
 *   otherwise sending fails loudly instead of pretending.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailService {
  readonly kind: 'console' | 'memory' | 'disabled' | 'brevo';
  send(message: EmailMessage): Promise<void>;
}

export class ConsoleEmail implements EmailService {
  readonly kind = 'console' as const;
  constructor(private readonly log: (s: string) => void = console.log) {}
  async send(m: EmailMessage) {
    this.log(`\n[email] To: ${m.to}\n[email] Subject: ${m.subject}\n${m.text}\n`);
  }
}

export class MemoryEmail implements EmailService {
  readonly kind = 'memory' as const;
  readonly sent: EmailMessage[] = [];
  async send(m: EmailMessage) {
    this.sent.push(m);
  }
  last(to?: string) {
    return [...this.sent].reverse().find((m) => !to || m.to === to);
  }
}

export class DisabledEmail implements EmailService {
  readonly kind = 'disabled' as const;
  async send(): Promise<void> {
    throw new Error('Email is not configured: choose a provider and set EMAIL_API_KEY');
  }
}

export class EmailError extends Error {}

/**
 * Brevo's transactional email API (POST /v3/smtp/email). The sender must be one
 * verified in Brevo: an address on our own authenticated domain, or, without one,
 * a verified single address (Brevo then sends it from its own domain).
 */
export class BrevoEmail implements EmailService {
  readonly kind = 'brevo' as const;
  constructor(
    private readonly opts: { apiKey: string; from: string; fromName: string },
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a),
  ) {}

  async send(m: EmailMessage) {
    let res: Response;
    try {
      res = await this.fetchFn('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': this.opts.apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          sender: { email: this.opts.from, name: this.opts.fromName },
          to: [{ email: m.to }],
          subject: m.subject,
          textContent: m.text,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      throw new EmailError(`Brevo could not be reached: ${e instanceof Error ? e.message : e}`);
    }
    if (!res.ok) {
      // Brevo answers { code, message }; never echo the key or the message body.
      let detail = '';
      try {
        const body = (await res.json()) as { code?: string; message?: string };
        detail = [body.code, body.message].filter(Boolean).join(': ');
      } catch {
        // Not JSON: the status is enough.
      }
      throw new EmailError(`Brevo refused the email (${res.status}${detail ? `, ${detail}` : ''})`);
    }
  }
}

/** First link in a message (tests and the dev console). */
export const linkIn = (m: EmailMessage | undefined) => m?.text.match(/https?:\/\/\S+/)?.[0];

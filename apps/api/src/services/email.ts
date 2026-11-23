/**
 * Email (password reset, address verification). The provider is still open
 * (PROJECT.md section 24: "pick a card-free one in Phase 3"), so for now:
 * - development: messages are printed to the API console, links included;
 * - tests: messages are kept in memory for assertions;
 * - production without a provider: sending fails loudly instead of pretending.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailService {
  readonly kind: 'console' | 'memory' | 'disabled';
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

/** First link in a message (tests and the dev console). */
export const linkIn = (m: EmailMessage | undefined) => m?.text.match(/https?:\/\/\S+/)?.[0];

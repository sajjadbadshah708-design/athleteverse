// The Mailer used for OTP codes, invitations and the few other e-mails of FR-5.15. A failing provider must never fail the
// action that triggered the e-mail (REL-4): callers use sendSafely, which logs and returns false instead of throwing.
import type { Env } from '../../config/env';
import type { Logger } from '../logger';
import { MailError, sendEmail, type MailMessage } from './providers';

export interface Mailer {
  send(message: MailMessage): Promise<void>; // throws when the provider refuses
}

/** Writes the e-mail to the log instead of sending it: development, tests, or an explicit demo choice. */
export function createConsoleMailer(logger: Logger): Mailer {
  return {
    async send(message) {
      logger.info('e-mail not sent (console mailer)', { to: message.to, subject: message.subject, text: message.text });
    },
  };
}

export function createMailer(env: Env, logger: Logger): Mailer {
  if (env.MAIL_PROVIDER === 'console') {
    if (env.NODE_ENV === 'production') {
      logger.warn('MAIL_PROVIDER=console in production: verification codes are written to the log and nobody receives an e-mail');
    }
    return createConsoleMailer(logger);
  }
  const { MAIL_PROVIDER: provider, MAIL_API_KEY: apiKey, MAIL_FROM: from } = env;
  if (!apiKey || !from) throw new Error('MAIL_API_KEY and MAIL_FROM are required'); // loadEnv already enforces this
  return {
    async send(message) {
      await sendEmail({ provider, apiKey, from }, message);
    },
  };
}

/** Sends after the database transaction has committed. Never throws. */
export async function sendSafely(deps: { mailer: Mailer; logger: Logger }, message: MailMessage): Promise<boolean> {
  try {
    await deps.mailer.send(message);
    return true;
  } catch (err) {
    deps.logger.error('e-mail could not be sent', {
      subject: message.subject,
      error: err instanceof MailError ? { provider: err.provider, status: err.status, body: err.body } : err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/** Collects e-mails in memory, for tests. */
export class FakeMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  failWith: Error | undefined;

  async send(message: MailMessage): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.sent.push(message);
  }

  /** The 6-digit code in the most recent e-mail to this address. */
  lastCodeFor(to: string): string | undefined {
    const mail = [...this.sent].reverse().find((m) => m.to === to);
    return mail ? /\b(\d{6})\b/.exec(mail.text)?.[1] : undefined;
  }
}

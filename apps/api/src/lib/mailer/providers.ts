// Sends one e-mail through Brevo or Resend over HTTPS (SRS 3.2: free plans). T5 wraps this in the Mailer used for OTP and
// invitations. Free-plan facts checked in October 2026 (docs/DEPLOY.md F4): Resend delivers only to the account owner until a
// domain you own is verified; Brevo allows 300 e-mails a day on its free plan.
export type MailProvider = 'brevo' | 'resend';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface MailConfig {
  provider: MailProvider;
  apiKey: string;
  from: string; // "Name <address@domain>" or a bare address
  fetchImpl?: typeof fetch;
  baseUrl?: string; // tests only
}

export class MailError extends Error {
  constructor(
    message: string,
    readonly provider: MailProvider,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = 'MailError';
  }
}

export function parseFrom(from: string): { name?: string; email: string } {
  const m = /^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/.exec(from);
  if (!m) return { email: from.trim() };
  const name = m[1]?.trim();
  return name ? { name, email: m[2]!.trim() } : { email: m[2]!.trim() };
}

const DEFAULT_BASE: Record<MailProvider, string> = {
  brevo: 'https://api.brevo.com',
  resend: 'https://api.resend.com',
};

function buildRequest(cfg: MailConfig, msg: MailMessage): { url: string; headers: Record<string, string>; body: unknown } {
  const base = cfg.baseUrl ?? DEFAULT_BASE[cfg.provider];
  if (cfg.provider === 'brevo') {
    return {
      url: `${base}/v3/smtp/email`,
      headers: { 'api-key': cfg.apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: { sender: parseFrom(cfg.from), to: [{ email: msg.to }], subject: msg.subject, textContent: msg.text },
    };
  }
  return {
    url: `${base}/emails`,
    headers: { authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' },
    body: { from: cfg.from, to: [msg.to], subject: msg.subject, text: msg.text },
  };
}

export async function sendEmail(cfg: MailConfig, msg: MailMessage): Promise<{ id?: string }> {
  const req = buildRequest(cfg, msg);
  const res = await (cfg.fetchImpl ?? fetch)(req.url, {
    method: 'POST',
    headers: req.headers,
    body: JSON.stringify(req.body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok) {
    // The message never contains the API key. The provider's own explanation is kept in `body` for the log.
    throw new MailError(`${cfg.provider} rejected the message (HTTP ${res.status})`, cfg.provider, res.status, text.slice(0, 500));
  }
  try {
    const json = JSON.parse(text) as { id?: string; messageId?: string };
    return { id: json.id ?? json.messageId };
  } catch {
    return {};
  }
}

// Spike S3 (docs/DEPLOY.md): can the chosen free provider deliver to ARBITRARY external addresses? (OTP e-mails need it.)
//   MAIL_PROVIDER=brevo MAIL_API_KEY=... MAIL_FROM="AthleteVerse <you@example.com>" \
//     npm run spike:mail -w @athleteverse/api -- one@gmail.com two@outlook.com
// Afterwards check each inbox AND the spam folder, and open "show original" to read the SPF, DKIM and DMARC results.
import { config } from 'dotenv';
import { MailError, sendEmail, type MailProvider } from '../../src/lib/mailer/providers';

config({ quiet: true });

const provider = process.env.MAIL_PROVIDER as MailProvider | undefined;
const apiKey = process.env.MAIL_API_KEY;
const from = process.env.MAIL_FROM;
const recipients = process.argv.slice(2);

if ((provider !== 'brevo' && provider !== 'resend') || !apiKey || !from || recipients.length === 0) {
  console.error('Usage: MAIL_PROVIDER=brevo|resend MAIL_API_KEY=... MAIL_FROM="Name <address>" npm run spike:mail -w @athleteverse/api -- recipient1 [recipient2 ...]');
  process.exit(1);
}

function hint(err: MailError): string {
  if (err.provider === 'resend' && err.status === 403) {
    return 'Resend free plans deliver only to the account owner until you verify a domain YOU OWN, and the from-address must use that domain.';
  }
  if (err.status === 401) return 'The API key was refused (wrong key, or the provider restricts the calling IP address).';
  if (err.status === 400) return 'Usually an unvalidated sender: confirm the from-address in the provider dashboard first.';
  if (err.status === 429) return 'A rate or daily quota was hit (Brevo free: 300 a day; Resend free: 100 a day).';
  return '';
}

let failed = 0;
for (const to of recipients) {
  try {
    const out = await sendEmail(
      { provider, apiKey, from, baseUrl: process.env.MAIL_API_BASE },
      { to, subject: 'AthleteVerse mail spike', text: `Delivery test sent at ${new Date().toISOString()}. If you can read this, the provider reached you.` },
    );
    console.log(`  ACCEPTED  ${to}  (provider id ${out.id ?? 'n/a'})  <- check inbox and spam`);
  } catch (e) {
    failed++;
    if (e instanceof MailError) {
      console.log(`  REJECTED  ${to}  HTTP ${e.status}  ${e.body.replace(/\s+/g, ' ').slice(0, 200)}`);
      const h = hint(e);
      if (h) console.log(`            hint: ${h}`);
    } else {
      console.log(`  ERROR     ${to}  ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
console.log(failed ? `\n${failed} of ${recipients.length} rejected\n` : '\nAll accepted by the provider. Delivery is confirmed only when the mail is in the inbox.\n');
process.exit(failed ? 1 : 0);

import type { gmail_v1 } from 'googleapis';
import { composeRfc2822, base64url } from './gmail-client.js';

type Gmail = gmail_v1.Gmail;

export async function execSend(gmail: Gmail, email: string, flags: Record<string, string>) {
  const raw = base64url(
    composeRfc2822({
      to: flags['to'] ?? '',
      subject: flags['subject'] ?? '',
      body: flags['body'] ?? '',
      cc: flags['cc'],
    }),
  );
  const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
  return { account: email, messageId: res.data.id, status: 'sent' };
}

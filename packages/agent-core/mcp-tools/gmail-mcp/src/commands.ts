import type { gmail_v1 } from 'googleapis';
import {
  createGmailClient,
  parseFlags,
  getHeader,
  composeRfc2822,
  base64url,
  handleGmailError,
} from './gmail-client.js';
import type { AccountEntry } from './accounts.js';

type Gmail = gmail_v1.Gmail;

async function execList(
  gmail: Gmail,
  email: string,
  flags: Record<string, string>,
  _positional: string,
) {
  const q =
    [flags['query'] ?? '', flags['unread-only'] !== undefined ? 'is:unread' : '']
      .filter(Boolean)
      .join(' ') || undefined;
  const maxResults = parseInt(flags['max'] ?? '20', 10);
  const listRes = await gmail.users.messages.list({ userId: 'me', q, maxResults });
  const messages = listRes.data.messages ?? [];
  const results = await Promise.allSettled(
    messages.map((m) =>
      gmail.users.messages.get({
        userId: 'me',
        id: m.id!,
        format: 'metadata',
        metadataHeaders: ['Subject', 'From', 'Date'],
      }),
    ),
  );
  return results.flatMap((r) => {
    if (r.status === 'rejected') {
      return [];
    }
    const msg = r.value.data;
    const hdrs = msg.payload?.headers ?? [];
    return [
      {
        account: email,
        messageId: msg.id,
        threadId: msg.threadId,
        subject: getHeader(hdrs, 'Subject'),
        from: getHeader(hdrs, 'From'),
        date: getHeader(hdrs, 'Date'),
        snippet: msg.snippet,
        isUnread: msg.labelIds?.includes('UNREAD') ?? false,
      },
    ];
  });
}

function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) {
    return '';
  }
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }
  for (const part of payload.parts ?? []) {
    const text = extractBody(part);
    if (text) {
      return text;
    }
  }
  return '';
}

async function execRead(gmail: Gmail, email: string, messageId: string) {
  const msg = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
  const hdrs = msg.data.payload?.headers ?? [];
  const attachments = (msg.data.payload?.parts ?? [])
    .filter((p) => p.filename && p.body?.size)
    .map((p) => ({ filename: p.filename!, mimeType: p.mimeType ?? '', size: p.body?.size ?? 0 }));
  return {
    account: email,
    messageId: msg.data.id,
    threadId: msg.data.threadId,
    subject: getHeader(hdrs, 'Subject'),
    from: getHeader(hdrs, 'From'),
    to: getHeader(hdrs, 'To'),
    cc: getHeader(hdrs, 'Cc'),
    date: getHeader(hdrs, 'Date'),
    body: extractBody(msg.data.payload),
    attachments,
  };
}

async function execSend(gmail: Gmail, email: string, flags: Record<string, string>) {
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

async function execReply(gmail: Gmail, email: string, flags: Record<string, string>) {
  const msgId = flags['messageId'];
  const orig = await gmail.users.messages.get({
    userId: 'me',
    id: msgId,
    format: 'metadata',
    metadataHeaders: ['Subject', 'From', 'Message-ID', 'References'],
  });
  const hdrs = orig.data.payload?.headers ?? [];
  const subject = getHeader(hdrs, 'Subject');
  const origMsgId = getHeader(hdrs, 'Message-ID');
  const refs = [getHeader(hdrs, 'References'), origMsgId].filter(Boolean).join(' ');
  const raw = base64url(
    composeRfc2822({
      to: getHeader(hdrs, 'From'),
      subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`,
      body: flags['body'] ?? '',
      cc: flags['cc'],
      inReplyTo: origMsgId,
      references: refs,
    }),
  );
  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw, threadId: orig.data.threadId! },
  });
  return { account: email, messageId: res.data.id, threadId: res.data.threadId, status: 'sent' };
}

async function execDraft(gmail: Gmail, email: string, flags: Record<string, string>) {
  const raw = base64url(
    composeRfc2822({
      to: flags['to'] ?? '',
      subject: flags['subject'] ?? '',
      body: flags['body'] ?? '',
    }),
  );
  const res = await gmail.users.drafts.create({ userId: 'me', requestBody: { message: { raw } } });
  return { account: email, draftId: res.data.id, status: 'draft_saved' };
}

async function execModify(
  gmail: Gmail,
  email: string,
  messageId: string,
  addLabelIds: string[],
  removeLabelIds: string[],
) {
  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: { addLabelIds, removeLabelIds },
  });
  return messageId;
}

export async function runCommand(
  accounts: AccountEntry[],
  subcommand: string,
  args: string,
): Promise<unknown> {
  const flags = parseFlags(args);
  const positionalMatch = args.match(/^([^\s-]\S*)/);
  const positional = positionalMatch ? positionalMatch[1] : '';

  const results = await Promise.allSettled(
    accounts.map(async (acct) => {
      const gmail = createGmailClient(acct.tokenFilePath);
      const email = acct.email;
      if (subcommand === 'list') {
        return execList(gmail, email, flags, positional);
      }
      if (subcommand === 'read') {
        return execRead(gmail, email, positional || flags['messageId'] || '');
      }
      if (subcommand === 'send') {
        return execSend(gmail, email, flags);
      }
      if (subcommand === 'reply') {
        return execReply(gmail, email, flags);
      }
      if (subcommand === 'draft') {
        return execDraft(gmail, email, flags);
      }
      if (subcommand === 'archive') {
        const id = positional || flags['messageId'] || '';
        await execModify(gmail, email, id, [], ['INBOX']);
        return { account: email, messageId: id, status: 'archived' };
      }
      if (subcommand === 'mark-read' || subcommand === 'mark-unread') {
        const id = positional || flags['messageId'] || '';
        const unread = subcommand === 'mark-unread' || flags['unread'] !== undefined;
        await execModify(gmail, email, id, unread ? ['UNREAD'] : [], unread ? [] : ['UNREAD']);
        return { account: email, messageId: id, status: 'updated' };
      }
      if (subcommand === 'label') {
        const id = flags['messageId'] || '';
        const addLabel = flags['add'] ? [flags['add']] : [];
        const removeLabel = flags['remove'] ? [flags['remove']] : [];
        await execModify(gmail, email, id, addLabel, removeLabel);
        return { account: email, messageId: id, status: 'labels_updated' };
      }
      return { error: `Unknown subcommand: ${subcommand}` };
    }),
  );

  const output: unknown[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') {
      const val = r.value;
      if (Array.isArray(val)) {
        output.push(...val);
      } else {
        output.push(val);
      }
    } else {
      output.push(handleGmailError(accounts[i].email, r.reason));
    }
  }
  return accounts.length === 1 && output.length === 1 ? output[0] : output;
}

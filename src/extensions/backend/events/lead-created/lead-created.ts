import { items } from '@wix/data';
import { secrets } from '@wix/secrets';
import { auth } from '@wix/essentials';

// Fires whenever an item is inserted into the "Leads" collection (see src/pages/api/lead.ts).
// Sends the admin email (Resend) and appends a row to the Google Sheet. Credentials live in the
// site's Secrets Manager under the names below, never in code.
const COLLECTION = 'Leads';

const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

async function secret(name: string): Promise<string> {
  try {
    const res = await auth.elevate(secrets.getSecretValue)(name);
    return (res.value || '').trim();
  } catch (e) {
    console.error(`Secret "${name}" unavailable`, (e as any)?.message || e);
    return '';
  }
}

export default items.onDataItemCreated(async (event) => {
  const entity = event.entity as any;
  if (entity?.dataCollectionId !== COLLECTION) return;
  const lead: Record<string, any> = entity.data || {};

  const [apiKey, adminEmail, fromEmail, sheetUrl, sheetSecret] = await Promise.all([
    secret('RESEND_API_KEY'), secret('LEAD_ADMIN_EMAIL'), secret('LEAD_FROM_EMAIL'),
    secret('SHEETS_WEBHOOK_URL'), secret('SHEETS_SHARED_SECRET'),
  ]);

  const results = await Promise.allSettled([
    sendEmail(lead, apiKey, adminEmail, fromEmail),
    pushToSheet(lead, sheetUrl, sheetSecret),
  ]);
  if (results[0].status === 'rejected') console.error('Lead email failed', results[0].reason);
  if (results[1].status === 'rejected') console.error('Lead sheet sync failed', results[1].reason);
});

async function sendEmail(lead: Record<string, any>, apiKey: string, adminEmail: string, fromEmail: string) {
  if (!apiKey || !adminEmail || !fromEmail) { console.warn('Resend not configured; skipping email'); return; }
  const rows = [
    ['Name', lead.name], ['Email', lead.email], ['Phone', lead.phone], ['Company', lead.company],
    ['Service', lead.service], ['Team size', lead.team_size], ['Industry', lead.industry],
    ['Company size', lead.company_size], ['Message', lead.message], ['Source', lead.source], ['Page', lead.page_url],
  ].filter(([, v]) => v);
  const html = `<h2>New lead: ${esc(lead.name)}</h2><table cellpadding="6">${rows
    .map(([k, v]) => `<tr><td><b>${k}</b></td><td>${esc(v)}</td></tr>`).join('')}</table>`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: fromEmail,
      to: adminEmail.split(',').map((s) => s.trim()),
      reply_to: lead.email,
      subject: `New lead: ${lead.name}${lead.company ? ' (' + lead.company + ')' : ''}`,
      html,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

async function pushToSheet(lead: Record<string, any>, url: string, sharedSecret: string) {
  if (!url) { console.warn('Sheets webhook not configured; skipping row'); return; }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ secret: sharedSecret, lead }),
  });
  if (!res.ok) throw new Error(`Sheets ${res.status}: ${await res.text()}`);
}

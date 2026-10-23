import type { APIRoute } from 'astro';
import { auth } from '@wix/essentials';
import { items } from '@wix/data';
import {
  SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY, LEAD_ADMIN_EMAIL, LEAD_FROM_EMAIL,
  SHEETS_WEBHOOK_URL, SHEETS_SHARED_SECRET,
} from 'astro:env/server';

// POST /api/lead
// Pipeline: validate -> save to Wix CMS ("Leads") + Supabase in parallel (at least one must succeed)
//           -> admin email (Resend) + Google Sheet, both optional and non-fatal.
export const prerender = false;

const COLLECTION = 'Leads';
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const clip = (v: unknown, n: number) => String(v == null ? '' : v).trim().slice(0, n);
const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

const SEARCH_HOSTS = /(^|\.)(google|bing|yahoo|duckduckgo|baidu|yandex|ecosia|brave)\./i;

function classifySource(utm: Record<string, string> | null, referrer: string) {
  const u = utm || {};
  const src = String(u.utm_source || '').toLowerCase();
  const medium = String(u.utm_medium || '').toLowerCase();
  const paid = /^(cpc|ppc|paid|paidsocial|paid_social|display|cpm)/.test(medium);
  if (u.gclid || u.gbraid || u.wbraid || (paid && /google|adwords/.test(src))) return 'google_ads';
  if (u.fbclid || (paid && /facebook|instagram|meta|fb|ig/.test(src))) return 'meta_ads';
  if (src || medium) return medium === 'organic' ? 'organic' : 'other';
  let host = '';
  try { host = referrer ? new URL(referrer).hostname : ''; } catch { host = ''; }
  if (!host) return 'direct';
  if (/unisasitbiz\.com$|wix-site-host\.com$/i.test(host)) return 'direct';
  if (SEARCH_HOSTS.test(host)) return 'organic';
  return 'other';
}

export const POST: APIRoute = async ({ request }) => {
  let body: any;
  try { body = await request.json(); } catch { return reply(400, { error: 'Invalid JSON' }); }

  if (body.website) return reply(200, { ok: true }); // honeypot

  const lead: Record<string, any> = {
    name: clip(body.name, 120),
    email: clip(body.email, 200).toLowerCase(),
    company: clip(body.company, 160),
    phone: clip(body.phone, 40),
    service: clip(body.service, 80),
    team_size: clip(body.teamsize, 40),
    industry: clip(body.industry, 80),
    company_size: clip(body.companysize, 40),
    message: clip(body.message, 4000),
    page_url: clip(body.page_url, 500),
    referrer: clip(body.referrer, 500),
    utm: body.utm && typeof body.utm === 'object' ? body.utm : null,
    landing_page: clip(body.landing_page, 500),
    user_agent: clip(request.headers.get('user-agent'), 300),
  };
  lead.source = classifySource(lead.utm, lead.referrer);
  if (!lead.name || !EMAIL_RE.test(lead.email)) return reply(400, { error: 'Name and a valid email are required' });

  const [wixRes, sbRes] = await Promise.allSettled([saveToWix(lead), saveToSupabase(lead)]);
  if (wixRes.status === 'rejected') console.error('Wix CMS insert failed', wixRes.reason);
  if (sbRes.status === 'rejected') console.error('Supabase insert failed', sbRes.reason);
  if (wixRes.status === 'rejected' && sbRes.status === 'rejected') {
    return reply(500, { error: 'Could not save your request' });
  }

  const [mail, sheet] = await Promise.allSettled([notifyAdmin(lead), pushToSheet(lead)]);
  if (mail.status === 'rejected') console.error('Admin email failed', mail.reason);
  if (sheet.status === 'rejected') console.error('Sheet sync failed', sheet.reason);

  if (sbRes.status === 'fulfilled' && sbRes.value) {
    const stamp: Record<string, string> = {};
    const now = new Date().toISOString();
    if (mail.status === 'fulfilled' && mail.value) stamp.email_sent_at = now;
    if (sheet.status === 'fulfilled' && sheet.value) stamp.sheet_synced_at = now;
    if (Object.keys(stamp).length) {
      await supabase(`leads?id=eq.${sbRes.value.id}`, 'PATCH', stamp).catch((e) => console.error('Status update failed', e));
    }
  }
  return reply(200, { ok: true });
};

async function saveToWix(lead: Record<string, any>) {
  const { utm, ...rest } = lead;
  const insert = auth.elevate(items.insert);
  return insert(COLLECTION, { ...rest, utm: utm ? JSON.stringify(utm) : '' });
}

async function supabase(path: string, method: string, payload: unknown, extra: Record<string, string> = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error('Supabase not configured');
  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    method,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', ...extra },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res;
}

async function saveToSupabase(lead: Record<string, any>) {
  const res = await supabase('leads', 'POST', lead, { Prefer: 'return=representation' });
  const rows = await res.json();
  return rows[0];
}

// Returns false when the optional integration isn't configured.
async function notifyAdmin(lead: Record<string, any>) {
  if (!RESEND_API_KEY || !LEAD_ADMIN_EMAIL || !LEAD_FROM_EMAIL) return false;
  const rows = [
    ['Name', lead.name], ['Email', lead.email], ['Phone', lead.phone], ['Company', lead.company],
    ['Service', lead.service], ['Team size', lead.team_size], ['Industry', lead.industry],
    ['Company size', lead.company_size], ['Message', lead.message], ['Source', lead.source], ['Page', lead.page_url],
  ].filter(([, v]) => v);
  const html = `<h2>New lead: ${esc(lead.name)}</h2><table cellpadding="6">${rows
    .map(([k, v]) => `<tr><td><b>${k}</b></td><td>${esc(v)}</td></tr>`).join('')}</table>`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: LEAD_FROM_EMAIL,
      to: LEAD_ADMIN_EMAIL.split(',').map((s) => s.trim()),
      reply_to: lead.email,
      subject: `New lead: ${lead.name}${lead.company ? ' (' + lead.company + ')' : ''}`,
      html,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  return true;
}

async function pushToSheet(lead: Record<string, any>) {
  if (!SHEETS_WEBHOOK_URL) return false;
  const res = await fetch(SHEETS_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ secret: SHEETS_SHARED_SECRET, lead }),
  });
  if (!res.ok) throw new Error(`Sheets ${res.status}: ${await res.text()}`);
  return true;
}

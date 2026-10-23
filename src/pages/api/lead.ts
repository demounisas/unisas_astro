import type { APIRoute } from 'astro';
import { auth } from '@wix/essentials';
import { items } from '@wix/data';
import { secrets } from '@wix/secrets';

// POST /api/lead
// Pipeline: validate -> save to Wix CMS ("Leads") + Supabase in parallel (at least one must succeed).
// The admin email (Resend) and Google Sheet row are sent by the event extension
// src/extensions/backend/events/lead-created, which fires when the CMS item is inserted.
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

  return reply(200, { ok: true });
};

async function saveToWix(lead: Record<string, any>) {
  const { utm, ...rest } = lead;
  const insert = auth.elevate(items.insert);
  return insert(COLLECTION, { ...rest, utm: utm ? JSON.stringify(utm) : '' });
}

async function secret(name: string) {
  const res = await auth.elevate(secrets.getSecretValue)(name);
  return (res.value || '').trim();
}

async function supabase(path: string, method: string, payload: unknown, extra: Record<string, string> = {}) {
  const [url, key] = await Promise.all([secret('SUPABASE_URL'), secret('SUPABASE_SERVICE_KEY')]);
  if (!url || !key) throw new Error('Supabase not configured');
  const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${path}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra },
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

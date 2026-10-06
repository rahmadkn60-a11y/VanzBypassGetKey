const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const PROVIDERS = [
  { name:'linkvertise', re:/(?:linkvertise\.(?:com|net)|link-to\.net|up-to-down\.(?:net|com)|file-upload\.net|downloadfile\.(?:net|com))/i, fn: lvResolver },
  { name:'lootlabs',    re:/(?:loot-link\.com|lootlabs\.gg|loot-links\.com|lootdest\.(?:com|org))/i, fn: lootResolver },
  { name:'sub2unlock',  re:/(?:sub2unlock\.(?:com|net|io)|sub4unlock)/i, fn: subResolver },
  { name:'rekonise',    re:/rekonise\.com/i, fn: rekoResolver },
  { name:'workink',     re:/work\.ink/i, fn: genericResolver },
  { name:'boostink',    re:/(?:boost\.ink|boosts\.gg)/i, fn: genericResolver },
  { name:'adfly',       re:/(?:adf\.ly|adfly\.us|q\.gs|fzi\.q\.gs)/i, fn: genericResolver },
  { name:'paste',       re:/(?:pastebin|pastery|paste\.ee|hastebin)/i, fn: genericResolver },
  { name:'generic',     re:/.*/, fn: genericResolver }
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

async function req(url, opts = {}) {
  return fetch(url, {
    redirect: 'follow',
    ...opts,
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      ...(opts.headers || {})
    }
  });
}

function pick(html, patterns) {
  for (const p of patterns) {
    const m = html.match(p);
    if (m && m[1]) return m[1].replace(/\\\//g, '/').replace(/&amp;/g, '&').trim();
  }
  return null;
}

async function genericResolver(url, depth = 0) {
  if (depth > 12) throw new Error('Max redirect depth exceeded');
  const res = await req(url);
  const finalUrl = res.url || url;
  const html = await res.text();

  const next = pick(html, [
    /<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"'\s>]+)/i,
    /window\.location(?:\.href)?\s*=\s*["']([^"']+)["']/i,
    /location\.replace\(\s*["']([^"']+)["']\s*\)/i,
    /location\.assign\(\s*["']([^"']+)["']\s*\)/i,
    /"target"\s*:\s*"([^"]+)"/i,
    /"url"\s*:\s*"([^"]+)"/i,
    /data-target=["']([^"']+)["']/i,
    /<a[^>]+href=["']([^"']+getkey[^"']+)["']/i
  ]);

  if (next && next !== finalUrl && !next.startsWith('#')) {
    let abs;
    try { abs = new URL(next, finalUrl).toString(); }
    catch { return finalUrl; }
    return genericResolver(abs, depth + 1);
  }
  return finalUrl;
}

async function lvResolver(url) {
  const m = url.match(/\/?(\d{4,})/);
  if (!m) return genericResolver(url);
  const id = m[1];

  const page = await req(`https://linkvertise.com/${id}`);
  const html = await page.text();

  const serial = html.match(/"serial"\s*:\s*"([^"]+)"/)?.[1];
  const userId = html.match(/"userId"\s*:\s*(\d+)/)?.[1];

  if (serial) {
    try {
      const r = await req(`https://publisher.linkvertise.com/api/v1/redirect/link/static/${id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://linkvertise.com',
          'Referer': `https://linkvertise.com/${id}`
        },
        body: JSON.stringify({ serial, userId: userId ? parseInt(userId) : undefined })
      });
      const j = await r.json();
      const target = j?.data?.target || j?.target;
      if (target) return target;
    } catch {}
  }

  const direct = pick(html, [
    /"target"\s*:\s*"([^"]+)"/i,
    /targetUrl["']?\s*[:=]\s*["']([^"']+)["']/i
  ]);
  if (direct) return direct;

  return genericResolver(url);
}

async function lootResolver(url) {
  const res = await req(url);
  const html = await res.text();
  const direct = pick(html, [
    /"destination"\s*:\s*"([^"]+)"/i,
    /"url"\s*:\s*"([^"]+)"/i,
    /"target"\s*:\s*"([^"]+)"/i,
    /data-url=["']([^"']+)["']/i
  ]);
  if (direct) return direct.replace(/\\\//g, '/');
  return genericResolver(url);
}

async function subResolver(url) {
  const res = await req(url);
  const html = await res.text();
  const direct = pick(html, [
    /"url"\s*:\s*"([^"]+)"/i,
    /"redirect"\s*:\s*"([^"]+)"/i,
    /href=["']([^"']+getkey[^"']+)["']/i,
    /"target"\s*:\s*"([^"]+)"/i
  ]);
  if (direct) return direct.replace(/\\\//g, '/');
  return genericResolver(url);
}

async function rekoResolver(url) {
  const m = url.match(/rekonise\.com\/(?:r|unlock)\/([A-Za-z0-9_-]+)/);
  if (!m) return genericResolver(url);
  try {
    const r = await req(`https://api.rekonise.com/socialunlocks/${m[1]}`);
    const j = await r.json();
    if (j?.url) return j.url;
  } catch {}
  return genericResolver(url);
}

function detect(url) {
  for (const p of PROVIDERS) if (p.re.test(url)) return p;
  return PROVIDERS[PROVIDERS.length - 1];
}

async function handleBypass(request) {
  try {
    const body = await request.json();
    const raw = (body.url || '').trim();
    if (!raw) throw new Error('URL required');
    if (!/^https?:\/\//i.test(raw)) throw new Error('Invalid URL scheme');

    const provider = detect(raw);
    const result = await provider.fn(raw);

    return new Response(JSON.stringify({ ok: true, provider: provider.name, result }), { headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { headers: CORS });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/bypass') {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      if (request.method === 'POST') return handleBypass(request);
      return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), { status: 405, headers: CORS });
    }

    return env.ASSETS.fetch(request);
  }
};

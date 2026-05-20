#!/usr/bin/env node
/**
 * cookiecloud-fetch — authenticated web scraping via CookieCloud + Cloudflare Browser Run
 *
 * Usage: node fetch.js <url> [endpoint]
 *   endpoint: markdown (default) | content | screenshot | json | links
 *
 * Required env vars:
 *   COOKIECLOUD_URL, COOKIECLOUD_UUID, COOKIECLOUD_PASSWORD
 *   CF_ACCOUNT_ID, CF_API_TOKEN
 */

const crypto  = require('crypto');
const https   = require('https');
const http    = require('http');
const fs      = require('fs');
const { URL } = require('url');

const targetUrl = process.argv[2];
const endpoint  = process.argv[3] || 'markdown';

if (!targetUrl) {
  console.error('Usage: node fetch.js <url> [endpoint]');
  process.exit(1);
}

const ccUrl   = (process.env.COOKIECLOUD_URL   || '').replace(/\/$/, '');
const uuid    =  process.env.COOKIECLOUD_UUID   || '';
const pass    =  process.env.COOKIECLOUD_PASSWORD || '';
const account =  process.env.CF_ACCOUNT_ID      || '';
const token   =  process.env.CF_API_TOKEN        || '';

if (!ccUrl || !uuid || !pass || !account || !token) {
  console.error('Missing env vars. Required: COOKIECLOUD_URL, COOKIECLOUD_UUID, COOKIECLOUD_PASSWORD, CF_ACCOUNT_ID, CF_API_TOKEN');
  process.exit(1);
}

// Extract domain, strip www.
const domain = new URL(targetUrl).hostname.replace(/^www\./, '');

// AES-128-CBC Fixed IV decryption (CookieCloud "aes-128-cbc-fixed" mode)
function decrypt(encrypted) {
  const hash = crypto.createHash('md5').update(`${uuid}-${pass}`).digest('hex');
  const key  = Buffer.from(hash.substring(0, 16), 'utf8');
  const iv   = Buffer.alloc(16, 0);
  const dec  = crypto.createDecipheriv('aes-128-cbc', key, iv);
  let out = dec.update(Buffer.from(encrypted, 'base64'));
  return JSON.parse(Buffer.concat([out, dec.final()]).toString('utf8'));
}

// Browser Run only accepts Strict | Lax | None
const VALID_SAME_SITE = new Set(['Strict', 'Lax', 'None']);
function normalizeSameSite(v) {
  if (!v) return 'Lax';
  const s = v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
  return VALID_SAME_SITE.has(s) ? s : 'Lax';
}

function get(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, res => {
      let b = '';
      res.on('data', d => b += d);
      res.on('end', () => resolve(b));
    }).on('error', reject);
  });
}

function post(payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req  = https.request({
      hostname: 'api.cloudflare.com',
      path:     `/client/v4/accounts/${account}/browser-rendering/${endpoint}`,
      method:   'POST',
      headers:  {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, res => {
      let b = '';
      res.on('data', d => b += d);
      res.on('end', () => resolve(JSON.parse(b)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  // 1. Fetch + decrypt CookieCloud
  const raw  = JSON.parse(await get(`${ccUrl}/get/${uuid}`));
  const data = decrypt(raw.encrypted);

  // 2. Match cookies for target domain (try bare + dot-prefixed)
  const cookieData = data.cookie_data || {};
  let matched = [];
  for (const k of [domain, `.${domain}`]) {
    if (cookieData[k]) { matched = cookieData[k]; break; }
  }

  if (!matched.length) {
    console.error(`No cookies found for "${domain}". Open the site in your browser and let CookieCloud sync, then retry.`);
    process.exit(1);
  }
  console.error(`✓ ${matched.length} cookies for ${domain}`);

  // 3. Normalize to Browser Run format
  const cookies = matched.map(c => ({
    name:     c.name,
    value:    c.value,
    domain:   c.domain || domain,
    path:     c.path || '/',
    expires:  c.expirationDate,               // expirationDate → expires
    httpOnly: c.httpOnly || false,
    secure:   c.secure   || false,
    sameSite: normalizeSameSite(c.sameSite),  // "unspecified" → "Lax"
  }));

  // 4. Call Browser Run
  const result = await post({
    url:         targetUrl,
    cookies,
    gotoOptions: { waitUntil: 'networkidle2' },
  });

  if (!result.success) {
    console.error('Browser Run error:', JSON.stringify(result.errors));
    process.exit(1);
  }

  if (endpoint === 'screenshot') {
    const out = '/tmp/browserrun_screenshot.png';
    fs.writeFileSync(out, Buffer.from(result.result, 'base64'));
    console.log(`Screenshot saved to ${out}`);
  } else {
    process.stdout.write(result.result);
  }
})();

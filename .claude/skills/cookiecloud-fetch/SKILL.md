---
name: cookiecloud-fetch
description: Fetch authenticated web content using CookieCloud session cookies injected into Cloudflare Browser Run. Use when a target website requires login or has strong anti-scraping/bot-detection measures. Automatically pulls matching cookies from CookieCloud for the target domain and passes them to Browser Run.
allowed-tools:
  - Bash
---

# CookieCloud + Browser Run Authenticated Fetch

Use this skill whenever a website blocks unauthenticated access or needs a real login session to return useful content.

## Step 1 — Check Configuration

```bash
source ~/.zshrc 2>/dev/null
_CC_URL="${COOKIECLOUD_URL:-}"
_CC_UUID="${COOKIECLOUD_UUID:-}"
_CC_PASS="${COOKIECLOUD_PASSWORD:-}"
_CF_ACCOUNT="${CF_ACCOUNT_ID:-}"
_CF_TOKEN="${CF_API_TOKEN:-}"

if [ -z "$_CC_URL" ] || [ -z "$_CC_UUID" ] || [ -z "$_CC_PASS" ] || \
   [ -z "$_CF_ACCOUNT" ] || [ -z "$_CF_TOKEN" ]; then
  echo "MISSING_CONFIG"
else
  echo "OK"
fi
```

If output is `MISSING_CONFIG`, tell the user to add the following to `~/.zshrc`:

```bash
# CookieCloud
export COOKIECLOUD_URL="http://localhost:8088"
export COOKIECLOUD_UUID="your-uuid-here"
export COOKIECLOUD_PASSWORD="your-password-here"

# Cloudflare Browser Run
export CF_ACCOUNT_ID="your-cloudflare-account-id"
export CF_API_TOKEN="your-cloudflare-api-token"
```

Then run `source ~/.zshrc` and invoke this skill again.

How to get the values:
- `COOKIECLOUD_URL` / `UUID` / `PASSWORD` — from the CookieCloud browser extension settings page
- `CF_ACCOUNT_ID` — Cloudflare Dashboard → right sidebar
- `CF_API_TOKEN` — Cloudflare Dashboard → My Profile → API Tokens → Create Token → Custom Token → Permission: `Account / Browser Rendering / Edit`

## Step 2 — Fetch and Render

Replace `TARGET_URL` with the actual URL. Set `ENDPOINT` to one of: `content` (HTML), `markdown`, `screenshot`, `json`.

```bash
source ~/.zshrc 2>/dev/null
TARGET_URL="https://example.com/page"
ENDPOINT="markdown"

node - <<'JSEOF' "$TARGET_URL" "$ENDPOINT"
const crypto = require('crypto');
const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const { URL } = require('url');

const ccUrl   = process.env.COOKIECLOUD_URL.replace(/\/$/, '');
const uuid    = process.env.COOKIECLOUD_UUID;
const pass    = process.env.COOKIECLOUD_PASSWORD;
const account = process.env.CF_ACCOUNT_ID;
const token   = process.env.CF_API_TOKEN;
const targetUrl  = process.argv[2];
const endpoint   = process.argv[3] || 'markdown';

// Extract domain (strip www.)
const domain = new URL(targetUrl).hostname.replace(/^www\./, '');

const VALID_SAME_SITE = new Set(['Strict', 'Lax', 'None']);
function normalizeSameSite(v) {
  if (!v) return 'Lax';
  const s = v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
  return VALID_SAME_SITE.has(s) ? s : 'Lax';
}

function decrypt(encrypted) {
  const hash = crypto.createHash('md5').update(`${uuid}-${pass}`).digest('hex');
  const key  = Buffer.from(hash.substring(0, 16), 'utf8');
  const iv   = Buffer.alloc(16, 0);
  const dec  = crypto.createDecipheriv('aes-128-cbc', key, iv);
  let out = dec.update(Buffer.from(encrypted, 'base64'));
  return JSON.parse(Buffer.concat([out, dec.final()]).toString('utf8'));
}

function get(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, res => { let b=''; res.on('data',d=>b+=d); res.on('end',()=>resolve(b)); }).on('error', reject);
  });
}

function post(payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = https.request({
      hostname: 'api.cloudflare.com',
      path: `/client/v4/accounts/${account}/browser-rendering/${endpoint}`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      }
    }, res => { let b=''; res.on('data',d=>b+=d); res.on('end',()=>resolve(JSON.parse(b))); });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  // 1. Fetch + decrypt CookieCloud
  const raw  = JSON.parse(await get(`${ccUrl}/get/${uuid}`));
  const data = decrypt(raw.encrypted);
  const cookieData = data.cookie_data || {};

  // 2. Match cookies for target domain
  let matched = [];
  for (const k of [domain, `.${domain}`]) {
    if (cookieData[k]) { matched = cookieData[k]; break; }
  }

  if (!matched.length) {
    console.error(`⚠️  No cookies found for "${domain}". Open the site in your browser and let CookieCloud sync, then retry.`);
    process.exit(1);
  }
  console.error(`✓ ${matched.length} cookies for ${domain}`);

  // 3. Normalize cookies for Browser Run
  const cookies = matched.map(c => ({
    name:     c.name,
    value:    c.value,
    domain:   c.domain || domain,
    path:     c.path || '/',
    expires:  c.expirationDate,
    httpOnly: c.httpOnly || false,
    secure:   c.secure || false,
    sameSite: normalizeSameSite(c.sameSite),
  }));

  // 4. Call Browser Run
  const result = await post({
    url: targetUrl,
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
    console.log(result.result);
  }
})();
JSEOF
```

## Endpoint Reference

| Endpoint | Returns | Best for |
|----------|---------|---------|
| `markdown` | Markdown text | Reading content, feeding to LLM |
| `content` | Full rendered HTML | Parsing with selectors |
| `screenshot` | PNG saved to `/tmp/browserrun_screenshot.png` | Visual verification |
| `json` | AI-extracted structured data | Add `"schema": {...}` to payload |
| `links` | All hyperlinks | Link discovery |

## Environment Variable Summary

| Variable | Description |
|---|---|
| `COOKIECLOUD_URL` | CookieCloud server URL, e.g. `http://localhost:8088` |
| `COOKIECLOUD_UUID` | UUID from the CookieCloud extension settings |
| `COOKIECLOUD_PASSWORD` | Encryption password from the extension |
| `CF_ACCOUNT_ID` | Cloudflare account ID |
| `CF_API_TOKEN` | Cloudflare API Token with Browser Rendering Edit permission |

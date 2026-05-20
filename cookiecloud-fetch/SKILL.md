---
name: cookiecloud-fetch
description: Fetch authenticated web content by injecting CookieCloud session cookies into Cloudflare Browser Run. Use this skill whenever a website requires login or has anti-scraping measures — social media feeds, SaaS dashboards, paywalled content, or any page that returns different content when logged in. Triggers on requests like "scrape this page (need to be logged in)", "fetch my xiaohongshu/weibo/bilibili feed", "take a screenshot of my dashboard", "extract data from a site that requires login", or any URL that needs a real user session.
allowed-tools:
  - Bash
---

# CookieCloud + Browser Run Authenticated Fetch

Pulls session cookies from CookieCloud, injects them into Cloudflare Browser Run, and returns the rendered page as if the user were logged in.

## Step 1 — Check Configuration

```bash
source ~/.zshrc 2>/dev/null
missing=()
[ -z "$COOKIECLOUD_URL" ]    && missing+=(COOKIECLOUD_URL)
[ -z "$COOKIECLOUD_UUID" ]   && missing+=(COOKIECLOUD_UUID)
[ -z "$COOKIECLOUD_PASSWORD" ] && missing+=(COOKIECLOUD_PASSWORD)
[ -z "$CF_ACCOUNT_ID" ]      && missing+=(CF_ACCOUNT_ID)
[ -z "$CF_API_TOKEN" ]       && missing+=(CF_API_TOKEN)

if [ ${#missing[@]} -gt 0 ]; then
  echo "MISSING: ${missing[*]}"
else
  echo "OK"
fi
```

If any variables are missing, ask the user to add them to `~/.zshrc`:

```bash
export COOKIECLOUD_URL="http://localhost:8088"    # CookieCloud server
export COOKIECLOUD_UUID="your-uuid"               # from extension settings
export COOKIECLOUD_PASSWORD="your-password"       # from extension settings
export CF_ACCOUNT_ID="your-account-id"            # Cloudflare Dashboard sidebar
export CF_API_TOKEN="your-api-token"              # Account / Browser Rendering / Edit
```

Then `source ~/.zshrc` and retry.

## Step 2 — Fetch

Locate the skill's `scripts/fetch.js` — it will be under `~/.claude/skills/cookiecloud-fetch/scripts/fetch.js` (user install) or `.claude/skills/cookiecloud-fetch/scripts/fetch.js` (project install). Then run:

```bash
source ~/.zshrc 2>/dev/null

# Set these before running:
TARGET_URL="https://example.com/page"
ENDPOINT="markdown"   # markdown | content | screenshot | json | links

SCRIPT=$(find ~/.claude .claude -path "*/cookiecloud-fetch/scripts/fetch.js" 2>/dev/null | head -1)
node "$SCRIPT" "$TARGET_URL" "$ENDPOINT"
```

Diagnostic lines (cookie count, errors) go to stderr. The page content goes to stdout.

## Endpoints

| Endpoint | Returns |
|----------|---------|
| `markdown` | Markdown — best for reading or passing to an LLM |
| `content` | Full rendered HTML |
| `screenshot` | PNG saved to `/tmp/browserrun_screenshot.png` |
| `json` | AI-extracted structured data |
| `links` | All hyperlinks on the page |

## No cookies found?

If the script exits with `No cookies found for "domain"`, the user hasn't logged into that site since the CookieCloud extension was installed, or the extension hasn't synced yet. Ask them to open the site in their browser and trigger a manual sync from the extension popup.

## Limitation

Only `cookie_data` is injected. `local_storage_data` is not — Browser Run Quick Actions don't support localStorage injection. Sites that store auth tokens exclusively in localStorage won't work with this skill.

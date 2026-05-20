# CookieCloud × Cloudflare Browser Run 技术说明

## 方案概述

用 [CookieCloud](https://github.com/easychen/CookieCloud) 同步的登录态 Cookie，注入 [Cloudflare Browser Run](https://developers.cloudflare.com/browser-run/) Quick Actions REST API，在 Cloudflare 全球边缘节点上以真实登录身份渲染页面。

整个流程由一个 Claude Code Skill（`cookiecloud-fetch`）驱动，AI 对话中遇到需要登录态的抓取任务时自动触发。

```
真实浏览器（人工登录）
    │  CookieCloud 扩展加密同步
    ▼
CookieCloud 服务端  GET /get/:uuid
    │  AES-128-CBC Fixed IV 解密，按域名匹配 cookie_data
    ▼
Cloudflare Browser Run  POST /browser-rendering/:endpoint
    │  注入 cookies[]，渲染页面
    ▼
HTML / Markdown / 截图 / 结构化 JSON
```

---

## CookieCloud 加密算法

本项目使用 CookieCloud 的 **Fixed IV** 模式（`aes-128-cbc-fixed`），而非旧版 OpenSSL Salted 格式。

```
key = MD5(uuid + "-" + password).substring(0, 16)
IV  = 16 字节全零（0x00 × 16）
算法：AES-128-CBC + PKCS7 padding
编码：Base64
```

Node.js 实现（内置 `crypto`，无外部依赖）：

```javascript
const crypto = require('crypto');

function decrypt(uuid, encrypted, password) {
  const hash = crypto.createHash('md5').update(`${uuid}-${password}`).digest('hex');
  const key  = Buffer.from(hash.substring(0, 16), 'utf8');
  const iv   = Buffer.alloc(16, 0);
  const dec  = crypto.createDecipheriv('aes-128-cbc', key, iv);
  let out = dec.update(Buffer.from(encrypted, 'base64'));
  return JSON.parse(Buffer.concat([out, dec.final()]).toString('utf8'));
}
```

---

## Cookie 字段映射

CookieCloud 返回的 cookie 对象与 Browser Run 接受的格式基本兼容，有两处需要处理：

| 问题 | CookieCloud 值 | Browser Run 要求 | 处理方式 |
|------|--------------|-----------------|---------|
| 字段名不同 | `expirationDate` | `expires` | 重命名 |
| sameSite 非标准值 | `"unspecified"` 等 | 只接受 `Strict`/`Lax`/`None` | 归一化为 `"Lax"` |

```javascript
const VALID_SAME_SITE = new Set(['Strict', 'Lax', 'None']);
function normalizeSameSite(v) {
  if (!v) return 'Lax';
  const s = v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
  return VALID_SAME_SITE.has(s) ? s : 'Lax';
}

const cookie = {
  name:     c.name,
  value:    c.value,
  domain:   c.domain,
  path:     c.path || '/',
  expires:  c.expirationDate,        // 字段重命名
  httpOnly: c.httpOnly || false,
  secure:   c.secure || false,
  sameSite: normalizeSameSite(c.sameSite),  // 归一化
};
```

---

## 已实现 / 未实现

| 功能 | 状态 | 说明 |
|------|------|------|
| Cookie 注入 | ✅ 已实现 | 支持全部 cookie 字段 |
| Fixed IV 解密 | ✅ 已实现 | 兼容新版 CookieCloud |
| 域名匹配 | ✅ 已实现 | 自动尝试 `example.com` 和 `.example.com` 两种 key |
| sameSite 归一化 | ✅ 已实现 | 处理 `"unspecified"` 等非标准值 |
| localStorage 注入 | ❌ 未实现 | Browser Run Quick Actions 不支持直接注入 localStorage；如有需要，须改用 Playwright Workers binding + `storageState` |

---

## Browser Run 使用限制

**Bot 标识不可屏蔽：** Browser Run 会在每个请求附加 `cf-biso-devtools`、`cf-brapi-request-id` 等头及密码学签名，无法移除。绝大多数站点只验证 Session Token 本身，不检查这些头，因此注入有效 Cookie 即可正常访问。少数使用 Cloudflare Bot Management 的站点会拦截该头。

**IP 来源变化：** 请求从 Cloudflare 边缘 IP 发出，与用户原始登录 IP 不同。对 IP 强绑定的站点（金融、政务类）可能导致 Session 失效。

**定价：**

| 套餐 | 免费额度 | 超出单价 |
|------|---------|---------|
| Workers Free | 10 分钟/天，3 并发 | 不可扩容 |
| Workers Paid | 10 小时/月，均值 10 并发 | $0.09/浏览器小时 |

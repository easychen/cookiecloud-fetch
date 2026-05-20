# CookieCloud + Cloudflare Browser Run 整合方案报告

> 调研日期：2026-05-20

---

## 一、背景与核心价值

**Cloudflare Browser Run**（原 Browser Rendering，2026 年 4 月 15 日更名）是运行在 Cloudflare 全球边缘节点上的托管无头浏览器服务，提供真实 Chromium 实例的编程控制能力。

**CookieCloud**（[github.com/easychen/CookieCloud](https://github.com/easychen/CookieCloud)）是一套浏览器扩展 + 自托管服务器方案，将真实用户在浏览器中登录后的 Cookie 和 localStorage 加密同步到服务端，供自动化程序调用。

**整合价值：** 用户在真实浏览器中完成登录，CookieCloud 自动同步加密的会话 Cookie 到服务端，自动化脚本取出 Cookie 后注入 Browser Run，即可以该用户身份在 Cloudflare 边缘节点上抓取任意登录态内容。这是目前最低摩擦、最接近"真实用户"的内容抓取方案。

---

## 二、Cloudflare Browser Run 概览

### 2.1 定位与架构

Browser Run 基于 Cloudflare Containers，运行真实 Chromium，部署在全球边缘。2026 年 4 月的 Agents Week 后，定位明确转向 **AI Agent 网页交互**，不再只是单纯的截图/渲染服务。

### 2.2 Quick Actions REST API

无需部署 Workers，直接调用 REST 接口：

| 端点 | 功能 |
|------|------|
| `/screenshot` | 截图（PNG/JPEG） |
| `/pdf` | 生成 PDF |
| `/content` | 获取渲染后 HTML |
| `/markdown` | 页面转 Markdown |
| `/scrape` | CSS 选择器提取元素 |
| `/json` | AI 驱动的结构化数据提取 |
| `/links` | 提取所有超链接 |
| `/crawl` | 多页爬取（beta，最多 100 页） |

基础 URL：`https://api.cloudflare.com/client/v4/accounts/<accountId>/browser-rendering/<endpoint>`

### 2.3 编程控制（支持 Cookie 注入）

- `@cloudflare/puppeteer` v1.1.0（基于 Puppeteer v22.13.1）
- `@cloudflare/playwright` v1.3.0（基于 Playwright v1.58.2）
- 原生 CDP（WebSocket）
- Stagehand（AI 意图驱动的元素操作）

**Cookie 注入示例（REST Quick Action）：**

```json
POST .../browser-rendering/content
{
  "url": "https://example.com/protected-page",
  "cookies": [
    {
      "name": "session_id",
      "value": "abc123",
      "domain": "example.com",
      "path": "/",
      "httpOnly": true,
      "secure": true,
      "sameSite": "Lax",
      "expires": 1999999999
    }
  ],
  "gotoOptions": { "waitUntil": "networkidle2" }
}
```

### 2.4 Agents Week 新功能（2026 年 4 月）

- **Live View**：实时查看 Agent 的浏览器会话（DOM、控制台、网络）
- **Human in the Loop（HITL）**：遇到验证码时暂停，由人工处理后交还给 Agent
- **Session Recordings**：以 rrweb 格式记录完整会话，可回放
- **WebMCP**：网站暴露 AI 可直接调用的工具（如 `searchFlights()`），跳过截图→分析→点击循环

### 2.5 定价

| 套餐 | 免费额度 | 超出单价 |
|------|---------|---------|
| Workers Free | 10 分钟/天，3 并发 | 不可付费扩容 |
| Workers Paid | 10 小时/月，均值 10 并发 | $0.09/浏览器小时；$2.00/额外并发 |

- 限制：最大 120 并发，1 个新实例/秒，10 个 Quick Action 请求/秒
- 计费从 2025 年 8 月 20 日开始

### 2.6 重要限制：Bot 标识不可屏蔽

Browser Run **始终向目标站点标识自己是 Bot**，无法伪装成真实用户浏览器：

- 每个请求都会附加 `cf-biso-devtools`、`cf-brapi-request-id` 等头
- 附加密码学签名（Web Bot Auth 标准）
- **注入有效 Session Cookie 是绕过此限制的主要手段**：若目标站点信任 Session Token 本身（绝大多数站点都如此），Bot 身份标识就不再重要

---

## 三、CookieCloud 概览

### 3.1 架构

- **浏览器扩展**（Chrome/Edge/Chromium）：捕获 Cookie 和 localStorage，加密后同步到自托管服务器
- **Node.js/Docker 服务端**：存储加密数据，暴露 REST API

### 3.2 加密模型

```
key = MD5(uuid + "-" + password).substring(0, 16)
算法：AES-CBC，OpenSSL 兼容的 "Salted__" 格式
```

### 3.3 API

| 端点 | 说明 |
|------|------|
| `POST /update` | 扩展上传加密数据 |
| `GET /get/:uuid?password=xxx` | 获取解密后的完整数据 |

**解密后数据结构：**

```json
{
  "cookie_data": {
    "example.com": [
      {
        "name": "session_id",
        "value": "abc123xyz",
        "domain": ".example.com",
        "path": "/",
        "expirationDate": 1999999999,
        "httpOnly": true,
        "secure": true,
        "sameSite": "Lax"
      }
    ]
  },
  "local_storage_data": {
    "example.com": { "key1": "value1" }
  }
}
```

### 3.4 部署

```bash
docker run -p=8088:8088 easychen/cookiecloud:latest
```

### 3.5 Python 库（PyCookieCloud）

```python
from pycookiecloud import PyCookieCloud

cc = PyCookieCloud('http://your-server:8088', 'YOUR-UUID', 'YOUR-PASSWORD')
data = cc.get_decrypted_data()
domain_cookies = data['cookie_data']['example.com']
```

---

## 四、整合方案

### 4.1 整体架构

```
┌─────────────────────┐   加密同步   ┌──────────────────────────┐
│   真实浏览器         │ ──────────▶ │  CookieCloud 服务端       │
│   （人工登录）       │            │  GET /get/:uuid           │
│   CookieCloud 扩展   │            └────────────┬─────────────┘
└─────────────────────┘                         │ 解密 + 提取
                                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                       自动化调度层                               │
│   Python / Node.js / Cloudflare Worker                         │
│   · 从 CookieCloud 拉取 Cookie                                  │
│   · 字段映射（expirationDate → expires）                        │
│   · 构造 Browser Run 请求 payload                               │
└─────────────────────────┬───────────────────────────────────────┘
                          │ POST with cookies[]
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│              Cloudflare Browser Run                              │
│   Quick Actions (/content /screenshot /json /crawl)             │
│   OR Puppeteer/Playwright Workers binding                        │
│   · 以登录态渲染页面                                            │
│   · 返回 HTML / 截图 / 结构化 JSON                             │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 字段映射（关键差异）

| CookieCloud 字段 | Browser Run 字段 | 说明 |
|-----------------|-----------------|------|
| `expirationDate` | `expires` | **唯一不兼容的字段名** |
| `domain` | `domain` | CookieCloud 可能有前导 `.`，需注意 |
| 其余字段 | 同名 | 直接复用 |

### 4.3 Python 完整示例

```python
import requests

COOKIECLOUD_URL = "http://your-server:8088"
COOKIECLOUD_UUID = "your-uuid"
COOKIECLOUD_PASSWORD = "your-password"
CF_ACCOUNT_ID = "your-account-id"
CF_API_TOKEN = "your-api-token"

def fetch_cookies_for_domain(domain: str) -> list[dict]:
    resp = requests.get(
        f"{COOKIECLOUD_URL}/get/{COOKIECLOUD_UUID}",
        params={"password": COOKIECLOUD_PASSWORD}
    )
    data = resp.json()
    raw_cookies = data.get("cookie_data", {}).get(domain, [])

    return [
        {
            "name": c["name"],
            "value": c["value"],
            "domain": c.get("domain", domain),
            "path": c.get("path", "/"),
            "expires": c.get("expirationDate"),   # 字段名转换
            "httpOnly": c.get("httpOnly", False),
            "secure": c.get("secure", False),
            "sameSite": c.get("sameSite", "Lax"),
        }
        for c in raw_cookies
    ]

def scrape_authenticated(url: str, domain: str, endpoint: str = "content") -> str:
    cookies = fetch_cookies_for_domain(domain)
    payload = {
        "url": url,
        "cookies": cookies,
        "gotoOptions": {"waitUntil": "networkidle2"}
    }
    resp = requests.post(
        f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/browser-rendering/{endpoint}",
        json=payload,
        headers={
            "Authorization": f"Bearer {CF_API_TOKEN}",
            "Content-Type": "application/json"
        }
    )
    return resp.json()["result"]

# 使用示例
html = scrape_authenticated(
    url="https://example.com/dashboard",
    domain="example.com",
    endpoint="content"   # 或 "screenshot"、"json"、"markdown"
)
```

### 4.4 Playwright + localStorage 注入（适用于 SPA）

Quick Actions 不支持 localStorage 注入，对于依赖 localStorage 的单页应用，使用 Playwright Workers binding：

```javascript
import { launch } from "@cloudflare/playwright";

export default {
  async fetch(request, env) {
    const { cookieData, localStorageData } = await fetchFromCookieCloud(env);

    // 构造 Playwright storageState（包含 Cookie + localStorage）
    const storageState = {
      cookies: cookieData["example.com"].map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expires: c.expirationDate ?? -1,
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite: c.sameSite,
      })),
      origins: [{
        origin: "https://example.com",
        localStorage: Object.entries(localStorageData["example.com"] ?? {})
          .map(([name, value]) => ({ name, value }))
      }]
    };

    const browser = await launch(env.MYBROWSER);
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();
    await page.goto("https://example.com/dashboard");
    const content = await page.content();
    await browser.close();

    return new Response(content, { headers: { "Content-Type": "text/html" } });
  }
};
```

---

## 五、典型应用场景

| 场景 | 方案 |
|------|------|
| **社交媒体内容抓取** | 用真实账号登录，同步 Cookie，抓取私信、Feed、粉丝数据等登录态内容 |
| **SaaS 报表导出** | 内部工具、分析平台的数据看板截图或 HTML 提取，无需对接 API |
| **电商个性化价格** | 注入账号 Cookie 获取会员价、B2B 定制价格 |
| **付费内容访问** | 订阅制网站（新闻、学术、视频）的内容提取 |
| **多账号轮换** | 每个账号对应独立的 CookieCloud UUID/Password，按需切换 |
| **AI Agent 数据获取** | 结合 Browser Run 的 `/json` 端点，AI 自动解析结构化数据 |
| **监控 & 告警** | 定时抓取需登录的仪表盘页面，检测数据变化 |

---

## 六、挑战与注意事项

### 6.1 Bot 标识问题

Browser Run 的 `cf-biso-devtools` 和加密签名头**无法移除**。若目标站点使用 Cloudflare Bot Management 并主动拦截此头，注入 Cookie 也无效。

**应对方案：**
- 大多数站点只验证 Session Token，不检查浏览器指纹，直接注入即可
- 对于有 Cloudflare 保护的目标站点，可借助 HITL 功能由人工完成验证，然后将 `cf_clearance` Cookie 通过 CookieCloud 同步回来

### 6.2 IP 异常检测

Browser Run 从 Cloudflare 边缘 IP 发出请求，与用户真实登录 IP 不同。部分站点（金融、政务类）会因 IP 骤变而使 Session 失效。

### 6.3 Cookie 过期

CookieCloud 扩展在检测到变化或按配置周期自动同步。需监控 Cookie 有效期，在抓取前校验 `expirationDate`，过期则提示用户重新登录。

### 6.4 域名匹配

CookieCloud 存储的域名 key 可能是 `example.com` 或 `.example.com`，需归一化处理：

```python
domain_keys = [domain, f".{domain}", domain.lstrip(".")]
for key in domain_keys:
    if key in cookie_data:
        raw_cookies = cookie_data[key]
        break
```

### 6.5 安全性

CookieCloud 的加密 key 为 `MD5(uuid+password)` 前 16 位，强度有限。建议：
- CookieCloud 服务端部署在内网或 VPN 内
- 使用 HTTPS
- 不要将 UUID 和 Password 明文提交到代码仓库

### 6.6 免费套餐不够用

Free 套餐 10 分钟/天，只适合个人轻度测试。生产环境需 Workers Paid（$5/月基础 + $0.09/浏览器小时）。

---

## 七、推荐实现路径

### 阶段一：最小可行方案（MVP）

1. 部署 CookieCloud 服务端（Docker 一键启动）
2. 安装浏览器扩展，配置同步
3. 写 Python 脚本：拉 Cookie → 调 Browser Run `/content` → 解析 HTML
4. 验证目标站点的认证抓取效果

### 阶段二：服务化

1. 封装为 HTTP 服务，接受 `(url, domain)` 参数，返回内容
2. 增加 Cookie 有效期检查和自动告警
3. 多域名 Cookie 路由（按 URL 自动选对应账号的 Cookie）
4. 结果缓存（利用 Browser Run 的 Cache TTL 参数，避免重复计费）

### 阶段三：AI 驱动

1. 使用 Browser Run `/json` 端点 + 自定义 schema，直接输出结构化数据
2. 接入 HITL 应对验证码
3. 结合 Stagehand 实现意图驱动的网页操作（而非固定 CSS 选择器）

---

## 八、总结

| 维度 | 结论 |
|------|------|
| **技术可行性** | ✅ 高——字段格式高度兼容，`expirationDate→expires` 是唯一需处理的差异 |
| **实现复杂度** | ✅ 低——核心代码不超过 50 行 |
| **适用场景** | 登录态内容抓取、SaaS 数据导出、多账号管理 |
| **主要风险** | Bot 头不可屏蔽、IP 异常、Cookie 过期 |
| **成本** | 中等——生产环境需 Workers Paid，按实际浏览器时长计费 |

CookieCloud 解决了"如何安全获取真实用户 Session"的问题，Browser Run 解决了"如何在无需维护浏览器基础设施的情况下使用该 Session 渲染内容"的问题。两者组合，是目前搭建**轻量、低维护成本的登录态内容抓取服务**的最优路径之一。

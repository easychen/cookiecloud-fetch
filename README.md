# CookieCloud × Cloudflare Browser Run

把 [CookieCloud](https://github.com/easychen/CookieCloud) 同步的登录态 Cookie 注入 [Cloudflare Browser Run](https://developers.cloudflare.com/browser-run/)，在 Cloudflare 边缘节点上以真实登录身份抓取网页内容。

提供一个即装即用的 Claude Code Skill（`.skill` 文件），在 AI 对话中遇到需要登录态访问的网站时自动触发。

## 工作原理

```
真实浏览器（人工登录）
    ↓ CookieCloud 扩展自动同步（加密）
CookieCloud 自托管服务端
    ↓ 解密 + 域名匹配
Cloudflare Browser Run（边缘 Chromium）
    ↓ 注入 Cookie，渲染页面
返回 HTML / Markdown / 截图 / 结构化 JSON
```

**优势：** 用户只需在浏览器里正常登录一次，AI 后续就能以该身份访问任何需要登录的页面，无需手动管理 Cookie 或维护浏览器基础设施。

## 前置条件

### CookieCloud

1. 部署服务端（Docker 一键启动）：
   ```bash
   docker run -d -p 8088:8088 easychen/cookiecloud:latest
   ```
2. 在 Chrome/Edge 中安装 [CookieCloud 扩展](https://github.com/easychen/CookieCloud)
3. 在扩展设置页记下 **Server URL**、**UUID**、**Password**

注意使用 CookieCloud 的 **Fixed IV** 模式（`aes-128-cbc-fixed`）

<img width="332" height="531" alt="image" src="https://github.com/user-attachments/assets/72ef324c-7927-4377-a72a-e85431d280e6" />



### Cloudflare Browser Run

1. 注册 [Cloudflare](https://dash.cloudflare.com) 账号（需开通 Workers Paid，$5/月起）
2. 记下右侧边栏的 **Account ID**
3. 创建 API Token：**My Profile → API Tokens → Create Token → Custom Token**
   - Permission：`Account / Browser Rendering / Edit`

### 环境变量

在 `~/.zshrc`（或 `~/.bashrc`）中添加：

```bash
# CookieCloud
export COOKIECLOUD_URL="http://localhost:8088"
export COOKIECLOUD_UUID="your-uuid"
export COOKIECLOUD_PASSWORD="your-password"

# Cloudflare Browser Run
export CF_ACCOUNT_ID="your-account-id"
export CF_API_TOKEN="your-api-token"
```

然后执行 `source ~/.zshrc`。

## 安装 Skill

下载 [`cookiecloud-fetch.skill`](./cookiecloud-fetch.skill)，双击安装（需已安装 Claude Code），或：

```bash
claude skill install cookiecloud-fetch.skill
```

## 使用方式

在 Claude Code 对话中，遇到需要登录态的抓取任务时直接描述即可：

> 帮我抓取小红书这个链接的内容：https://www.xiaohongshu.com/explore
>
> 帮我截一张微博首页的截图
>
> 把这个 B 站页面的内容提取成结构化数据：https://...

Skill 会自动：
1. 检查环境变量配置
2. 从 CookieCloud 拉取并解密对应域名的 Cookie
3. 注入 Cloudflare Browser Run 渲染页面
4. 返回 HTML / Markdown / 截图

**支持的输出格式：**

| 参数 | 返回内容 |
|------|---------|
| `markdown` | Markdown 文本（适合 LLM 继续处理） |
| `content` | 完整渲染 HTML |
| `screenshot` | PNG 截图（保存至 `/tmp/browserrun_screenshot.png`） |
| `json` | AI 提取的结构化数据 |

## 目前已验证的域名

- 小红书（xiaohongshu.com）
- 微博（weibo.com / weibo.cn）
- X / Twitter（x.com）
- B 站（bilibili.com）
- 抖音（douyin.com）
- 掘金（juejin.cn）

只要 CookieCloud 扩展同步了对应域名的 Cookie，任何网站都可以使用。

## 技术说明

- **解密算法**：AES-128-CBC，Fixed IV（16 字节全零），Key = `MD5(uuid-password)` 前 16 位
- **运行时依赖**：Node.js（使用内置 `crypto` 模块，无需安装额外包）
- **Cookie 兼容处理**：自动将 `sameSite: "unspecified"` 归一化为 `"Lax"`，`expirationDate` 映射为 `expires`
- **Bot 标识**：Cloudflare Browser Run 会在请求头中附加 bot 标识（`cf-biso-devtools`），无法移除；注入有效 Session Cookie 后，绝大多数站点仍会信任该会话

## 文件说明

```
cookiecloud-fetch/
└── SKILL.md          # Skill 源文件（skills.sh 标准目录结构）
cookiecloud-fetch.skill           # 打包好的 skill 安装文件
CookieCloudRun.md                 # 技术说明文档
```

## License

[MIT](./LICENSE)

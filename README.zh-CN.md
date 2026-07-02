# VCC 虚拟卡目录

VCC 虚拟卡目录是一个部署在 Cloudflare Workers 上的双语虚拟信用卡平台导航站。它支持平台目录、卡段信息、标签筛选、内容发布、后台管理，以及供 Hermes agent 调用的受保护内容发布 API。

英文文档：[README.md](./README.md)

## 功能特性

- 虚拟卡平台目录，支持搜索和标签筛选
- 平台详情页，展示平台信息和活跃卡段
- 卡段详情页，展示费用、币种、额度、使用场景等信息
- 中英文双语界面
- 内容发布功能：内容中心和文章详情页
- 管理后台：平台、卡段、标签、内容、密码管理
- 通过 Cloudflare R2 上传和代理 Logo 图片
- Cloudflare D1 数据库结构和初始化数据
- 供 Hermes agent 调用的 Bearer Token 保护 API
- Google SEO 基础优化：sitemap、robots.txt、canonical、后台 noindex、Open Graph、JSON-LD 结构化数据

## 技术栈

- 运行环境：Cloudflare Workers
- Web 框架：Hono + Hono JSX
- 数据库：Cloudflare D1
- 对象存储：Cloudflare R2
- 开发语言：TypeScript
- 样式：Tailwind CSS CDN

## 项目结构

```text
src/
  index.tsx       Worker 主应用、路由、API、后台页面
  layout.tsx      HTML 布局、meta 标签、导航
  i18n.ts         中英文翻译
  types.ts        TypeScript 类型定义
schema.sql        D1 数据库结构和初始化数据
wrangler.jsonc    Cloudflare Worker 配置
hermes-skills/    Hermes agent skill 文档
```

## 环境要求

- Node.js
- npm
- Cloudflare 账号
- Wrangler CLI，本项目通过依赖安装

安装依赖：

```bash
npm install
```

## 配置说明

`wrangler.jsonc` 中定义了 D1、R2 和环境变量绑定：

```json
{
  "vars": {
    "ADMIN_PASSWORD": "change-me-in-production",
    "SESSION_SECRET": "change-me-in-production",
    "HERMES_API_TOKEN": "change-me-in-production",
    "SITE_URL": "https://example.com"
  }
}
```

请将 `SITE_URL` 改成生产环境真实域名，例如：

```json
"SITE_URL": "https://your-domain.com"
```

生产环境不要把真实密钥写入仓库，建议使用 Wrangler secrets：

```bash
wrangler secret put SESSION_SECRET
wrangler secret put HERMES_API_TOKEN
```

本地开发可创建 `.dev.vars`：

```env
ADMIN_PASSWORD="change-me-in-production"
SESSION_SECRET="your-local-session-secret"
HERMES_API_TOKEN="your-local-hermes-token"
SITE_URL="http://127.0.0.1:8787"
```

`.dev.vars` 已加入 `.gitignore`，不会被 Git 提交。

## 数据库初始化

初始化本地 D1 数据库：

```bash
npm run db:init
```

初始化远程 D1 数据库：

```bash
npm run db:init:remote
```

数据库包含以下表：

- `vcc_providers`：平台表
- `vcc_cards`：卡段表
- `vcc_tags`：标签表
- `vcc_provider_tags`：平台和标签关联表
- `admin_users`：管理员表
- `content_posts`：内容发布表

初始化数据包含示例标签、平台、卡段和默认管理员。

默认管理员账号：

```text
用户名：admin
密码：admin123
```

首次登录后请立即修改密码。

## 本地开发

启动本地 Worker：

```bash
npm run dev
```

常用本地地址：

- `http://127.0.0.1:8787/`
- `http://127.0.0.1:8787/content`
- `http://127.0.0.1:8787/login`
- `http://127.0.0.1:8787/admin`
- `http://127.0.0.1:8787/sitemap.xml`
- `http://127.0.0.1:8787/robots.txt`

运行 TypeScript 检查：

```bash
npx tsc --noEmit
```

## 部署

部署到 Cloudflare Workers：

```bash
npm run deploy
```

部署前请确认：

- `SITE_URL` 已设置为真实生产域名。
- 已通过 `wrangler secret put` 配置 `SESSION_SECRET` 和 `HERMES_API_TOKEN`。
- 已执行 `npm run db:init:remote` 初始化远程 D1。
- `wrangler.jsonc` 中的 D1 数据库和 R2 Bucket 配置正确。

## 公开路由

- `GET /`：平台目录首页
- `GET /provider/:slug`：平台详情页
- `GET /card/:slug`：卡段详情页
- `GET /content`：内容中心
- `GET /content/:slug`：内容文章详情页
- `GET /sitemap.xml`：XML sitemap
- `GET /robots.txt`：爬虫规则
- `GET /images/*`：R2 图片代理
- `GET /lang/:lang`：语言切换

## 后台路由

后台页面使用签名 Cookie 和 CSRF 防护。

- `GET /login`
- `POST /login`
- `GET /logout`
- `GET /admin`
- `/admin/provider/...`：平台管理
- `/admin/card/...`：卡段管理
- `/admin/content/...`：内容管理
- `/admin/tag/...`：标签管理
- `/admin/password`：修改密码

## Hermes Agent API

Hermes API 使用 Bearer Token 保护：

```http
Authorization: Bearer <HERMES_API_TOKEN>
Content-Type: application/json
```

接口列表：

- `GET /api/admin/content`
- `GET /api/admin/content/:id`
- `POST /api/admin/content`
- `PUT /api/admin/content/:id`
- `DELETE /api/admin/content/:id`

创建内容示例：

```bash
curl -X POST "$SITE_URL/api/admin/content" \
  -H "Authorization: Bearer $HERMES_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title_zh": "虚拟卡费用指南",
    "title_en": "Virtual Card Fee Guide",
    "slug": "virtual-card-fee-guide",
    "excerpt_zh": "快速了解开卡费、月费和充值手续费。",
    "excerpt_en": "A quick guide to issuance fees, monthly fees, and top-up rates.",
    "body_zh": "第一段中文正文。\n\n第二段中文正文。",
    "body_en": "First English paragraph.\n\nSecond English paragraph.",
    "status": "published"
  }'
```

Hermes skill 文档位置：

```text
hermes-skills/vcc-content-publisher/SKILL.md
```

## SEO 说明

站点已包含以下 Google SEO 基础能力：

- 基于 `SITE_URL` 的绝对 canonical URL
- `robots.txt`
- `sitemap.xml`
- 登录页、后台页和 API 输出 `noindex,nofollow`
- Open Graph 和 Twitter summary 标签
- JSON-LD 结构化数据，包括 WebSite、Organization、ItemList、BreadcrumbList、FinancialProduct、Blog、BlogPosting

部署后建议在 Google Search Console 提交：

```text
https://your-domain.com/sitemap.xml
```

## 安全注意事项

- 首次登录后请立即修改默认管理员密码。
- 生产环境必须使用强随机 `SESSION_SECRET` 和 `HERMES_API_TOKEN`。
- 不要提交 `.dev.vars`。
- 后台删除操作使用 POST 和 CSRF 防护。
- Hermes API 使用 Bearer Token 认证，并标记为 `noindex`。

## 常用命令

```bash
npm install
npm run dev
npm run db:init
npm run db:init:remote
npx tsc --noEmit
npm run deploy
```

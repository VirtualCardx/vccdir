# VCC 虚拟卡目录

部署在 Cloudflare Workers 上的双语虚拟信用卡平台目录。公开站点展示平台、卡段和文章；所有数据维护由 Hermes agent 通过受保护 API 完成，不提供登录页或网页管理后台。

英文文档：[README.md](./README.md)

## 技术栈

- Cloudflare Workers、D1、R2
- Hono + Hono JSX + TypeScript
- 构建期 Tailwind CSS
- Vitest

## 项目结构

```text
src/index.tsx       Worker 入口：中间件、语言路由、sitemap 和装配
src/pages.tsx       公开页面处理器（中文与 /en 英文）
src/admin.ts        Hermes 管理 API，挂载于 /api/admin
src/components.tsx  分页、卡片与文章列表组件
src/layout.tsx      HTML 布局、SEO 和页面样式
src/lib/            净化、API 校验、SEO 与 D1 工具
src/i18n.ts         中英文翻译与 URL 语言辅助
src/types.ts        数据类型
schema.sql          新数据库结构和示例数据
migrations/         现有数据库迁移
hermes-skills/      Hermes 维护 skill
```

## 配置

生产环境只需要一个管理密钥：

```bash
wrangler secret put HERMES_API_TOKEN
```

本地创建 `.dev.vars`：

```env
HERMES_API_TOKEN="replace-with-a-strong-local-random-token"
SITE_URL="http://127.0.0.1:8787"
```

D1、R2 和生产站点域名配置位于 `wrangler.jsonc`。

## 安装与本地运行

```bash
npm install
npm run db:init
npm run dev
```

常用地址包括 `http://127.0.0.1:8787/`、`/content` 和 `/sitemap.xml`。

检查项目：

```bash
npm run check
npm audit --omit=dev
```

## 数据库

新环境使用 `npm run db:init` 或 `npm run db:init:remote`。从旧版网页后台升级的环境还需要执行：

```bash
npm run db:migrate
# 确认生产目标后：
npm run db:migrate:remote
```

迁移会删除已废弃的 `admin_users` 表，并添加常用查询索引。远程命令会修改生产数据，执行前应确认目标 Cloudflare 账号和数据库。

## 路由

公开路由：

- `GET /`
- `GET /providers`：虚拟卡平台目录，支持 `q` 搜索和 `page` 分页
- `GET /provider/:slug`
- `GET /card/:slug`
- `GET /content`
- `GET /content/:slug`
- `GET /images/*`
- `GET /sitemap.xml`
- `GET /robots.txt`
- `GET /lang/:lang`

平台与卡段是父子关系：`/providers` 按平台浏览（地区、KYC、标签、卡段数量等平台级信息），平台详情页列出该平台全部卡段，卡段详情页经平台页或直接 URL 访问。首页提供"虚拟卡平台"栏目（最多 9 个平台）与行业动态。

原卡段目录 `/cards` 已移除，301 跳转到 `/providers`。搜索词会按字节预算截断，保证 SQL LIKE 模式不超过 D1 的 50 字节上限。

语言由 URL 决定：无前缀路径为中文，`/en/*` 为英文。所有可索引页面输出 `hreflang` 备选链接（`zh-CN`、`en`、`x-default`），sitemap 同时列出两种语言版本。`lang` cookie 为 `en` 的访问者会被 302 跳转到 `/en` 页面；不带 cookie 的爬虫始终看到默认中文 URL，已有索引数据不受影响。

停用的平台详情页返回 200 并显示醒目的停运提示，保持可索引（hreflang 齐全）并以低优先级（0.3/yearly）收录进 sitemap，让搜索“XX 停运”的用户能找到警示；停用卡段同为 200 + 提示，但设为 noindex（薄页）；草稿文章不会公开。

首页将精选和最新内容合并为两个栏目：精选虚拟卡置顶后接最新虚拟卡，精选文章置顶后接最新文章，且不会重复。Hermes 通过卡片/文章的 `is_featured` 字段控制置顶内容。行业动态 `/content` 每页展示 9 篇文章；虚拟卡目录 `/cards` 每页展示 12 张卡。

Hermes API 使用 `Authorization: Bearer <HERMES_API_TOKEN>`：

- `/api/admin/providers`
- `/api/admin/cards`
- `/api/admin/tags`
- `/api/admin/content`
- `/api/admin/images`

完整字段、上传约束和维护流程见 [Hermes skill](./hermes-skills/vcc-content-publisher/SKILL.md)。

文章可以设置 `featured_image_url`。先调用 `POST /api/admin/images?kind=content` 上传 PNG、JPEG、WebP 或 GIF，再把返回的 `content/...` 对象键写入文章。特色图片会用于首页、行业动态列表、文章头图、Open Graph 和 BlogPosting 结构化数据。

## 部署

```bash
npm run check
npm run deploy
```

部署前确认远程 D1 已初始化或迁移、R2 Bucket 正确、`SITE_URL` 为正式域名，并已配置强随机 `HERMES_API_TOKEN`。

## 安全说明

- 管理 API 不接受缺失或示例 Token。
- JSON 请求限制为 256 KiB。
- Logo 仅允许 PNG、JPEG、WebP、GIF，最大 2 MiB。
- 管理 API 禁止缓存和索引。
- 页面输出包含 CSP、点击劫持保护、MIME 嗅探保护等响应头。
- 文章 HTML 使用标签白名单；JSON-LD 会转义脚本边界字符。
- 分页页使用独立 canonical 和 `rel=prev/next`；站内搜索结果使用 `noindex,follow`，避免产生重复索引。

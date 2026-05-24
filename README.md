# Site Builder

Cloudflare Pages + D1 动态网站一键生成器。

自动创建项目脚手架、D1 数据库、前后端模板。纯命令行操作，无需网页后台。

## 功能

- ✅ 一行命令生成完整站点
- ✅ 自动创建 D1 数据库 + 建表
- ✅ 内置登录/鉴权系统
- ✅ 前端（列表/搜索/日历/写新篇）
- ✅ 后端（完整 CRUD API）
- ✅ 即刻部署到 Cloudflare Pages
- 🤖 **内置 AI 摘要接口** — 其他 AI 可直接读取内容

## 快速开始

### 1. 前置依赖

```bash
# Node.js
node --version  # >= 18

# Cloudflare Wrangler CLI
npm install -g wrangler
wrangler --version  # >= 4.0
```

### 2. 获取 Cloudflare API Token

1. 打开 https://dash.cloudflare.com/profile/api-tokens
2. 点 **Create Token**
3. 选模板 **Edit Cloudflare Workers**
4. 权限设置：
   - Account Resources → 你的账号
   - Zone Resources → All zones
5. 点 **Continue to Summary** → **Create Token**
6. 复制生成的 token

### 3. 获取 Cloudflare Account ID

1. 打开 https://dash.cloudflare.com/
2. 右侧栏找到 **Account ID**，复制它

### 4. 设置环境变量

```bash
# Windows (PowerShell)
$env:CLOUDFLARE_API_TOKEN = "你生成的token"
$env:CF_ACCOUNT_ID = "你的Account ID"

# macOS / Linux
export CLOUDFLARE_API_TOKEN="你生成的token"
export CF_ACCOUNT_ID="你的Account ID"
```

### 5. 一键建站

```bash
node create-site.js my-site
```

### 6. 部署

```bash
cd my-site
wrangler pages deploy . --project-name=my-site --branch=main
```

## 生成的项目结构

```
my-site/
├── index.html                 # 前端（Tailwind + Alpine.js）
├── _routes.json               # 路由配置
├── functions/api/
│   └── [[path]].js            # 后端 API（CRUD + 鉴权）
└── wrangler.toml              # Cloudflare 配置（D1 绑定）
```

## 数据库结构

```sql
-- 内容表
CREATE TABLE entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT DEFAULT '日记',      -- 日记/备忘录/思考
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tomorrow_plan TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at DATETIME
);

-- 设置表（存密码等）
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

## Agent 分工（使用了 OpenClaw 的情况下）

| 环节 | 负责 |
|------|------|
| 🏗 生成脚手架 | `node create-site.js` |
| 🎨 美化前端 | frontend-developer（前端工程师） |
| ⚙️ 完善后端 | backend-architect（后端工程师） |
| 🔍 代码审查 | code-tester（测试员） |

## AI 摘要接口

每个用 site-builder 生成的站点自动包含 AI 摘要接口，方便其他 AI Agent 读取内容。

```bash
# 获取最近 7 天内容
curl -H "X-AI-Token: <你的AI_TOKEN>" https://your-site.pages.dev/api/ai/digest?days=7
```

返回按日期归类的 JSON，包含日记/思考/备忘录，AI 可直接解析。

## License

MIT
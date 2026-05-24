---
name: site-builder
description: Cloudflare Pages + D1 动态网站一键生成器。自动创建项目脚手架、D1数据库、前后端模板，一键部署上线。
---

# Site Builder — 动态网站搭建技能

基于 Cloudflare Pages + D1 的动态网站脚手架生成工具。

## 前置条件

```bash
# 设置 Cloudflare API Token（必填）
set CLOUDFLARE_API_TOKEN=你的token
```

## 用法

```bash
# 一键生成新站点
node skills/site-builder/scripts/create-site.js <项目名>

# 示例
node skills/site-builder/scripts/create-site.js my-blog
```

> ⚠️ 本技能不含敏感 Key，运行时需通过环境变量 `CLOUDFLARE_API_TOKEN` 传入。

## 生成的项目结构

```
my-blog/
├── index.html            # 前端页面（含登录/列表/写/搜索/日历）
├── _routes.json          # API 路由
├── functions/api/
│   └── [[path]].js       # 后端 CRUD + 鉴权
└── wrangler.toml         # Cloudflare 配置（D1 绑定）
```

## Agent 分工

| 环节 | 负责 Agent | 说明 |
|------|-----------|------|
| 🏗 生成脚手架 | 本技能自动完成 | 执行 `create-site.js` |
| 🎨 前端开发 | **frontend-developer** | 修改 index.html |
| ⚙️ 后端开发 | **backend-architect** | 修改 `[[path]].js` |
| 🔍 审查 | **code-tester** | 审查代码质量 |
| 🏆 验收 | **Main（小杨）** | 最终把关 |

## 相关文档

- `learn/dynamic-site-building-guide.md` — 建站完整指南
- `learn/cloudflare-pages-deploy.md` — Cloudflare Pages 部署
- `learn/agent-collaboration-management.md` — Agent 分工管理
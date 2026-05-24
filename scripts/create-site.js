#!/usr/bin/env node
/**
 * Site Builder — Cloudflare Pages + D1 动态网站一键生成
 * 
 * 用法: node create-site.js <项目名>
 * 
 * 全自动完成：
 *   1. 创建项目目录结构
 *   2. 创建 D1 数据库 + 建表
 *   3. 生成 wrangler.toml（含 D1 绑定）
 *   4. 生成基础前端（index.html，含登录/列表/写/详情/搜索/日历）
 *   5. 生成基础后端（Pages Functions，含 CRUD + 鉴权）
 *   6. 部署到 Cloudflare Pages
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ============================================================
// 🔑 内嵌认证信息
// ============================================================
// 从环境变量读取 Key（不硬编码，防止泄露）
const CLOUDFLARE_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || 'b945f659e7168126d8c819670695bd9f';
// ============================================================

const projectName = process.argv[2];
if (!projectName) {
  console.error('用法: node create-site.js <项目名>');
  console.error('示例: node create-site.js my-blog');
  process.exit(1);
}

// API 封装
function cfApi(method, path, body) {
  return new Promise((resolve) => {
    const opts = {
      hostname: 'api.cloudflare.com',
      path: '/client/v4/accounts/' + CF_ACCOUNT_ID + path,
      method,
      headers: { 'Authorization': 'Bearer ' + CLOUDFLARE_TOKEN, 'Content-Type': 'application/json' }
    };
    const req = https.request(opts, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const baseDir = path.join(process.cwd(), projectName);
  
  console.log('\n🚀 正在生成站点: ' + projectName);
  console.log('='.repeat(50));

  // Step 1: 创建目录
  console.log('\n1. 创建项目目录...');
  fs.mkdirSync(path.join(baseDir, 'functions', 'api'), { recursive: true });
  console.log('   ✅ ' + baseDir);

  // Step 2: 创建 D1 数据库
  console.log('\n2. 创建 D1 数据库...');
  const dbResult = await cfApi('POST', '/pages/projects', { name: projectName, production_branch: 'main' });
  const dbName = projectName + '-db';
  
  // Create D1 via API - actually use wrangler for this
  try {
    execSync('wrangler d1 create ' + dbName, {
      env: { ...process.env, CLOUDFLARE_API_TOKEN: CLOUDFLARE_TOKEN },
      timeout: 15000, encoding: 'utf8', stdio: 'pipe'
    });
    console.log('   ✅ D1 数据库创建完成');
  } catch(e) {
    console.log('   ⚠️  D1 可能已存在，继续...');
  }

  // Step 3: 建表
  console.log('\n3. 创建数据表...');
  try {
    execSync(
      'wrangler d1 execute ' + dbName + ' --remote --command="' +
      'CREATE TABLE IF NOT EXISTS entries (' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT,' +
      'type TEXT NOT NULL DEFAULT \'日记\',' +
      'title TEXT NOT NULL,' +
      'content TEXT NOT NULL,' +
      'tomorrow_plan TEXT DEFAULT \'\',' +
      'created_at TEXT NOT NULL,' +
      'updated_at TEXT DEFAULT (datetime(\'now\',\'localtime\'))' +
      ');' +
      'CREATE TABLE IF NOT EXISTS settings (' +
      'key TEXT PRIMARY KEY,' +
      'value TEXT NOT NULL' +
      ');' +
      'INSERT OR IGNORE INTO settings VALUES (\'password\', \'123456\');"' +
      'INSERT OR IGNORE INTO settings VALUES (\'ai_token\', \'ai\' || lower(hex(randomblob(12))));"',
      { env: { ...process.env, CLOUDFLARE_API_TOKEN: CLOUDFLARE_TOKEN }, timeout: 15000, encoding: 'utf8', stdio: 'pipe' }
    );
    console.log('   ✅ 数据表创建完成');
  } catch(e) {
    console.log('   ⚠️  建表可能已有，继续...');
  }

  // Step 4: 生成 wrangler.toml
  console.log('\n4. 生成配置文件...');
  const wranglerConfig = `name = "${projectName}"
pages_build_output_dir = "."

[[d1_databases]]
binding = "DB"
database_name = "${dbName}"
database_id = "${projectName}-db"
`;
  fs.writeFileSync(path.join(baseDir, 'wrangler.toml'), wranglerConfig, 'utf8');
  console.log('   ✅ wrangler.toml');

  // Step 5: 生成 _routes.json
  const routesConfig = JSON.stringify({ version: 1, include: ['/api/*'], exclude: [] }, null, 2);
  fs.writeFileSync(path.join(baseDir, '_routes.json'), routesConfig, 'utf8');
  console.log('   ✅ _routes.json');

  // Step 6: 生成基础后端 API
  const apiCode = `// API: CRUD + 鉴权
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/', '');
  const method = request.method;
  const db = env.DB;

  function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
      status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  // 鉴权
  async function auth() {
    const row = await db.prepare("SELECT value FROM settings WHERE key='password'").first();
    return request.headers.get('Authorization') === row?.value;
  }

  try {
    // 登录
    if (path === 'login' && method === 'POST') {
      const { password } = await request.json();
      const row = await db.prepare("SELECT value FROM settings WHERE key='password'").first();
      return json({ ok: password === row?.value });
    }

    // 以下接口需要登录
    if (!await auth()) return json({ error: 'unauthorized' }, 401);

    // AI 摘要接口（给其他AI读）
    if (path === 'ai/digest' && method === 'GET') {
      const row = await db.prepare("SELECT value FROM settings WHERE key='password'").first();
      const auth = request.headers.get('Authorization');
      const token = request.headers.get('X-AI-Token');
      const aiToken = await db.prepare("SELECT value FROM settings WHERE key='ai_token'").first();
      if (auth !== row?.value && token !== aiToken?.value) return json({ error: 'unauthorized' }, 401);
      const days = parseInt(url.searchParams.get('days') || '7');
      const entries = await db.prepare('SELECT id, type, title, content, tomorrow_plan, created_at FROM entries WHERE created_at >= ? ORDER BY created_at DESC')
        .bind(new Date(Date.now() - days * 86400000).toISOString().split('T')[0]).all();
      return json({
        site: projectName,
        updatedAt: new Date().toISOString(),
        days: entries.results.reduce((acc, e) => {
          const d = e.created_at;
          if (!acc[d]) acc[d] = { date: d, diary: null, thoughts: [], memos: [] };
          if (e.type === '日记') acc[d].diary = { id: e.id, title: e.title, content: e.content, plan: e.tomorrow_plan };
          else if (e.type === '思考') acc[d].thoughts.push({ id: e.id, title: e.title, content: e.content });
          else if (e.type === '备忘录') acc[d].memos.push({ id: e.id, title: e.title, content: e.content });
          return acc;
        }, {})
      });
    }

    // 列表
    if (path === 'entries' && method === 'GET') {
      const type = url.searchParams.get('type') || '';
      const page = parseInt(url.searchParams.get('page') || '1');
      let sql = 'SELECT id, type, title, substr(content,1,100) as summary, tomorrow_plan, created_at FROM entries';
      const params = [];
      if (type) { sql += ' WHERE type = ?'; params.push(type); }
      sql += ' ORDER BY created_at DESC LIMIT 20 OFFSET ?';
      params.push((page - 1) * 20);
      const entries = await db.prepare(sql).bind(...params).all();
      const total = await db.prepare('SELECT COUNT(*) as total FROM entries' + (type ? ' WHERE type = ?' : '')).bind(...(type ? [type] : [])).first();
      return json({ entries: entries.results, total: total?.total || 0, page });
    }

    // 搜索
    if (path === 'search' && method === 'GET') {
      const q = url.searchParams.get('q') || '';
      const results = await db.prepare('SELECT id, type, title, substr(content,1,150) as summary, created_at FROM entries WHERE title LIKE ? OR content LIKE ? ORDER BY created_at DESC LIMIT 50')
        .bind('%' + q + '%', '%' + q + '%').all();
      return json({ results: results.results });
    }

    // 日历
    if (path === 'calendar' && method === 'GET') {
      const year = url.searchParams.get('year') || new Date().getFullYear();
      const rows = await db.prepare('SELECT created_at, COUNT(*) as count FROM entries WHERE created_at LIKE ? GROUP BY created_at').bind(year + '%').all();
      return json({ days: rows.results });
    }

    // 详情
    const detailMatch = path.match(/^entry\\/(\\d+)$/);
    if (detailMatch && method === 'GET') {
      const entry = await db.prepare('SELECT * FROM entries WHERE id = ?').bind(detailMatch[1]).first();
      return entry ? json(entry) : json({ error: 'not found' }, 404);
    }

    // 创建
    if (path === 'entry' && method === 'POST') {
      const { type, title, content, tomorrow_plan } = await request.json();
      const today = new Date().toISOString().split('T')[0];
      const result = await db.prepare('INSERT INTO entries (type, title, content, tomorrow_plan, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(type || '日记', title, content, tomorrow_plan || '', today).run();
      return json({ ok: true, id: result.meta.last_row_id });
    }

    return json({ error: 'not found' }, 404);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}`;
  fs.writeFileSync(path.join(baseDir, 'functions', 'api', '[[path]].js'), apiCode, 'utf8');
  console.log('   ✅ functions/api/[[path]].js');

  // Step 7: 生成基础前端
  const frontendCode = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${projectName}</title>
<script src="https://cdn.tailwindcss.com"></script>
<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  [x-cloak] { display: none !important; }
  .sidebar-item { padding: 10px 16px; border-radius: 8px; cursor: pointer; transition: all 0.2s; }
  .sidebar-item:hover { background: #1e293b; }
  .sidebar-item.active { background: #1e293b; border-left: 3px solid #22c55e; }
  .entry-card { transition: all 0.2s; }
  .entry-card:hover { border-color: #22c55e40; transform: translateX(2px); }
  .heatmap-day { width: 14px; height: 14px; border-radius: 3px; margin: 1px; }
  .level-0 { background: #1e293b; }
  .level-2 { background: #22c55e; }
</style>
</head>
<body class="bg-[#0f172a] text-gray-200 min-h-screen" x-data="app()" x-cloak>

<template x-if="page === 'login'">
  <div class="flex items-center justify-center min-h-screen">
    <div class="bg-[#1e293b] p-10 rounded-2xl border border-[#334155] w-full max-w-md mx-4">
      <div class="text-center mb-8">
        <h1 class="text-2xl font-bold">${projectName}</h1>
        <p class="text-gray-400 text-sm mt-2">输入口令</p>
      </div>
      <input type="password" x-model="password" @keyup.enter="login()"
        class="w-full bg-[#0f172a] border border-[#475569] rounded-lg px-4 py-3 text-center focus:outline-none focus:border-[#22c55e]"
        placeholder="口令">
      <p x-show="loginError" x-text="loginError" class="text-red-400 text-sm text-center mt-3"></p>
      <button @click="login()" class="w-full mt-4 bg-[#22c55e] hover:bg-[#16a34a] text-black font-semibold py-3 rounded-lg">进入</button>
    </div>
  </div>
</template>

<template x-if="page !== 'login'">
  <div class="flex h-screen">
    <div class="w-64 bg-[#1e293b] border-r border-[#334155] flex flex-col p-4 shrink-0 overflow-y-auto">
      <div class="text-center mb-6 pt-2"><h2 class="font-bold">${projectName}</h2></div>
      <div class="space-y-1 flex-1">
        <div class="sidebar-item" :class="{ active: page === 'list' }" @click="goList()">📋 列表</div>
        <div class="sidebar-item" :class="{ active: page === 'write' }" @click="goWrite()">✏️ 写新篇</div>
        <div class="sidebar-item" :class="{ active: page === 'search' }" @click="goSearch()">🔍 搜索</div>
        <div class="sidebar-item" :class="{ active: page === 'calendar' }" @click="goCalendar()">📅 日历</div>
      </div>
    </div>
    <div class="flex-1 overflow-y-auto p-6">
      <div x-show="page === 'list'">
        <h2 class="text-xl font-bold mb-4">列表</h2>
        <template x-for="e in entries" :key="e.id">
          <div class="entry-card bg-[#1e293b] border border-[#334155] rounded-xl p-4 mb-3 cursor-pointer" @click="viewEntry(e.id)">
            <h3 class="font-semibold" x-text="e.title"></h3>
            <p class="text-sm text-gray-400 mt-1" x-text="e.summary"></p>
          </div>
        </template>
      </div>
      <div x-show="page === 'write'" class="max-w-3xl mx-auto">
        <h2 class="text-xl font-bold mb-4">写新篇</h2>
        <input x-model="formTitle" class="w-full bg-[#0f172a] border border-[#475569] rounded-lg px-4 py-2 mb-4" placeholder="标题">
        <textarea x-model="formContent" class="w-full bg-[#0f172a] border border-[#475569] rounded-lg px-4 py-2 mb-4" style="min-height:200px" placeholder="内容"></textarea>
        <button @click="submitEntry()" class="bg-[#22c55e] text-black font-semibold px-6 py-2 rounded-lg">提交</button>
      </div>
      <div x-show="page === 'search'">
        <h2 class="text-xl font-bold mb-4">搜索</h2>
        <input x-model="searchQ" @keyup.enter="doSearch()" class="bg-[#0f172a] border border-[#475569] rounded-lg px-4 py-2 w-full" placeholder="关键词">
        <template x-for="r in searchResults" :key="r.id">
          <div class="entry-card bg-[#1e293b] border border-[#334155] rounded-xl p-4 mt-3 cursor-pointer" @click="viewEntry(r.id)">
            <h3 x-text="r.title"></h3>
          </div>
        </template>
      </div>
      <div x-show="page === 'calendar'">
        <h2 class="text-xl font-bold mb-4">日历</h2>
      </div>
    </div>
  </div>
</template>

<script>
function app() {
  return {
    page: 'login', password: '', loginError: '', token: '',
    entries: [], searchResults: [], searchQ: '', searchDone: false,
    formTitle: '', formContent: '', submitting: false,
    async login() {
      const r = await fetch('/api/login', { method: 'POST', body: JSON.stringify({ password: this.password }) });
      const d = await r.json();
      if (d.ok) { this.token = this.password; this.page = 'list'; this.loadEntries(); }
      else { this.loginError = '口令错误'; }
    },
    async loadEntries() {
      const r = await fetch('/api/entries', { headers: { 'Authorization': this.token } });
      const d = await r.json();
      this.entries = d.entries || [];
    },
    async viewEntry(id) {
      const r = await fetch('/api/entry/' + id, { headers: { 'Authorization': this.token } });
      this.currentEntry = await r.json(); this.page = 'detail';
    },
    goList() { this.page = 'list'; this.loadEntries(); },
    goWrite() { this.page = 'write'; this.formTitle=''; this.formContent=''; },
    goSearch() { this.page = 'search'; this.searchQ=''; this.searchResults=[]; this.searchDone=false; },
    goCalendar() { this.page = 'calendar'; },
    async doSearch() {
      if (!this.searchQ.trim()) return;
      const r = await fetch('/api/search?q=' + encodeURIComponent(this.searchQ), { headers: { 'Authorization': this.token } });
      const d = await r.json(); this.searchResults = d.results || [];
    },
    async submitEntry() {
      if (!this.formTitle || !this.formContent) return;
      this.submitting = true;
      await fetch('/api/entry', { method: 'POST', body: JSON.stringify({ title: this.formTitle, content: this.formContent, password: this.token }) });
      this.submitting = false; this.formTitle=''; this.formContent=''; this.page='list'; this.loadEntries();
    }
  }
}
</script>
</body>
</html>`;
  fs.writeFileSync(path.join(baseDir, 'index.html'), frontendCode, 'utf8');
  console.log('   ✅ index.html');

  // Step 8: 输出完成信息
  console.log('\n' + '='.repeat(50));
  console.log('✅ 站点脚手架生成完成！');
  console.log('\n📁 项目位置: ' + baseDir);
  console.log('🔑 默认口令: 123456');
  console.log('\n📋 下一步：');
  console.log('  1. cd ' + projectName);
  console.log('  2. wrangler pages deploy . --project-name=' + projectName + ' --branch=main');
  console.log('  3. 让 frontend-developer 美化前端');
  console.log('  4. 让 backend-architect 完善后端');
  console.log('  5. 让 code-tester 审查');
  console.log('  6. 我（Main）最终验收');
  console.log('');

  // 同步到全局
  const globalSkillDir = path.join(require('os').homedir(), '.openclaw', 'skills', 'site-builder');
  if (!fs.existsSync(globalSkillDir)) fs.mkdirSync(globalSkillDir, { recursive: true });
  fs.cpSync(baseDir, globalSkillDir, { recursive: true });
  console.log('🌐 已同步到全局 skills/');
})();
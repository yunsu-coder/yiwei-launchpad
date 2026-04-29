/**
 * app.js — 导航页核心框架
 * 共享工具 + 导航 + 主题 + 时钟 + 状态 + 壁纸事件
 * 所有 Vue 面板模块在 panels.js
 */
(function () {
  'use strict';

  // ===== 导航 =====
  let currentPanel = 'home';

  window.switchPanel = function (name) {
    if (currentPanel === 'notes' && name !== 'notes') {
      const notesApp = document.getElementById('notes-app')?.__vue_app__?._instance?.proxy;
      if (notesApp && notesApp.dirty && !confirm('笔记有未保存的修改，是否放弃？')) {
        document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
        document.querySelector('[data-panel="notes"]').classList.add('active');
        document.querySelectorAll('.panel').forEach(p => { p.classList.remove('active'); p.classList.remove('flex-active'); });
        document.getElementById('panel-notes').classList.add('active');
        return;
      }
      if (notesApp) notesApp.stopAutoSave();
    }
    currentPanel = name;
    location.hash = name;
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelector(`[data-panel="${name}"]`).classList.add('active');
    document.querySelectorAll('.panel').forEach(p => { p.classList.remove('active'); p.classList.remove('flex-active'); });
    document.getElementById('panel-' + name).classList.add(name === 'ai' ? 'flex-active' : 'active');
    // 按需加载面板数据
    const proxy = document.getElementById(name + '-app')?.__vue_app__?._instance?.proxy;
    if (!proxy) return;
    if (name === 'files') proxy.loadFiles();
    if (name === 'notes') proxy.loadList();
    if (name === 'scrape') proxy.loadSessions();
    if (name === 'read') proxy.loadBooks();
  };

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => window.switchPanel(btn.dataset.panel));
    });
    // 恢复标签
    if (location.hash) {
      const tab = location.hash.slice(1);
      if (['home', 'files', 'notes', 'scrape', 'read', 'translate', 'ai', 'voice'].includes(tab))
        window.switchPanel(tab);
    }
  });

  // ===== 主题 =====
  if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark');
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('themeBtn').addEventListener('click', () => {
      document.body.classList.toggle('dark');
      localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
    });
  });

  // ===== Toast =====
  let toastTimer;
  window.toast = function (msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2000);
  };

  // ===== 时钟 =====
  function tick() {
    const now = new Date();
    const clock = document.getElementById('clock');
    const date = document.getElementById('date');
    if (clock) clock.textContent = now.toLocaleTimeString('zh-CN', { hour12: false });
    if (date) date.textContent = now.toLocaleDateString('zh-CN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }
  document.addEventListener('DOMContentLoaded', () => {
    tick();
    setInterval(tick, 1000);
  });

  // ===== 搜索 =====
  document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('searchForm');
    if (form) {
      form.addEventListener('submit', e => {
        e.preventDefault();
        const q = document.getElementById('q').value.trim();
        if (q) window.open('https://www.bing.com/search?q=' + encodeURIComponent(q), '_blank');
      });
    }
  });

  // ===== 预览弹窗 =====
  window.closePreview = function () {
    document.getElementById('previewModal').classList.remove('show');
    const bar = document.getElementById('previewActions');
    if (bar) bar.innerHTML = '';
  };
  document.addEventListener('keydown', e => {
    const modal = document.getElementById('previewModal');
    if (!modal?.classList.contains('show')) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const filesP = document.getElementById('files-app')?.__vue_app__?._instance?.proxy;
      if (filesP?._previewImgList) { filesP._navPreview(e.key === 'ArrowRight' ? 1 : -1); return; }
    }
    if (e.key === 'Escape') window.closePreview();
  });

  // ===== 跨模块调度 =====
  // 用法: AppActions.read(fileName) / .translate(text) / .askAI(prompt) / .speak(text)
  window.AppActions = {
    _proxy(name) {
      return document.getElementById(name + '-app')?.__vue_app__?._instance?.proxy;
    },
    async read(fileName) {
      window.switchPanel('read');
      await new Promise(r => setTimeout(r, 100));
      const p = this._proxy('read');
      if (p) p.openBook(fileName);
    },
    async translate(text) {
      window.switchPanel('translate');
      await new Promise(r => setTimeout(r, 100));
      const p = this._proxy('translate');
      if (p) { p.inputText = text; p.autoTranslate(); }
    },
    async askAI(prompt) {
      window.switchPanel('ai');
      await new Promise(r => setTimeout(r, 100));
      const p = this._proxy('ai');
      if (p) { p.inputText = prompt; }
    },
    async speak(text) {
      window.switchPanel('voice');
      await new Promise(r => setTimeout(r, 100));
      const p = this._proxy('voice');
      if (p) { p.ttsText = text; p.speak(); }
    },
    async summarize(sid, textName) {
      try {
        const r = await fetch('/api/scrape/text/' + sid + '/' + encodeURIComponent(textName));
        const text = await r.text();
        window.AppActions.askAI('请帮我总结以下内容，提取关键要点：\n\n' + text.slice(0, 6000));
      } catch { toast('❌ 无法读取文本'); }
    },
    async analyzeFile(fileName) {
      try {
        const r = await fetch('/api/preview/' + encodeURIComponent(fileName));
        if (!r.ok) { toast('❌ 无法读取文件'); return; }
        const text = await r.text();
        window.AppActions.askAI('请分析以下文件内容（文件名：' + fileName + '）：\n\n' + text.slice(0, 8000));
      } catch { toast('❌ 无法读取文件'); }
    },
    async translateFile(fileName) {
      try {
        const r = await fetch('/api/preview/' + encodeURIComponent(fileName));
        if (!r.ok) { toast('❌ 无法读取文件'); return; }
        const text = await r.text();
        window.AppActions.translate(text.slice(0, 5000));
      } catch { toast('❌ 无法读取文件'); }
    },
  };

  // ===== 壁纸自动轮换 =====
  let wallpaperTimer = null;
  window.startWallpaperRotation = function (intervalMin) {
    window.stopWallpaperRotation();
    const rotate = async () => {
      try {
        const files = await (await fetch('/api/files')).json();
        const imgs = files.filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f.name));
        if (imgs.length === 0) return;
        const pick = imgs[Math.floor(Math.random() * imgs.length)];
        const url = '/api/wallpaper/' + encodeURIComponent(pick.name);
        localStorage.setItem('wallpaper', url);
        document.body.style.backgroundImage = `url(${url})`;
        document.body.style.backgroundSize = 'cover';
        document.body.style.backgroundPosition = 'center';
        document.body.style.backgroundAttachment = 'fixed';
        const homeP = document.getElementById('home-app')?.__vue_app__?._instance?.proxy;
        if (homeP) homeP.wallpaper = url;
      } catch {}
    };
    rotate();
    wallpaperTimer = setInterval(rotate, (intervalMin || 30) * 60000);
    toast('🖼️ 壁纸轮换已开启 (' + (intervalMin || 30) + '分钟)');
  };
  window.stopWallpaperRotation = function () {
    if (wallpaperTimer) { clearInterval(wallpaperTimer); wallpaperTimer = null; }
  };

  // ===== 状态栏 =====
  document.addEventListener('DOMContentLoaded', async () => {
    const el = document.getElementById('status');
    if (!el) return;
    try {
      const s = await (await fetch('/api/status')).json();
      el.innerHTML = [
        `<span><span class="dot ${s.mem_pct < 80 ? 'green' : (s.mem_pct < 90 ? 'yellow' : 'red')}"></span>内存 ${s.mem_used}/${s.mem_total}</span>`,
        `<span><span class="dot green"></span>CPU ${s.cpu}%</span>`,
        `<span><span class="dot green"></span>磁盘 ${s.disk_free}</span>`,
        `<span><span class="dot green"></span>运行 ${s.uptime}</span>`,
      ].join(' · ');
    } catch {
      el.innerHTML = '<span>⚙️ 状态暂不可用</span>';
    }
  });

  // ===== 壁纸事件桥（跨面板） =====
  window.addEventListener('set-wallpaper', e => {
    const homeApp = document.getElementById('home-app')?.__vue_app__?._instance?.proxy;
    if (homeApp?.setWallpaper) {
      homeApp.setWallpaper(e.detail.url);
      window.switchPanel('home');
    }
  });

})();

// js/common.js - 共享工具 + 首页 Vue
let currentPanel = 'home';

// ===== 导航 =====
function switchPanel(name) {
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
  if (name === 'files') document.getElementById('files-app')?.__vue_app__?._instance?.proxy?.loadFiles();
  if (name === 'notes') document.getElementById('notes-app')?.__vue_app__?._instance?.proxy?.loadList();
  if (name === 'scrape') document.getElementById('scrape-app')?.__vue_app__?._instance?.proxy?.loadSessions();
  if (name === 'read') document.getElementById('read-app')?.__vue_app__?._instance?.proxy?.loadBooks();
}

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => switchPanel(btn.dataset.panel));
});

// ===== 主题 =====
if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark');
document.getElementById('themeBtn').addEventListener('click', () => {
  document.body.classList.toggle('dark');
  localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
});

// ===== Toast =====
let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2000);
}

// ===== 时钟 =====
function tick() {
  const now = new Date();
  document.getElementById('clock').textContent = now.toLocaleTimeString('zh-CN', { hour12: false });
  document.getElementById('date').textContent = now.toLocaleDateString('zh-CN', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
}
tick(); setInterval(tick, 1000);

// ===== 搜索 =====
document.getElementById('searchForm').addEventListener('submit', e => {
  e.preventDefault();
  const q = document.getElementById('q').value.trim();
  if (q) window.open('https://www.bing.com/search?q=' + encodeURIComponent(q), '_blank');
});

// ===== 书签默认数据 =====
const DEFAULT_LINKS = {
  ai: [
    { name:'DeepSeek', url:'https://chat.deepseek.com', icon:'🤖' },
    { name:'豆包', url:'https://www.doubao.com', icon:'🫘' },
    { name:'ChatGPT', url:'https://chat.openai.com', icon:'🧠' },
    { name:'Kimi', url:'https://kimi.moonshot.cn', icon:'🌙' },
    { name:'通义千问', url:'https://tongyi.aliyun.com', icon:'☁️' },
    { name:'文心一言', url:'https://yiyan.baidu.com', icon:'📘' },
  ],
  common: [
    { name:'哔哩哔哩', url:'https://www.bilibili.com', icon:'📺' },
    { name:'知乎', url:'https://www.zhihu.com', icon:'🔷' },
    { name:'YouTube', url:'https://www.youtube.com', icon:'▶️' },
    { name:'GitHub', url:'https://github.com', icon:'🐙' },
    { name:'微信', url:'https://wx.qq.com', icon:'💬' },
    { name:'Gmail', url:'https://mail.google.com', icon:'📧' },
  ],
  dev: [
    { name:'CSDN', url:'https://www.csdn.net', icon:'📄' },
    { name:'MDN', url:'https://developer.mozilla.org', icon:'📘' },
    { name:'npm', url:'https://www.npmjs.com', icon:'📦' },
    { name:'Docker Hub', url:'https://hub.docker.com', icon:'🐳' },
    { name:'Vercel', url:'https://vercel.com', icon:'▲' },
    { name:'Stack Overflow', url:'https://stackoverflow.com', icon:'📚' },
  ],
  tools: [
    { name:'格式转换', url:'https://convertio.co/zh/', icon:'🔄' },
    { name:'在线 JSON', url:'https://jsonformatter.org', icon:'🔧' },
    { name:'图片压缩', url:'https://tinypng.com', icon:'🗜️' },
    { name:'Cron 表达式', url:'https://crontab.guru', icon:'⏰' },
    { name:'在线 PS', url:'https://www.photopea.com', icon:'🎨' },
    { name:'Regex101', url:'https://regex101.com', icon:'🔍' },
  ],
};

// ===== 首页 Vue =====
Vue.createApp({
  data() {
    return {
      editMode: false,
      categories: JSON.parse(localStorage.getItem('bookmarks') || JSON.stringify(DEFAULT_LINKS)),
      addForm: { cat: '', name: '', url: '', icon: '🔗' },
      iconPicker: [
        '🤖','🫘','🧠','🌙','☁️','📘','📺','🔷','▶️','🐙','💬','📧','📄','📦','🐳','▲','📚',
        '🔄','🔧','🗜️','⏰','🎨','🔍','🔗','⭐','💡','🔥','🎯','🎮','📷','🎬','🎵','📰','🏠','🚀','💻','📱','🌍',
      ],
      wallpaper: localStorage.getItem('wallpaper') || '',
      accentColor: localStorage.getItem('accentColor') || '#4f46e5',
    };
  },
  methods: {
    save() { localStorage.setItem('bookmarks', JSON.stringify(this.categories)); },
    startAdd(cat) { this.addForm = { cat, name:'', url:'', icon:'🔗' }; },
    addLink() {
      const f = this.addForm;
      if (!f.name || !f.url) { toast('⚠️ 名称和网址不能为空'); return; }
      this.categories[f.cat].push({ name: f.name, url: f.url, icon: f.icon || '🔗' });
      this.addForm = { cat:'', name:'', url:'', icon:'🔗' };
      this.save();
    },
    delLink(cat, idx) { this.categories[cat].splice(idx, 1); this.save(); },
    resetDefault() {
      if (!confirm('恢复默认书签？自定义的将丢失')) return;
      this.categories = JSON.parse(JSON.stringify(DEFAULT_LINKS));
      this.save();
    },
    setWallpaper(url) {
      this.wallpaper = url;
      if (url) {
        localStorage.setItem('wallpaper', url);
        document.body.style.backgroundImage = `url(${url})`;
        document.body.style.backgroundSize = 'cover';
        document.body.style.backgroundPosition = 'center';
        document.body.style.backgroundAttachment = 'fixed';
      } else {
        localStorage.removeItem('wallpaper');
        document.body.style.backgroundImage = '';
      }
    },
    setAccent(color) {
      this.accentColor = color;
      localStorage.setItem('accentColor', color);
      document.documentElement.style.setProperty('--accent', color);
    },
  },
  mounted() {
    if (this.wallpaper) {
      document.body.style.backgroundImage = `url(${this.wallpaper})`;
      document.body.style.backgroundSize = 'cover';
      document.body.style.backgroundPosition = 'center';
      document.body.style.backgroundAttachment = 'fixed';
    }
    if (this.accentColor) {
      document.documentElement.style.setProperty('--accent', this.accentColor);
    }
    // 监听其他模块发来的设壁纸事件
    const self = this;
    window.addEventListener('set-wallpaper', e => {
      self.setWallpaper(e.detail.url);
      // 自动切到首页
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      document.querySelector('.nav-item')?.classList.add('active');
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      document.getElementById('panel-home')?.classList.add('active');
    });
  },
}).mount('#home-app');

// ===== 状态 =====
(async () => {
  const el = document.getElementById('status');
  try {
    const s = await (await fetch('/api/status')).json();
    el.innerHTML = [
      `<span><span class="dot ${s.mem_pct<80?'green':(s.mem_pct<90?'yellow':'red')}"></span>内存 ${s.mem_used}/${s.mem_total}</span>`,
      `<span><span class="dot green"></span>CPU ${s.cpu}%</span>`,
      `<span><span class="dot green"></span>磁盘 ${s.disk_free}</span>`,
      `<span><span class="dot green"></span>运行 ${s.uptime}</span>`,
    ].join(' · ');
  } catch { el.innerHTML = '<span>⚙️ 状态暂不可用</span>'; }
})();

// ===== 预览弹窗 =====
function closePreview() { document.getElementById('previewModal').classList.remove('show'); }
document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.getElementById('previewModal').classList.contains('show')) closePreview(); });

// 页面刷新恢复标签
if (location.hash) {
  const tab = location.hash.slice(1);
  if (['home','files','notes','scrape','read','translate','ai','voice'].includes(tab)) switchPanel(tab);
}

// ==== 跨模块调度 (from app.js) ====
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


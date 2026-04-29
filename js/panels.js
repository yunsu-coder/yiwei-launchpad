/**
 * panels.js — 所有面板 Vue 应用（错误隔离）
 * 依赖：app.js
 */
(function () {
  'use strict';

  function mountPanel(name, options, selector) {
    try {
      Vue.createApp(options).mount(selector);
    } catch (e) {
      console.error('[Panel] ' + name + ' failed:', e);
      const el = document.querySelector(selector);
      if (el) el.innerHTML = '<div style="padding:1rem;color:var(--danger);">\u26a0\ufe0f ' + name + ' \u52a0\u8f7d\u5931\u8d25</div>';
    }
  }

  // ═══ 首页 ═══
  const DEFAULT_LINKS = {
    ai: [{name:'DeepSeek',url:'https://chat.deepseek.com',icon:'🤖'},{name:'豆包',url:'https://www.doubao.com',icon:'🫘'},{name:'ChatGPT',url:'https://chat.openai.com',icon:'🧠'},{name:'Kimi',url:'https://kimi.moonshot.cn',icon:'🌙'},{name:'通义千问',url:'https://tongyi.aliyun.com',icon:'☁️'},{name:'文心一言',url:'https://yiyan.baidu.com',icon:'📘'}],
    common: [{name:'哔哩哔哩',url:'https://www.bilibili.com',icon:'📺'},{name:'知乎',url:'https://www.zhihu.com',icon:'🔷'},{name:'YouTube',url:'https://www.youtube.com',icon:'▶️'},{name:'GitHub',url:'https://github.com',icon:'🐙'},{name:'微信',url:'https://wx.qq.com',icon:'💬'},{name:'Gmail',url:'https://mail.google.com',icon:'📧'}],
    dev: [{name:'CSDN',url:'https://www.csdn.net',icon:'📄'},{name:'MDN',url:'https://developer.mozilla.org',icon:'📘'},{name:'npm',url:'https://www.npmjs.com',icon:'📦'},{name:'Docker Hub',url:'https://hub.docker.com',icon:'🐳'},{name:'Vercel',url:'https://vercel.com',icon:'▲'},{name:'Stack Overflow',url:'https://stackoverflow.com',icon:'📚'}],
    tools: [{name:'格式转换',url:'https://convertio.co/zh/',icon:'🔄'},{name:'在线JSON',url:'https://jsonformatter.org',icon:'🔧'},{name:'图片压缩',url:'https://tinypng.com',icon:'🗜️'},{name:'Cron',url:'https://crontab.guru',icon:'⏰'},{name:'在线PS',url:'https://www.photopea.com',icon:'🎨'},{name:'Regex101',url:'https://regex101.com',icon:'🔍'}],
  };

  mountPanel('home', {
    data() { return { editMode:false, categories:JSON.parse(localStorage.getItem('bookmarks')||JSON.stringify(DEFAULT_LINKS)), addForm:{cat:'',name:'',url:'',icon:'🔗'}, iconPicker:['🤖','🫘','🧠','🌙','☁️','📘','📺','🔷','▶️','🐙','💬','📧','📄','📦','🐳','▲','📚','🔄','🔧','🗜️','⏰','🎨','🔍','🔗','⭐','💡','🔥','🎯','🎮','📷','🎬','🎵','📰','🏠','🚀','💻','📱','🌍'], wallpaper:localStorage.getItem('wallpaper')||'', accentColor:localStorage.getItem('accentColor')||'#4f46e5' }; },
    methods: {
      save(){localStorage.setItem('bookmarks',JSON.stringify(this.categories));},
      startAdd(cat){this.addForm={cat,name:'',url:'',icon:'🔗'};},
      addLink(){var f=this.addForm;if(!f.name||!f.url){toast('\u26a0\ufe0f \u540d\u79f0\u548c\u7f51\u5740\u4e0d\u80fd\u4e3a\u7a7a');return;}this.categories[f.cat].push({name:f.name,url:f.url,icon:f.icon||'🔗'});this.addForm={cat:'',name:'',url:'',icon:'🔗'};this.save();},
      delLink(cat,idx){this.categories[cat].splice(idx,1);this.save();},
      resetDefault(){if(!confirm('恢复默认书签？'))return;this.categories=JSON.parse(JSON.stringify(DEFAULT_LINKS));this.save();},
      setWallpaper(url){this.wallpaper=url;if(url){localStorage.setItem('wallpaper',url);document.body.style.backgroundImage='url('+url+')';document.body.style.backgroundSize='cover';document.body.style.backgroundPosition='center';document.body.style.backgroundAttachment='fixed';}else{localStorage.removeItem('wallpaper');document.body.style.backgroundImage='';}},
      setAccent(color){this.accentColor=color;localStorage.setItem('accentColor',color);document.documentElement.style.setProperty('--accent',color);},
    },
    mounted(){if(this.wallpaper){document.body.style.backgroundImage='url('+this.wallpaper+')';document.body.style.backgroundSize='cover';document.body.style.backgroundPosition='center';document.body.style.backgroundAttachment='fixed';}if(this.accentColor)document.documentElement.style.setProperty('--accent',this.accentColor);},
  }, '#home-app');


  // ═══ files ═══
  mountPanel('files', {
  data() {
    return {
      files: [],
      search: '',
      sort: 'date-desc',
      selected: {},
      dropActive: false,
      uploadProgress: '',
      storage: { used_h: '--', pct: 0 },
      renaming: null,
    };
  },
  computed: {
    filtered() {
      let arr = [...this.files];
      if (this.search) arr = arr.filter(f => f.name.toLowerCase().includes(this.search.toLowerCase()));
      const s = {
        'date-desc': (a,b) => new Date(b.mtime) - new Date(a.mtime),
        'date-asc': (a,b) => new Date(a.mtime) - new Date(b.mtime),
        'name-asc': (a,b) => a.name.localeCompare(b.name),
        'name-desc': (a,b) => b.name.localeCompare(a.name),
        'size-desc': (a,b) => b.size - a.size,
        'size-asc': (a,b) => a.size - b.size,
      };
      arr.sort(s[this.sort] || s['date-desc']);
      return arr;
    },
    selectedList() { return Object.keys(this.selected).filter(k => this.selected[k]); },
    hasSelection() { return this.selectedList.length > 0; },
    allSelected() { return this.files.length > 0 && this.selectedList.length === this.files.length; },
  },
  methods: {
    fmtSize(b) { return b<1024?b+'B':b<1048576?(b/1024).toFixed(1)+'K':(b/1048576).toFixed(1)+'M'; },
    esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); },
    async loadFiles() {
      try { this.files = await (await fetch('/api/files')).json(); } catch(e) { console.error(e); }
      this.loadStatus();
    },
    async loadStatus() {
      try {
        const s = await (await fetch('/api/status')).json();
        this.storage = { used_h: s.storage_used_h, pct: s.storage_pct };
      } catch(e) {}
    },
    download(name) { window.open('/api/dl/' + encodeURIComponent(name), '_blank'); },
    toggleSelectAll() {
      const v = !this.allSelected;
      this.files.forEach(f => this.selected[f.name] = v);
    },
    async upload(e) {
      const list = e.dataTransfer ? e.dataTransfer.files : e.target.files;
      if (!list.length) return;
      let ok = 0;
      for (let i = 0; i < list.length; i++) {
        this.uploadProgress = `上传中... ${i+1}/${list.length}`;
        const form = new FormData(); form.append('file', list[i]);
        const r = await fetch('/api/files', { method: 'POST', body: form });
        if (r.ok) ok++; else { try { const d = await r.json(); toast('❌ ' + d.error); } catch {} }
      }
      this.uploadProgress = '';
      if (ok) toast(`✅ ${ok} 个上传成功`);
      this.loadFiles();
    },
    async preview(name) {
      const ext = name.split('.').pop().toLowerCase();
      const dl = `/api/view/${encodeURIComponent(name)}`;
      const prev = document.getElementById('previewModal');
      document.getElementById('previewTitle').textContent = name;
      const body = document.getElementById('previewBody');
      body.innerHTML = '<div class="file-info"><div class="fi-icon">⏳</div>加载中...</div>';
      prev.classList.add('show');
      if (['jpg','jpeg','png','gif','webp','svg'].includes(ext)) {
        body.innerHTML = `<img src="${dl}" alt="${name}" onerror="this.parentElement.innerHTML='<div class=file-info>❌ 加载失败</div>'">`;
      } else if (ext === 'pdf') {
        body.innerHTML = `<iframe src="${dl}" style="width:100%;height:75vh;border:none;border-radius:6px;"></iframe>`;
      } else if (['mp4','webm','mov'].includes(ext)) {
        body.innerHTML = `<video controls style="max-width:100%;max-height:70vh;display:block;margin:0 auto;"><source src="${dl}"></video>`;
      } else if (['mp3','wav','ogg'].includes(ext)) {
        body.innerHTML = `<div class="file-info"><div class="fi-icon">🎵</div><div style="font-weight:600;">${name}</div><audio controls style="width:100%;max-width:400px;"><source src="${dl}"></audio></div>`;
      } else {
        try {
          const r = await fetch('/api/preview/' + encodeURIComponent(name));
          if (!r.ok) { body.innerHTML = '<div class="file-info">📄 不支持预览</div>'; return; }
          const ct = r.headers.get('Content-Type')||'';
          if (ct.includes('json')) body.innerHTML = '<pre>' + this.esc(JSON.stringify(await r.json(),null,2)) + '</pre>';
          else if (ct.includes('text')) body.innerHTML = '<pre>' + this.esc((await r.text()).slice(0,200000)) + '</pre>';
          else body.innerHTML = '<div class="file-info">📄 不支持预览</div>';
        } catch(e) { body.innerHTML = '<div class="file-info">❌ 加载失败</div>'; }
      }
    },
    copyLink(name) {
      const url = location.origin + '/api/dl/' + encodeURIComponent(name);
      navigator.clipboard.writeText(url).then(() => toast('📋 已复制'));
    },
    async delFile(name) {
      if (!confirm(`删除「${name}」？`)) return;
      await fetch('/api/files/' + encodeURIComponent(name), { method: 'DELETE' });
      toast('🗑️ 已删除');
      this.loadFiles();
    },
    async batchDelete() {
      const list = this.selectedList;
      if (!list.length) return;
      if (!confirm(`删除选中的 ${list.length} 个文件？`)) return;
      let ok = 0;
      for (const name of list) {
        const r = await fetch('/api/files/' + encodeURIComponent(name), { method: 'DELETE' });
        if (r.ok) ok++;
      }
      toast(`🗑️ ${ok} 个已删除`);
      this.selected = {};
      this.loadFiles();
    },
    setBg(name) {
      const url = `/api/wallpaper/${encodeURIComponent(name)}`;
      window.dispatchEvent(new CustomEvent('set-wallpaper', { detail: { url } }));
      toast('🖼️ 已设为壁纸（自动压缩优化）');
    },
    startRename(name) { this.renaming = { old: name, new: name }; },
    cancelRename() { this.renaming = null; },
    async doRename() {
      if (!this.renaming || this.renaming.old === this.renaming.new) { this.renaming = null; return; }
      try {
        const r = await fetch('/api/files/rename/' + encodeURIComponent(this.renaming.old), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newName: this.renaming.new }),
        });
        if (r.ok) { toast('✅ 已重命名'); this.loadFiles(); }
        else { const d = await r.json(); toast('❌ ' + d.error); }
      } catch(e) { toast('❌ ' + e.message); }
      this.renaming = null;
    },
  },
  mounted() {
    if (document.getElementById('panel-files')?.classList.contains('active')) this.loadFiles();
  },
}, '#files-app');

  // ═══ notes ═══
  mountPanel('notes', {
  data() {
    return {
      noteSearch: '',
      notes: [],
      currentId: null,
      title: '',
      content: '',
      preview: '',
      dirty: false,
      autoSaveTimer: null,
      categories: ['全部','笔记','日记','技术','其他'],
      activeCat: '全部',
    };
  },
  computed: {
    filteredNotes() {
      let arr = this.notes;
      if (this.activeCat !== '全部') arr = arr.filter(n => (n.category || '') === this.activeCat);
      if (!this.noteSearch) return arr;
      const q = this.noteSearch.toLowerCase();
      return arr.filter(n => (n.title || '').toLowerCase().includes(q) || (n.preview || '').toLowerCase().includes(q));
    },
  },
  methods: {
    md2html(md) {
      let html = (md||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      html = html.replace(/```(\w*)\n?([\s\S]*?)```/g,'<pre><code>$2</code></pre>');
      html = html.replace(/`([^`]+)`/g,'<code>$1</code>');
      html = html.replace(/^#### (.+)$/gm,'<h4>$1</h4>').replace(/^### (.+)$/gm,'<h3>$1</h3>');
      html = html.replace(/^## (.+)$/gm,'<h2>$1</h2>').replace(/^# (.+)$/gm,'<h1>$1</h1>');
      html = html.replace(/\*\*\*(.+?)\*\*\*/g,'<strong><em>$1</em></strong>');
      html = html.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>');
      html = html.replace(/~~(.+?)~~/g,'<del>$1</del>');
      html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g,'<img src="$2" alt="$1" style="max-width:100%;">');
      html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g,'<a href="$2" target="_blank">$1</a>');
      html = html.replace(/^---$/gm,'<hr>');
      html = html.replace(/^&gt;\s?(.+)$/gm,'<blockquote>$1</blockquote>');
      html = html.replace(/^- \[x\] (.+)$/gm,'<li><input type="checkbox" checked disabled> $1</li>');
      html = html.replace(/^- \[ \] (.+)$/gm,'<li><input type="checkbox" disabled> $1</li>');
      html = html.replace(/^[*-] (.+)$/gm,'<li>$1</li>');
      html = html.replace(/\n\n/g,'</p><p>');
      html = html.replace(/\n/g,'<br>');
      return '<p>' + html + '</p>';
    },
    esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); },
    updatePreview() { this.preview = this.md2html(this.content); this.dirty = true; },
    async loadList() {
      try { this.notes = await (await fetch('/api/notes')).json(); } catch(e) {}
    },
    async newNote() {
      if (this.dirty && !confirm('未保存，放弃？')) return;
      this.stopAutoSave();
      this.currentId = null; this.title = ''; this.content = ''; this.preview = ''; this.dirty = false;
    },
    async openNote(id) {
      if (this.dirty && id !== this.currentId && !confirm('未保存，放弃？')) return;
      try {
        const note = await (await fetch('/api/notes/' + id)).json();
        this.currentId = id; this.title = note.title; this.content = note.content;
        this.updatePreview(); this.dirty = false;
        this.startAutoSave();
      } catch(e) {}
    },
    async save() {
      if (!this.title && !this.content) { toast('⚠️ 标题和内容不能都为空'); return; }
      try {
        const body = { title: this.title || '无标题', content: this.content };
        if (this.currentId) body.id = this.currentId;
        const r = await fetch('/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await r.json();
        this.currentId = data.id; this.dirty = false;
        toast('✅ 已保存'); this.loadList();
      } catch(e) { toast('❌ 保存失败'); }
    },
    async del() {
      if (!this.currentId) { toast('⚠️ 还没有保存的笔记'); return; }
      if (!confirm('确定删除？')) return;
      await fetch('/api/notes/' + this.currentId, { method: 'DELETE' });
      this.currentId = null; this.title = ''; this.content = ''; this.preview = ''; this.dirty = false;
      this.stopAutoSave(); toast('🗑️ 已删除'); this.loadList();
    },
    startAutoSave() {
      this.stopAutoSave();
      this.autoSaveTimer = setInterval(() => { if (this.dirty) this.save(); }, 30000);
    },
    stopAutoSave() { if (this.autoSaveTimer) { clearInterval(this.autoSaveTimer); this.autoSaveTimer = null; } },
    insertMd(before, after) {
      const ta = document.querySelector('#panel-notes textarea');
      if (!ta) return;
      const s = ta.selectionStart, e = ta.selectionEnd, txt = this.content.substring(s, e);
      this.content = this.content.substring(0, s) + before + txt + after + this.content.substring(e);
      this.$nextTick(() => { ta.focus(); ta.setSelectionRange(s + before.length, s + before.length + txt.length); });
      this.updatePreview();
    },
    exportPdf() {
      const win = window.open('', '_blank');
      win.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + this.title + '</title><style>body{font-family:sans-serif;max-width:800px;margin:2rem auto;padding:0 1rem;line-height:1.8;color:#333;}code{background:#f0f0f0;padding:2px 6px;border-radius:4px;}pre{background:#f5f5f5;padding:1rem;border-radius:8px;overflow-x:auto;}</style></head><body><h1>' + this.title + '</h1>' + this.preview + '</body></html>');
      win.document.close(); setTimeout(() => win.print(), 500);
    },
    async exportToFiles() {
      if (!this.content) { toast('⚠️ 无内容'); return; }
      const blob = new Blob([this.content], { type: 'text/markdown' });
      const form = new FormData(); form.append('file', blob, (this.title || '笔记') + '.md');
      try {
        const r = await fetch('/api/files', { method: 'POST', body: form });
        if (r.ok) toast('✅ 已导出到文件中转站'); else toast('❌ 导出失败');
      } catch(e) { toast('❌ ' + e.message); }
    },
  },
  mounted() {
    if (document.getElementById('panel-notes')?.classList.contains('active')) this.loadList();
  },
  beforeUnmount() { this.stopAutoSave(); },
}, '#notes-app');

  // ═══ scraper ═══
  mountPanel('scrape', {
  data() {
    return {
      urls: '',
      type: 'images',
      minWidth: 0,
      minHeight: 0,
      followDetail: true,
      loading: false,
      progress: '',
      sessions: [],
    };
  },
  methods: {
    esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); },
    expandUrls(raw) {
      const lines = raw.split('\n').map(s => s.trim()).filter(Boolean);
      if (lines.length === 2) {
        const numsA = [...lines[0].matchAll(/\d+/g)].map(m => ({v:m[0],s:m.index,e:m.index+m[0].length}));
        const numsB = [...lines[1].matchAll(/\d+/g)].map(m => ({v:m[0],s:m.index,e:m.index+m[0].length}));
        if (numsA.length === numsB.length && numsA.length >= 1) {
          let diffIdx = -1;
          for (let i = 0; i < numsA.length; i++) {
            if (numsA[i].v !== numsB[i].v) {
              if (diffIdx === -1 && numsA[i].s === numsB[i].s && numsA[i].e === numsB[i].e) diffIdx = i;
              else { diffIdx = -2; break; }
            }
          }
          if (diffIdx >= 0) {
            const n1 = parseInt(numsA[diffIdx].v), n2 = parseInt(numsB[diffIdx].v);
            const start = Math.min(n1,n2), end = Math.max(n1,n2);
            if (end-start > 0 && end-start <= 10000) {
              const pre = lines[0].slice(0, numsA[diffIdx].s);
              const post = lines[0].slice(numsA[diffIdx].e);
              const pad = numsA[diffIdx].v.length;
              const urls = [];
              for (let i = start; i <= end; i++) urls.push(pre + String(i).padStart(pad,'0') + post);
              return urls;
            }
          }
        }
      }
      const urls = [];
      for (const line of lines) {
        const m = line.match(/^(.+)\{(\d+)-(\d+)\}(.*)$/);
        if (m) {
          const [_, pre, start, end, post] = m;
          const s = parseInt(start), e = parseInt(end);
          for (let i = s; i <= e; i++) urls.push(pre + String(i).padStart(start.length,'0') + post);
        } else urls.push(line);
      }
      return urls;
    },
    async start() {
      const urlList = this.expandUrls(this.urls);
      if (!urlList.length) { toast('⚠️ 请输入网址'); return; }
      this.loading = true;
      this.progress = `🔍 采集 ${urlList.length} 个页面...`;
      try {
        const r = await fetch('/api/scrape', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urls: urlList, type: this.type, minWidth: this.minWidth, minHeight: this.minHeight, followDetail: this.followDetail }),
        });
        const data = await r.json();
        if (r.ok) {
          const extra = [];
          if (data.skippedLowRes) extra.push(`过滤${data.skippedLowRes}张低分辨率`);
          if (data.detailFollowed) extra.push(`从详情页获取${data.detailFollowed}张大图`);
          toast(`✅ ${data.imageCount||0}张图片, ${data.textCount||0}个文本${extra.length ? ' ('+extra.join(', ')+')' : ''}`);
          this.loadSessions();
        } else toast('❌ ' + (data.error||'失败'));
      } catch(e) { toast('❌ ' + e.message); }
      this.loading = false;
      this.progress = '';
    },
    async loadSessions() {
      try { this.sessions = await (await fetch('/api/scrape/list')).json(); } catch(e) { console.error(e); }
    },
    async transfer(sid) {
      const r = await fetch('/api/scrape/transfer/' + sid, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      if (r.ok) toast('✅ 已转存到文件中转站');
      else toast('❌ 转存失败');
    },
    async delSession(sid) {
      if (!confirm('确定删除？')) return;
      await fetch('/api/scrape/session/' + sid, { method: 'DELETE' });
      toast('🗑️ 已删除');
      this.loadSessions();
    },
  },
  mounted() { if (document.getElementById('panel-scrape').classList.contains('active')) this.loadSessions(); },
}, '#scrape-app');

  // ═══ reader ═══
  mountPanel('read', {
  data() {
    return {
      books: [],
      currentBook: null,
      ext: '',
      theme: localStorage.getItem('reader-theme') || 'light',
      fontSize: localStorage.getItem('reader-font') || '18',
      tocVisible: false,
      autoScrollSpeed: 3,
      autoScrolling: false,
      autoScrollTimer: null,
      position: '',
    };
  },
  methods: {
    fmtSize(b) { return b<1024?b+'B':b<1048576?(b/1024).toFixed(1)+'K':(b/1048576).toFixed(1)+'M'; },
    esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); },
    async loadBooks() {
      try {
        const READABLE = ['epub','pdf','txt','md'];
        const files = await (await fetch('/api/files')).json();
        this.books = files.filter(f => READABLE.includes(f.name.split('.').pop().toLowerCase()));
      } catch(e) { console.error(e); }
    },
    async openBook(name) {
      this.currentBook = name;
      this.ext = name.split('.').pop().toLowerCase();
      const progress = JSON.parse(localStorage.getItem('read-' + name) || '{}');
      
      this.$nextTick(async () => {
        const content = document.getElementById('readerContent');
        if (!content) return;
        content.innerHTML = '<div style="text-align:center;padding:3rem;">⏳ 加载中...</div>';
        
        if (this.ext === 'pdf') {
          content.innerHTML = `<iframe src="/api/view/${encodeURIComponent(name)}" style="width:100%;height:100%;border:none;"></iframe>`;
        } else if (this.ext === 'epub' && typeof ePub !== 'undefined') {
          try {
            const book = ePub(location.origin + '/api/view/' + encodeURIComponent(name));
            const rendition = book.renderTo(content, { width:'100%', height:'100%', flow:'paginated', spread:'none' });
            rendition.on('relocated', (loc) => {
              if (loc.location?.start?.displayed) {
                this.position = `第 ${loc.location.start.displayed.page+1} 页 / 共 ${(loc.location.start.displayed.total||'?')} 页`;
                const pct = book.locations?.percentageFromCfi(loc.location.start.cfi);
                if (pct != null) localStorage.setItem('read-'+name, JSON.stringify({location:loc.location.start.cfi, pct:Math.round(pct*100)}));
              }
            });
            book.loaded.navigation.then(nav => {
              this.tocItems = nav.toc;
            });
            book.ready.then(() => book.locations.generate(1000).then(() => {
              rendition.display(progress.location || undefined);
            }));
            this._rendition = rendition;
          } catch(e) { content.innerHTML = '<div style="text-align:center;padding:3rem;">❌ EPUB 加载失败</div>'; }
        } else {
          try {
            const r = await fetch('/api/preview/' + encodeURIComponent(name));
            const text = await r.text();
            const html = this.ext === 'md' ? this.md2html(text) : '<p>' + this.esc(text).replace(/\n/g, '<br>') + '</p>';
            content.innerHTML = '<div class="reader-content-inner">' + html + '</div>';
            if (progress.scroll) content.scrollTop = progress.scroll;
            content.addEventListener('scroll', () => {
              const pct = Math.round(content.scrollTop/(content.scrollHeight-content.clientHeight)*100);
              localStorage.setItem('read-'+name, JSON.stringify({scroll:content.scrollTop, pct}));
            });
          } catch(e) { content.innerHTML = '<div style="text-align:center;padding:3rem;">❌ 加载失败</div>'; }
        }
        this.updateSettings();
      });
    },
    md2html(md) {
      let html = md.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      html = html.replace(/```(\w*)\n([\s\S]*?)```/g,'<pre><code>$2</code></pre>');
      html = html.replace(/`([^`]+)`/g,'<code>$1</code>');
      html = html.replace(/^### (.+)$/gm,'<h3>$1</h3>');
      html = html.replace(/^## (.+)$/gm,'<h2>$1</h2>');
      html = html.replace(/^# (.+)$/gm,'<h1>$1</h1>');
      html = html.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
      html = html.replace(/\*(.+?)\*/g,'<em>$1</em>');
      html = html.replace(/\n\n/g,'</p><p>');
      html = html.replace(/\n/g,'<br>');
      return '<p>' + html + '</p>';
    },
    close() {
      this.currentBook = null;
      this._rendition = null;
      this.autoScrolling = false;
      if (this.autoScrollTimer) clearInterval(this.autoScrollTimer);
      this.loadBooks();
    },
    updateSettings() {
      const content = document.getElementById('readerContent');
      if (content) {
        content.className = 'reader-' + this.theme;
        content.style.fontSize = this.fontSize + 'px';
      }
      localStorage.setItem('reader-theme', this.theme);
      localStorage.setItem('reader-font', this.fontSize);
    },
    toggleToc() { this.tocVisible = !this.tocVisible; },
    toggleAutoScroll() {
      if (this.autoScrolling) {
        clearInterval(this.autoScrollTimer);
        this.autoScrolling = false;
        return;
      }
      this.autoScrolling = true;
      this.autoScrollTimer = setInterval(() => {
        const c = document.getElementById('readerContent');
        if (!c || !this.currentBook) { this.autoScrolling = false; clearInterval(this.autoScrollTimer); return; }
        c.scrollTop += this.autoScrollSpeed * 0.3;
        if (c.scrollTop >= c.scrollHeight - c.clientHeight - 10) {
          this.autoScrolling = false;
          clearInterval(this.autoScrollTimer);
          toast('📖 已到末尾');
        }
      }, 30);
    },
    copyToNote() {
      const sel = window.getSelection().toString().trim();
      if (!sel || sel.length < 3) return;
      fetch('/api/notes', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ title: '📖 '+sel.slice(0,30), content: '> '+sel.replace(/\n/g,'\n> ')+'\n\n---\n*来源：'+this.currentBook+'*' })
      }).then(() => toast('✅ 已保存到笔记')).catch(() => {});
    },
  },
  mounted() { this.loadBooks(); },
}, '#read-app');

  // ═══ translate ═══
  mountPanel('translate', {
  data() {
    const history = JSON.parse(localStorage.getItem('transHistoryV2') || '[]');
    return {
      inputText: '',
      outputText: '',
      from: 'auto',
      to: 'en',
      history,
      pendingTimer: null,
      saveTimer: null,
      srtMode: false,
      srtOriginal: '',
    };
  },
  methods: {
    swapLang() { const f=this.from,t=this.to; if(f!=='auto'){this.from=t;this.to=f;this.autoTranslate();} },
    esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); },
    autoTranslate() {
      clearTimeout(this.pendingTimer);
      if (!this.inputText.trim()) { this.outputText = ''; return; }
      const from = this.from, to = this.to;
      if (from !== 'auto' && from === to) { this.outputText = '⚠️ 源语言和目标语言相同，无需翻译'; return; }
      this.pendingTimer = setTimeout(() => this.doTranslate(), 300);
    },
    async doTranslate() {
      if (!this.inputText.trim()) return;
      this.outputText = '';
      try {
        const r = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: this.inputText, from: this.from, to: this.to }),
        });
        const reader = r.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split('\n')) {
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
              try {
                const json = JSON.parse(line.slice(6));
                const c = json.choices?.[0]?.delta?.content;
                if (c) { fullText += c; this.outputText = this.srtMode ? this.restoreSrt(fullText) : fullText; }
              } catch {}
            }
          }
        }
        if (fullText) this.pendingSave(fullText);
      } catch(e) { this.outputText = '❌ ' + e.message; }
    },
    pendingSave(fullText) {
      const snapshot = { from: this.inputText, to: fullText, time: new Date().toLocaleString() };
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => {
        if (!this.history.find(h => h.from === snapshot.from && h.to === snapshot.to)) {
          this.history.unshift(snapshot);
          localStorage.setItem('transHistoryV2', JSON.stringify(this.history));
        }
      }, 2000);
    },
    loadHistory(item) { this.inputText = item.from; this.autoTranslate(); },
    delHistory(i) { this.history.splice(i, 1); localStorage.setItem('transHistoryV2', JSON.stringify(this.history)); },
    clearHistory() { if (confirm('清空全部？')) { this.history = []; localStorage.setItem('transHistoryV2', '[]'); } },
    copy() {
      if (!this.outputText || this.outputText.startsWith('❌')) { toast('⚠️ 无内容'); return; }
      navigator.clipboard.writeText(this.outputText).then(() => toast('📋 已复制'));
    },
    async saveToNotes() {
      if (!this.outputText || this.outputText.startsWith('❌')) { toast('⚠️ 请先翻译'); return; }
      await fetch('/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '🌐 ' + this.inputText.slice(0, 30), content: '**原文：**\n' + this.inputText + '\n\n**译文：**\n' + this.outputText }) });
      toast('✅ 已保存');
    },
    async loadFile(e) {
      const file = e.target.files[0]; if (!file) return;
      const text = await file.text();
      const ext = file.name.split('.').pop().toLowerCase();
      if (ext === 'srt' || ext === 'vtt') {
        this.srtMode = true; this.srtOriginal = text;
        const lines = text.split('\n').filter(l => l.trim() && !/^\d+$/.test(l.trim()) && !l.includes('-->') && l.trim() !== 'WEBVTT');
        this.inputText = lines.join('\n');
      } else {
        this.srtMode = false; this.inputText = text;
      }
      e.target.value = '';
      this.autoTranslate();
    },
    restoreSrt(translated) {
      const tLines = translated.split('\n');
      const oLines = this.srtOriginal.split('\n');
      let ti = 0;
      return oLines.map(l => {
        const t = l.trim();
        if (!t || /^\d+$/.test(t) || t.includes('-->') || t === 'WEBVTT') return l;
        return ti < tLines.length ? tLines[ti++] : l;
      }).join('\n');
    },
  },
  mounted() {
    this.$refs.input?.addEventListener('input', () => this.autoTranslate());
  },
}, '#translate-app');

  // ═══ ai ═══
  mountPanel('ai', {
  data() {
    const saved = JSON.parse(localStorage.getItem('aiModelToggles') || '[]');
    const models = AI_MODELS.map(m => {
      const s = saved.find(s => s.id === m.id);
      return { ...m, enabled: s ? s.enabled : m.enabled, messages: [], _pending: '' };
    });
    const savedChats = JSON.parse(localStorage.getItem('aiChatsV2') || '{}');
    models.forEach(m => {
      if (savedChats[m.col]) m.messages = savedChats[m.col];
    });
    return {
      models,
      inputText: '',
      temperature: 0.7,
      isGenerating: false,
      sessions: JSON.parse(localStorage.getItem('aiSessionsV2') || '[]'),
      abortControllers: {},
    };
  },
  computed: {
    enabledModels() { return this.models.filter(m => m.enabled); },
    gridStyle() {
      const n = this.enabledModels.length;
      if (n <= 1) return { gridTemplateColumns: '1fr', gridTemplateRows: '1fr' };
      if (n === 2) return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr' };
      if (n === 3) return { gridTemplateColumns: '1fr 1fr 1fr', gridTemplateRows: '1fr' };
      return { gridTemplateColumns: '1fr 1fr 1fr', gridTemplateRows: '1fr 1fr' };
    },
  },
  methods: {
    saveToggles() {
      localStorage.setItem('aiModelToggles', JSON.stringify(this.models.map(m => ({ id: m.id, enabled: m.enabled }))));
    },
    saveChats() {
      const data = {};
      this.models.forEach(m => { data[m.col] = m.messages; });
      localStorage.setItem('aiChatsV2', JSON.stringify(data));
    },
    formatAI(text) {
      let html = this.esc(text);
      html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
      html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
      html = html.replace(/\n/g, '<br>');
      return html;
    },
    esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); },
    onKeydown(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          const s = e.target.selectionStart;
          this.inputText = this.inputText.slice(0, s) + '\n' + this.inputText.slice(e.target.selectionEnd);
          this.$nextTick(() => { e.target.selectionStart = e.target.selectionEnd = s + 1; });
        } else {
          e.preventDefault();
          this.sendMessage();
        }
      }
    },
    async sendMessage() {
      const text = this.inputText.trim();
      if (!text) return;
      this.inputText = '';
      this.isGenerating = true;
      Object.values(this.abortControllers).forEach(c => c.abort());
      this.abortControllers = {};

      const msgId = Date.now();
      this.enabledModels.forEach(m => {
        m.messages.push({ id: msgId + '-user', role: 'user', content: text });
        m.messages.push({ id: msgId + '-ai', role: 'assistant', content: '' });
        m._pending = '';
        this.queryModel(m, text, msgId + '-ai');
      });
      this.saveChats();
    },
    async queryModel(model, userText, msgId) {
      const t0 = performance.now();
      const controller = new AbortController();
      this.abortControllers[model.col] = controller;
      try {
        const history = model.messages.filter(m => m.id !== msgId).map(m => ({ role: m.role, content: m.content }));
        const r = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: history, model: model.id, temperature: this.temperature }),
          signal: controller.signal,
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const reader = r.body.getReader();
        const decoder = new TextDecoder();
        let content = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
              try {
                const json = JSON.parse(line.slice(6));
                const c = json.choices?.[0]?.delta?.content;
                if (c) {
                  content += c;
                  const msg = model.messages.find(m => m.id === msgId);
                  if (msg) msg.content = content;
                }
              } catch {}
            }
          }
        }
        model._pending = content;
      model._responseTime = ((performance.now() - t0) / 1000).toFixed(1) + "s";
      } catch(e) {
        if (e.name !== 'AbortError') {
          const msg = model.messages.find(m => m.id === msgId);
          if (msg) msg.content = '❌ ' + e.message;
        }
      }
      this.saveChats();
      this.checkDone();
    },
    checkDone() {
      if (Object.keys(this.abortControllers).length === 0) this.isGenerating = false;
    },
    stopAll() {
      Object.values(this.abortControllers).forEach(c => c.abort());
      this.abortControllers = {};
      this.isGenerating = false;
    },
    retryModel(modelId) {
      const model = this.models.find(m => m.id === modelId);
      if (!model) return;
      const lastUser = [...model.messages].reverse().find(m => m.role === 'user');
      if (!lastUser) return;
      // Remove last AI message
      const lastAI = [...model.messages].reverse().find(m => m.role === 'assistant');
      if (lastAI) model.messages = model.messages.filter(m => m.id !== lastAI.id);
      const msgId = Date.now() + '-retry';
      model.messages.push({ id: msgId, role: 'assistant', content: '' });
      this.isGenerating = true;
      this.queryModel(model, lastUser.content, msgId);
      this.saveChats();
    },
    // 会话管理
    newSession() {
      this.saveCurrentSession();
      this.models.forEach(m => m.messages = []);
      this.inputText = '';
      this.saveChats();
    },
    saveCurrentSession() {
      const hasContent = this.models.some(m => m.messages.length > 0);
      if (!hasContent) return;
      const firstQ = this.models.find(m => m.messages.length)?.messages.find(m => m.role === 'user');
      const msgs = {};
      this.models.forEach(m => { msgs[m.col] = [...m.messages]; });
      this.sessions.unshift({
        id: Date.now(),
        title: (firstQ?.content || '未命名').slice(0, 30),
        msgs,
        time: new Date().toLocaleString(),
      });
      if (this.sessions.length > 20) this.sessions.pop();
      this.saveSessions();
    },
    loadSession(id) {
      const s = this.sessions.find(s => s.id === id);
      if (!s) return;
      this.models.forEach(m => {
        m.messages = s.msgs[m.col] ? [...s.msgs[m.col]] : [];
      });
      this.saveChats();
    },
    deleteSession(id) {
      this.sessions = this.sessions.filter(s => s.id !== id);
      this.saveSessions();
    },
    saveSessions() {
      localStorage.setItem('aiSessionsV2', JSON.stringify(this.sessions));
    },
    clearAll() {
      this.models.forEach(m => m.messages = []);
      this.saveChats();
    },
    // 存笔记
    async saveToNotes() {
      const parts = [];
      let question = '';
      this.models.forEach(m => {
        const userMsg = m.messages.find(m => m.role === 'user');
        const aiMsg = [...m.messages].reverse().find(m => m.role === 'assistant');
        if (userMsg && !question) question = userMsg.content;
        if (aiMsg && aiMsg.content) parts.push('**' + m.name + '：**\n' + aiMsg.content);
      });
      if (!question) { toast('⚠️ 还没有对话'); return; }
      try {
        await fetch('/api/notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: '🤖 ' + question.slice(0, 30), content: '**问题：**\n' + question + '\n\n' + parts.join('\n\n---\n\n') }),
        });
        toast('✅ 已保存到笔记');
      } catch(e) { toast('❌ 保存失败'); }
    },
  },
  mounted() {
    // Restore model toggles from localStorage
    const saved = JSON.parse(localStorage.getItem('aiModelToggles') || '[]');
    saved.forEach(s => {
      const m = this.models.find(m => m.id === s.id);
      if (m) m.enabled = s.enabled;
    });
  },
}, '#ai-app');

  // ═══ voice ═══
  mountPanel('voice', {
  data() {
    return {
      ttsText: '',
      ttsVoice: 'zh-CN-XiaoxiaoNeural',
      ttsLoading: false,
      sttText: '',
      sttListening: false,
      voices: [
        { name: 'zh-CN-XiaoxiaoNeural', label: '晓晓 (女-温柔)' },
        { name: 'zh-CN-YunxiNeural', label: '云希 (男-青春)' },
        { name: 'zh-CN-YunyangNeural', label: '云扬 (男-新闻)' },
        { name: 'zh-CN-XiaoyiNeural', label: '晓伊 (女-活泼)' },
        { name: 'en-US-JennyNeural', label: 'Jenny (US-Female)' },
        { name: 'en-US-GuyNeural', label: 'Guy (US-Male)' },
      ],
    };
  },
  methods: {
    async speak() {
      if (!this.ttsText.trim()) { toast('⚠️ 请输入文字'); return; }
      this.ttsLoading = true;
      try {
        const r = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: this.ttsText, voice: this.ttsVoice }),
        });
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        new Audio(url).play();
        this._ttsBlob = blob; // 保存以备存到文件
        toast('✅ 播放中');
      } catch(e) { toast('❌ ' + e.message); }
      this.ttsLoading = false;
    },
    async saveTTSAudio() {
      if (!this._ttsBlob) { toast('⚠️ 请先生成语音'); return; }
      const name = (this.ttsText.slice(0, 20) || '语音') + '.mp3';
      const form = new FormData();
      form.append('file', this._ttsBlob, name);
      try {
        const r = await fetch('/api/files', { method: 'POST', body: form });
        if (r.ok) toast('✅ 已保存到文件中转站');
        else toast('❌ 保存失败');
      } catch(e) { toast('❌ ' + e.message); }
    },
    async saveTTS() {
      if (!this.ttsText.trim()) return;
      await fetch('/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '🔊 ' + this.ttsText.slice(0, 30), content: this.ttsText }) });
      toast('✅ 已保存到笔记');
    },
    toggleSTT() { this.sttListening ? this.stopSTT() : this.startSTT(); },
    startSTT() {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { toast('⚠️ 浏览器不支持语音识别'); return; }
      const rec = new SR();
      rec.lang = 'zh-CN';
      rec.interimResults = true;
      rec.continuous = true;
      rec.onstart = () => this.sttListening = true;
      rec.onresult = (e) => {
        let t = '';
        for (let i = e.resultIndex; i < e.results.length; i++) t += e.results[i][0].transcript;
        this.sttText = t;
      };
      rec.onerror = (e) => { this.sttListening = false; if (e.error !== 'aborted') toast('⚠️ ' + e.error); };
      rec.onend = () => this.sttListening = false;
      rec.start();
      this._rec = rec;
    },
    stopSTT() { if (this._rec) { this._rec.stop(); this._rec = null; } },
    copySTT() {
      if (!this.sttText.trim()) { toast('⚠️ 无内容'); return; }
      navigator.clipboard.writeText(this.sttText).then(() => toast('📋 已复制'));
    },
    async saveSTT() {
      if (!this.sttText.trim()) return;
      await fetch('/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '🎤 ' + this.sttText.slice(0, 30), content: this.sttText }) });
      toast('✅ 已保存到笔记');
    },
    clearSTT() { this.sttText = ''; },
  },
}, '#voice-app');

// 键盘控制 (独立于 Vue，需要全局监听)
document.addEventListener('keydown', function(e) {
  const app = document.getElementById('read-app')?.__vue_app__?._instance?.proxy;
  if (!app || !app.currentBook) return;
  if (e.key === 'Escape') { app.close(); return; }
  if (e.key === 'f' && !e.ctrlKey) { document.getElementById('readerView')?.requestFullscreen(); return; }
  if (e.key === 'ArrowLeft' && app._rendition) { e.preventDefault(); app._rendition.prev(); }
  if (e.key === 'ArrowRight' && app._rendition) { e.preventDefault(); app._rendition.next(); }
  const c = document.getElementById('readerContent');
  if (e.key === ' ') { e.preventDefault(); c?.scrollBy({top:c.clientHeight*0.8,behavior:'smooth'}); }
  if (e.key === 'ArrowDown') { e.preventDefault(); c?.scrollBy({top:60,behavior:'smooth'}); }
  if (e.key === 'ArrowUp') { e.preventDefault(); c?.scrollBy({top:-60,behavior:'smooth'}); }
  if (e.key === '=' && app.autoScrolling) { app.autoScrollSpeed = Math.min(20, app.autoScrollSpeed+1); }
  if (e.key === '-' && app.autoScrolling) { app.autoScrollSpeed = Math.max(1, app.autoScrollSpeed-1); }
});

// 划词进笔记
document.addEventListener('mouseup', function(e) {
  const app = document.getElementById('read-app')?.__vue_app__?._instance?.proxy;
  if (!app || !app.currentBook) return;
  const sel = window.getSelection().toString().trim();
  if (!sel || sel.length < 3) return;
  const popup = document.createElement('div');
  popup.style.cssText = 'position:fixed;z-index:999;background:var(--accent);color:#fff;padding:6px 12px;border-radius:8px;font-size:13px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.2);';
  popup.textContent = '💾 保存到笔记';
  popup.style.left = Math.min(e.clientX+10, window.innerWidth-140) + 'px';
  popup.style.top = (e.clientY-35) + 'px';
  popup.addEventListener('click', () => { app.copyToNote(); popup.remove(); });
  document.body.appendChild(popup);
  setTimeout(() => popup.remove(), 3000);
});


  // AI_MODELS 常量
  const AI_MODELS = [
    { id: 'deepseek-chat', name: 'DeepSeek V4', icon: '🧠', col: 'aiCol1', enabled: true },
    { id: 'deepseek-reasoner', name: 'DeepSeek R1', icon: '🔮', col: 'aiCol2', enabled: false },
    { id: 'qwen-max', name: '通义千问', icon: '☁️', col: 'aiCol3', enabled: false },
    { id: 'moonshot-v1', name: 'Kimi', icon: '🌙', col: 'aiCol4', enabled: false },
    { id: 'doubao', name: '豆包', icon: '🫘', col: 'aiCol5', enabled: false },
  ];

})();
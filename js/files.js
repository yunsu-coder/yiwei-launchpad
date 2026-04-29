// js/files.js - 文件中转站 (Vue 3)
Vue.createApp({
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
  mounted() { window.__files_proxy = this; 
    this.loadFiles();
  },
}).mount('#files-app');

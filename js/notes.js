// js/notes.js - Markdown 笔记模块 (Vue 3)
Vue.createApp({
  data() {
    return {
      noteSearch: '',
      notes: [],
      currentId: null,
      editing: false,
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
      let s = (md || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const cb=[]; s=s.replace(/```(\w*)\n([\s\S]*?)```/g,(_,l,c)=>{cb.push({lang:l,code:c.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')});return '\x00C'+ (cb.length-1) +'\x00';});
      const tb=[]; s=s.replace(/^\|(.+)\|\n\|[-: |]+\|\n((?:\|.+\|\n?)*)/gm,(_,h,r)=>{const hc=h.split('|').map(c=>'<th>'+c.trim()+'</th>').join('');const rr=r.trim().split('\n').map(r2=>'<tr>'+r2.split('|').filter(c=>c).map(c=>'<td>'+c.trim()+'</td>').join('')+'</tr>').join('');tb.push('<table><thead><tr>'+hc+'</tr></thead><tbody>'+rr+'</tbody></table>');return '\x00T'+ (tb.length-1) +'\x00';});
      s=s.replace(/^(---|\*\*\*|___)\s*$/gm,'<hr>');
      s=s.replace(/^###### (.+)$/gm,'<h6>$1</h6>').replace(/^##### (.+)$/gm,'<h5>$1</h5>').replace(/^#### (.+)$/gm,'<h4>$1</h4>').replace(/^### (.+)$/gm,'<h3>$1</h3>').replace(/^## (.+)$/gm,'<h2>$1</h2>').replace(/^# (.+)$/gm,'<h1>$1</h1>');
      s=s.replace(/^&gt;\s?(.+)$/gm,'<blockquote>$1</blockquote>');
      s=s.replace(/^[*-] \[x\] (.+)$/gim,'<li class="task done"><input type="checkbox" checked disabled> $1</li>');
      s=s.replace(/^[*-] \[ \] (.+)$/gim,'<li class="task"><input type="checkbox" disabled> $1</li>');
      s=s.replace(/^(\d+)\. (.+)$/gm,'<li data-n="$1">$2</li>');
      s=s.replace(/((?:<li[^>]*>.*<\/li>\n?)+)/g,m=>m.includes('data-n')?'<ol>\n'+m+'</ol>\n':m.includes('task')?'<ul class="task-list">\n'+m+'</ul>\n':'<ul>\n'+m+'</ul>\n');
      s=s.replace(/^[*-] (.+)$/gm,'<li>$1</li>');
      s=s.replace(/((?:<li>(?!<\/li>).*<\/li>\n?)+)/g,'<ul>\n$1</ul>\n');
      s=s.replace(/\n\n+/g,'</p><p>'); s=s.replace(/\n/g,'<br>');
      s=s.replace(/\*\*\*(.+?)\*\*\*/g,'<strong><em>$1</em></strong>');
      s=s.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>'); s=s.replace(/\*(.+?)\*/g,'<em>$1</em>');
      s=s.replace(/~~(.+?)~~/g,'<del>$1</del>'); s=s.replace(/`([^`]+)`/g,'<code>$1</code>');
      s=s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g,'<img src="$2" alt="$1" style="max-width:100%;">');
      s=s.replace(/\[([^\]]+)\]\(([^)]+)\)/g,'<a href="$2" target="_blank">$1</a>');
      s=s.replace(/\x00C(\d+)\x00/g,(_,i)=>{const c=cb[+i];return '<pre><code class="'+(c.lang||'')+'">'+c.code+'</code></pre>';});
      s=s.replace(/\x00T(\d+)\x00/g,(_,i)=>tb[+i]);
      return '<p>'+s+'</p>';
    },
    esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); },
    updatePreview() { this.preview = this.md2html(this.content); this.dirty = true; },
    async loadList() {
      try { this.notes = await (await fetch('/api/notes')).json(); } catch(e) {}
    },
    async newNote() {
      if (this.dirty && !confirm('未保存，放弃？')) return;
      this.stopAutoSave();
      this.currentId = null; this.editing = true; this.title = ''; this.content = ''; this.preview = ''; this.dirty = false;
    },
    async openNote(id) {
      if (this.dirty && id !== this.currentId && !confirm('未保存，放弃？')) return;
      try {
        const note = await (await fetch('/api/notes/' + id)).json();
        this.currentId = id; this.editing = true; this.title = note.title; this.content = note.content;
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
    this.loadList();
  },
  beforeUnmount() { this.stopAutoSave(); },
}).mount('#notes-app');

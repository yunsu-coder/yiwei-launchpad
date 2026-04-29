// js/reader.js - 阅读器模块 (Vue 3)
Vue.createApp({
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
  mounted() { window.__read_proxy = this;  this.loadBooks(); },
}).mount('#read-app');

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

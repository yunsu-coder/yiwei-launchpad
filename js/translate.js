// js/translate.js - 翻译模块 (Vue 3)
Vue.createApp({
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
}).mount('#translate-app');

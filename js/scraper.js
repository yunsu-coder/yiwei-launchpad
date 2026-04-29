// js/scraper.js - 采集模块 (Vue 3)
Vue.createApp({
  data() {
    return {
      urls: '',
      type: 'images',
      minWidth: 0,
      minHeight: 0,
      followDetail: true,
      deepRender: false,
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
          body: JSON.stringify({ urls: urlList, type: this.type, minWidth: this.minWidth, minHeight: this.minHeight, followDetail: this.followDetail, deepRender: this.deepRender }),
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
  mounted() { this.loadSessions(); },
}).mount('#scrape-app');

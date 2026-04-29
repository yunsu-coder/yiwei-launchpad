// js/voice.js - 语音模块 (Vue 3)
Vue.createApp({
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
}).mount('#voice-app');

// js/ai.js - AI 多模型对比 (Vue 3)
const { createApp } = Vue;

const AI_MODELS = [
  { id: 'deepseek-chat', name: 'DeepSeek V4', icon: '🧠', col: 'aiCol1', enabled: true },
  { id: 'deepseek-reasoner', name: 'DeepSeek R1', icon: '🔮', col: 'aiCol2', enabled: false },
  { id: 'qwen-max', name: '通义千问', icon: '☁️', col: 'aiCol3', enabled: false },
  { id: 'moonshot-v1', name: 'Kimi', icon: '🌙', col: 'aiCol4', enabled: false },
  { id: 'doubao', name: '豆包', icon: '🫘', col: 'aiCol5', enabled: false },
];

const AI_AGENTS = [
  { id: 'code', name: '代码助手', icon: '💻', model: 'deepseek-chat',
    prompt: '你是一位资深全栈工程师。给出简洁可运行的代码，标明语言。' },
  { id: 'write', name: '创意写作', icon: '✍️', model: 'deepseek-chat',
    prompt: '你是一位专业作家。创作高质量内容，注重文笔和结构。' },
  { id: 'academic', name: '学术顾问', icon: '📚', model: 'deepseek-reasoner',
    prompt: '你是一位严谨的学术研究助手。引用来源，逻辑严密。' },
  { id: 'legal', name: '法律顾问', icon: '⚖️', model: 'deepseek-chat',
    prompt: '你是一位法律顾问。基于法律体系提供参考。末尾声明：以上仅供参考，不构成法律建议。' },
  { id: 'translate', name: '翻译专家', icon: '🌐', model: 'deepseek-chat',
    prompt: '你是一位专业翻译。准确流畅地翻译用户输入。如未指定目标语言，默认翻译为中文。' },
  { id: 'image', name: '图像生成', icon: '🎨', model: 'deepseek-chat', type: 'image',
    prompt: '根据用户描述生成详细的图像生成提示词（英文），适合 Stable Diffusion/DALL-E。描述构图、风格、色彩、光线。直接输出英文 prompt，不要解释。' },
];

createApp({
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
      agentMode: false,
      currentAgent: null,
      agents: AI_AGENTS,
      generatedImage: '',
      lastImagePrompt: '',
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

      // 智能体模式：只用一个模型，注入系统提示
      if (this.agentMode && this.currentAgent) {
        const agent = this.currentAgent;
        const model = this.models.find(m => m.id === agent.model) || this.models[0];
        // 禁用其他模型，只启用一个
        this.models.forEach(m => m.enabled = (m.id === model.id));
        const msgId = Date.now();
        model.messages.push({ id: msgId + '-user', role: 'user', content: text });
        model.messages.push({ id: msgId + '-ai', role: 'assistant', content: '' });
        // 注入系统提示到历史
        const history = [
          { role: 'system', content: agent.prompt },
          ...model.messages.filter(m => m.id !== msgId + '-ai').map(m => ({ role: m.role, content: m.content }))
        ];
        this.queryModelAgent(model, history, msgId + '-ai', agent);
        this.saveChats();
        return;
      }

      // 多模型对比模式（原逻辑）
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
    async queryModelAgent(model, history, msgId, agent) {
      const t0 = performance.now();
      const controller = new AbortController();
      this.abortControllers[model.col] = controller;
      try {
        const r = await fetch('/api/ai/chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: history, model: agent.model, temperature: this.temperature }),
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
          for (const line of chunk.split('\n')) {
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
              try {
                const json = JSON.parse(line.slice(6));
                const c = json.choices?.[0]?.delta?.content;
                if (c) { content += c; const msg = model.messages.find(m => m.id === msgId); if (msg) msg.content = content; }
              } catch {}
            }
          }
        }
        model._responseTime = ((performance.now() - t0) / 1000).toFixed(1) + 's';
        if (agent.type === 'image') { this.lastImagePrompt = content; }
      } catch (e) {
        if (e.name !== 'AbortError') { const msg = model.messages.find(m => m.id === msgId); if (msg) msg.content = '\u274c ' + e.message; }
      }
      this.saveChats();
      this.checkDone();
    },
    selectAgent(agent) {
      this.currentAgent = agent;
      const model = this.models.find(m => m.id === agent.model);
      if (model) { this.models.forEach(m => m.enabled = (m.id === model.id)); }
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
}).mount('#ai-app');

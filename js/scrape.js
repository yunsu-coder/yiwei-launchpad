// ===== 采集模块 =====

/** 从分享文本中提取纯 URL（去掉【标题】等中文修饰） */
function cleanUrl(text) {
  // 去掉【...】包裹的中文标题
  let cleaned = text.replace(/【[^】]+】/g, '');
  // 去掉 [...] 包裹的内容
  cleaned = cleaned.replace(/\[[^\]]+\]/g, '');
  // 提取第一个 http/https URL
  const m = cleaned.match(/https?:\/\/\S+/);
  return m ? m[0].replace(/[。,，！？、；：）\)""]+$/, '') : text.trim();
}

function extractNumbers(s) {
  // 提取字符串中所有的数字序列及其位置
  const nums = [];
  const re = /\d+/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    nums.push({ value: m[0], start: m.index, end: m.index + m[0].length });
  }
  return nums;
}

function expandUrls(raw) {
  const lines = raw.split('\n').map(s => cleanUrl(s)).filter(Boolean);
  
  // 智能模式：只有两行，且只有一个字段不同 → 自动展开
  if (lines.length === 2) {
    const a = lines[0], b = lines[1];
    const numsA = extractNumbers(a), numsB = extractNumbers(b);
    
    // 找只有一个数字不同的情况
    if (numsA.length === numsB.length && numsA.length >= 1) {
      let diffIdx = -1;
      for (let i = 0; i < numsA.length; i++) {
        if (numsA[i].value !== numsB[i].value) {
          if (diffIdx === -1 && numsA[i].start === numsB[i].start && numsA[i].end === numsB[i].end) {
            diffIdx = i;
          } else {
            diffIdx = -2; break; // 多个不同或位置不同，退出
          }
        }
      }
      if (diffIdx >= 0) {
        const n1 = parseInt(numsA[diffIdx].value);
        const n2 = parseInt(numsB[diffIdx].value);
        const start = Math.min(n1, n2);
        const end = Math.max(n1, n2);
        const pad = numsA[diffIdx].value.length;
        const pre = a.slice(0, numsA[diffIdx].start);
        const post = a.slice(numsA[diffIdx].end);
        
        if (end - start > 0 && end - start <= 10000) {
          const urls = [];
          for (let i = start; i <= end; i++) {
            urls.push(pre + String(i).padStart(pad, '0') + post);
          }
          console.log('智能展开:', start, '→', end, '共', urls.length, '个 URL');
          return urls;
        }
      }
    }
  }
  
  // 常规模式：支持 {start-end} 批量展开，支持多行
  const urls = [];
  for (const line of lines) {
    const m = line.match(/^(.+)\{(\d+)-(\d+)\}(.*)$/);
    if (m) {
      const [_, pre, start, end, post] = m;
      const s = parseInt(start), e = parseInt(end);
      const pad = start.length;
      for (let i = s; i <= e; i++) {
        urls.push(pre + String(i).padStart(pad, '0') + post);
      }
    } else {
      urls.push(line);
    }
  }
  return urls;
}

async function startScrape() {
  const raw = document.getElementById('scrapeUrls').value.trim();
  const urls = expandUrls(raw);
  if (!urls.length) { toast('⚠️ 请输入至少一个网址'); return; }
  const type = document.querySelector('input[name="scrapeType"]:checked').value;

  const prog = document.getElementById('scrapeProgress');
  const btn = document.querySelector('#panel-scrape .btn.accent');
  const batchInfo = urls.length > 1 ? '（智能展开 ' + urls.length + ' 个 URL）' : '';
  prog.innerHTML = '🔍 正在采集...' + batchInfo + '<br><small>' + escHtml(urls[0]) + '</small>';
  btn.disabled = true; btn.textContent = '⏳ 采集中...';

  try {
    const r = await fetch('/api/scrape', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls, type }),
    });
    const result = await r.json();
    prog.innerHTML = '';
    btn.disabled = false; btn.textContent = '🚀 开始采集';

    if (r.ok) {
      const imgs = result.imageCount || 0;
      const txts = result.textCount || 0;
      const errs = result.errorCount || 0;
      const tp = type;
      const fileLabel = tp === 'video' ? '个视频' : tp === 'music' ? '个音频' : '张图片';
      const allLabel = tp === 'video' ? '视频' : tp === 'music' ? '音频' : '图片';
      if (imgs + txts === 0) {
        toast('⚠️ 未采集到内容' + (errs > 0 ? '（' + errs + '个页面失败）' : ''));
      } else {
        const parts = [];
        if (imgs > 0) parts.push(imgs + fileLabel);
        if (txts > 0) parts.push(txts + '个文本');
        toast('✅ 采集完成：' + parts.join(', ') + (errs > 0 ? ', ' + errs + '个失败' : ''));
      }
      loadScrapeSessions();
    } else {
      toast('❌ ' + (result.error || '采集失败'));
    }
  } catch(e) {
    prog.innerHTML = '';
    btn.disabled = false; btn.textContent = '🚀 开始采集';
    toast('❌ 请求失败：' + e.message);
  }
}

async function loadScrapeSessions() {
  try {
    const sessions = await (await fetch('/api/scrape/list')).json();
    const el = document.getElementById('scrapeSessions');
    const empty = document.getElementById('scrapeEmpty');
    if (!sessions.length) { el.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';

    // 批量操作栏
    const batchBar = document.getElementById('scrapeBatchBar');
    if (sessions.length) {
      if (batchBar) batchBar.style.display = 'flex';
    }

    el.innerHTML = '';
    for (const s of sessions) {
      // 贴吧采集会话
      if (s.type === 'tieba') {
        const card = document.createElement('div');
        card.className = 'scrape-card';
        card.innerHTML = `
          <div class="sc-header">
            <input type="checkbox" class="file-check scrape-check" data-sid="${s.sessionId}" onchange="updateScrapeBatchBar()" onclick="event.stopPropagation()" style="flex-shrink:0;margin-right:.4rem;">
            <div>
              <div class="sc-title">📋 ${escHtml(s.kw || '')}吧</div>
              <div class="sc-meta">${new Date(s.time).toLocaleString('zh-CN')} · ${s.threadCount || 0}个帖子 · ${s.textSize > 1024 ? (s.textSize/1024).toFixed(1)+'KB' : (s.textSize||0)+'B'}</div>
            </div>
          </div>
          <div class="sc-actions">
            <button class="btn-sm" onclick="viewTiebaText('${s.sessionId}', '${(s.textFile||'').replace(/'/g, "\\'")}')">📄 查看文本</button>
            <button class="btn-sm" onclick="transferScrape('${s.sessionId}')">📁 转存到文件</button>
            <button class="btn-sm danger" onclick="delScrapeSession('${s.sessionId}')">🗑 删除</button>
          </div>
        `;
        el.appendChild(card);
        continue;
      }
      // 常规采集会话
      const typeLabel = s.type === 'images' ? '📷 图片' : s.type === 'text' ? '📄 文本' : s.type === 'video' ? '🎬 视频' : s.type === 'music' ? '🎵 音频' : '📷📄 图片+文本';
      const fileLabel = s.type === 'video' ? '个视频' : s.type === 'music' ? '个音频' : '张图片';
      
      // 图片预览：前3张 + 展开
      let imgPreview = '';
      if (s.imageCount > 0 && s.type !== 'video' && s.type !== 'music') {
        const imgs = s.images || [];
        const show = imgs.slice(0, 3);
        const more = imgs.length - 3;
        imgPreview = `<div class="sc-preview" style="cursor:pointer;" onclick="expandScrapeImages('${s.sessionId}')">` +
          show.map(img => `<img src="/api/scrape/img/${s.sessionId}/${img.name}" title="${escHtml(img.name)}">`).join('') +
          (more > 0 ? `<span class="sc-more-badge">+${more}</span>` : '') +
          `</div>`;
      }
      // 视频/音频：文件名列表
      if (s.imageCount > 0 && (s.type === 'video' || s.type === 'music')) {
        imgPreview = `<div style="font-size:.8rem;margin-top:.3rem;">${(s.images||[]).slice(0,3).map(i => '🎬 ' + (i.name||'')).join(', ')}${(s.images||[]).length>3?' ...':''}</div>`;
      }
      // 文本预览
      let txtPreview = '';
      if (s.textCount > 0) {
        const txts = s.texts || [];
        const show = txts.slice(0, 3);
        const more = txts.length - 3;
        txtPreview = `<div style="font-size:.8rem;margin-top:.3rem;cursor:pointer;" onclick="expandScrapeTexts('${s.sessionId}')">📄 ` +
          show.map(t => t.name).join(', ') +
          (more > 0 ? ` <span class="sc-more-badge">+${more}</span>` : '') +
          `</div>`;
      }

      const card = document.createElement('div');
      card.className = 'scrape-card';
      card.innerHTML = `
        <div class="sc-header">
          <input type="checkbox" class="file-check scrape-check" data-sid="${s.sessionId}" onchange="updateScrapeBatchBar()" onclick="event.stopPropagation()" style="flex-shrink:0;margin-right:.4rem;">
          <div>
            <div class="sc-title">🌐 ${escHtml(s.title || s.url)}</div>
            <div class="sc-meta">${new Date(s.time).toLocaleString('zh-CN')} · ${s.urlCount}个页面 · ${typeLabel}</div>
          </div>
        </div>
        ${imgPreview}
        ${txtPreview}
        <div class="sc-meta">共 ${s.imageCount} ${fileLabel}, ${s.textCount} 个文本${s.errorCount > 0 ? `, ⚠️ ${s.errorCount} 个失败` : ''}</div>
        <div class="sc-actions">
          <button class="btn-sm" onclick="transferScrape('${s.sessionId}')">📁 转存到文件</button>
          <button class="btn-sm danger" onclick="delScrapeSession('${s.sessionId}')">🗑 删除</button>
        </div>
      `;
      el.appendChild(card);
    }
  } catch(e) { console.error(e); }
}

async function transferScrape(sid) {
  const r = await fetch('/api/scrape/transfer/' + sid, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
  if (r.ok) {
    const data = await r.json();
    toast('✅ ' + data.transferred.length + ' 个文件已转存到文件中转站');
  } else { toast('❌ 转存失败'); }
}

async function delScrapeSession(sid) {
  if (!confirm('确定删除这条采集记录？')) return;
  await fetch('/api/scrape/session/' + sid, { method: 'DELETE' });
  toast('🗑️ 已删除');
  loadScrapeSessions();
}

// ===== 百度贴吧采集 =====
async function startTiebaScrape() {
  const kw = document.getElementById('tiebaKw').value.trim();
  if (!kw) { toast('⚠️ 请输入贴吧名称'); return; }

  const btn = document.getElementById('tiebaBtn');
  const resultEl = document.getElementById('tiebaResult');
  const maxPages = parseInt(document.getElementById('tiebaPages').value);
  const maxThreads = parseInt(document.getElementById('tiebaThreads').value);
  const includeComments = document.getElementById('tiebaComments').checked;

  btn.disabled = true;
  btn.textContent = '⏳ 抓取中...';
  resultEl.innerHTML = '<div class="scrape-progress">🔍 正在抓取「' + escHtml(kw) + '」吧...<br><small>抓取 ' + maxPages + ' 页，最多 ' + maxThreads + ' 个帖子</small></div>';

  try {
    const r = await fetch('/api/scrape/tieba', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kw, maxPages, maxThreads, includeComments }),
    });
    const data = await r.json();

    btn.disabled = false;
    btn.textContent = '🚀 开始抓取';

    if (r.ok) {
      const errWarn = data.errors?.length ? '（' + data.errors.length + ' 个异常）' : '';
      toast('✅ 抓取完成：' + data.threadCount + ' 个帖子' + errWarn);

      // 显示结果
      let html = '<div class="scrape-card"><div class="sc-header"><div>';
      html += '<div class="sc-title">📋 ' + escHtml(kw) + '吧</div>';
      html += '<div class="sc-meta">' + new Date(data.time).toLocaleString('zh-CN') + ' · ' + data.threadCount + '个帖子 · ' + (data.textSize > 1024 ? (data.textSize/1024).toFixed(1)+'KB' : data.textSize+'B') + '</div>';
      html += '</div></div>';

      // 帖子预览
      if (data.threads && data.threads.length) {
        html += '<div class="sc-meta" style="margin-top:.4rem;">📌 帖子列表：</div>';
        const preview = data.threads.slice(0, 10).map(t => {
          const title = (t.title || '无标题').slice(0, 40);
          const author = t.author ? ' · ' + t.author : '';
          const replies = t.replyCount > 0 ? ' · ' + t.replyCount + '回复' : '';
          return '<div style="font-size:.78rem;padding:.15rem 0;">' +
            '• <a href="' + escAttr((t.href || 'https://tieba.baidu.com/p/' + t.tid)) + '" target="_blank">' + escHtml(title) + '</a>' +
            '<span style="color:var(--sub);">' + author + replies + '</span></div>';
        }).join('');
        html += preview;
        if (data.threads.length > 10) {
          html += '<div style="font-size:.78rem;color:var(--sub);">... 还有 ' + (data.threads.length - 10) + ' 个帖子</div>';
        }
      }

      // 操作按钮
      html += '<div class="sc-actions">' +
        '<button class="btn-sm" onclick="viewTiebaText(\'' + data.sessionId + '\', \'' + (data.textFile || '') + '\')">📄 查看文本</button>' +
        '<button class="btn-sm" onclick="transferScrape(\'' + data.sessionId + '\')">📁 转存到文件</button>' +
        '</div>';

      // 错误信息
      if (data.errors && data.errors.length) {
        html += '<div class="sc-meta" style="color:var(--danger);margin-top:.3rem;">⚠️ ' +
          data.errors.slice(0, 5).map(e => escHtml((e.page||e.thread||'') + ': ' + (e.error||''))).join('<br>') +
          '</div>';
      }

      html += '</div>';
      resultEl.innerHTML = html;
    } else {
      resultEl.innerHTML = '<div class="scrape-progress" style="color:var(--danger);">❌ ' + escHtml(data.error || '抓取失败') + '</div>';
      toast('❌ ' + (data.error || '抓取失败'));
    }
  } catch (e) {
    btn.disabled = false;
    btn.textContent = '🚀 开始抓取';
    resultEl.innerHTML = '<div class="scrape-progress" style="color:var(--danger);">❌ 请求失败：' + escHtml(e.message) + '</div>';
    toast('❌ 请求失败：' + e.message);
  }
}

async function viewTiebaText(sessionId, filename) {
  if (!filename) { toast('⚠️ 文本文件不存在'); return; }
  try {
    const r = await fetch('/api/scrape/text/' + sessionId + '/' + encodeURIComponent(filename));
    if (!r.ok) { toast('❌ 读取失败'); return; }
    const text = await r.text();
    // 新窗口展示
    const w = window.open('', '_blank');
    if (w) {
      w.document.write('<html><head><meta charset="UTF-8"><title>' + escHtml(filename) + '</title><style>' +
        'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:800px;margin:2rem auto;padding:0 1rem;line-height:1.8;font-size:15px;color:#333;background:#fafafa;}' +
        'pre{white-space:pre-wrap;word-break:break-word;}' +
        '@media(prefers-color-scheme:dark){body{color:#ddd;background:#1a1a2e;}}</style></head>' +
        '<body><pre>' + escHtml(text) + '</pre></body></html>');
    }
  } catch (e) {
    toast('❌ 读取失败：' + e.message);
  }
}


// ===== 快捷入口 =====
function fillScrapeUrl(platform) {
  const ta = document.getElementById('scrapeUrls');
  const hints = {
    bilibili: 'https://www.bilibili.com/video/BV1xx411c7mD\n（替换为你要采集的B站视频链接）',
    music: 'https://music.163.com/song?id=123456\n（替换为歌曲/专辑链接，支持网易云、QQ音乐）',
    xiaohongshu: 'https://www.xiaohongshu.com/explore/abc123\n（替换为小红书笔记链接）',
    movie: 'https://example.com/movie.mp4\n或电影网站页面URL，自动抓取页面内MP4/MKV视频',
    doc: 'https://example.com/doc.pdf\n或文档页面URL，自动抓取PDF/DOC/DOCX/XLS/PPT',
  };
  const radios = {
    bilibili: 'both', music: 'music', xiaohongshu: 'both', movie: 'video', doc: 'both'
  };
  ta.value = hints[platform] || '';
  const radio = document.querySelector(`input[name="scrapeType"][value="${radios[platform] || 'both'}"]`);
  if (radio) radio.checked = true;
  ta.focus();
}

// ===== 采集批量操作 =====
function updateScrapeBatchBar() {
  const checked = document.querySelectorAll('.scrape-check:checked');
  const bar = document.getElementById('scrapeBatchBar');
  const count = document.getElementById('scrapeSelectedCount');
  if (bar) bar.style.display = checked.length ? 'flex' : 'none';
  if (count) count.textContent = checked.length ? '已选 ' + checked.length + ' 条' : '';
}

function toggleScrapeSelectAll() {
  const all = document.getElementById('scrapeSelectAll');
  document.querySelectorAll('.scrape-check').forEach(cb => { cb.checked = all.checked; });
  updateScrapeBatchBar();
}

async function batchTransferScrape() {
  const checked = document.querySelectorAll('.scrape-check:checked');
  if (!checked.length) { toast('⚠️ 请先勾选'); return; }
  let ok = 0;
  for (const cb of checked) {
    const r = await fetch('/api/scrape/transfer/' + cb.dataset.sid, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    if (r.ok) ok++;
  }
  toast('✅ ' + ok + ' 条已转存到文件中转站');
}

async function batchDelScrape() {
  const checked = document.querySelectorAll('.scrape-check:checked');
  if (!checked.length) { toast('⚠️ 请先勾选'); return; }
  if (!confirm('确定删除选中的 ' + checked.length + ' 条采集记录？')) return;
  let ok = 0;
  for (const cb of checked) {
    try { await fetch('/api/scrape/session/' + cb.dataset.sid, { method: 'DELETE' }); ok++; } catch {}
  }
  toast('🗑️ ' + ok + ' 条已删除');
  loadScrapeSessions();
}

// ===== 图片展开 =====
async function expandScrapeImages(sid) {
  const modal = document.getElementById('previewModal');
  const body = document.getElementById('previewBody');
  document.getElementById('previewTitle').textContent = '采集图片';
  body.innerHTML = '<div class="file-info"><div class="fi-icon">⏳</div>加载中...</div>';
  modal.classList.add('show');
  try {
    const session = await (await fetch('/api/scrape/session/' + sid)).json();
    const imgs = session.images || [];
    body.innerHTML = '<div style="display:flex;flex-wrap:wrap;gap:.5rem;">' +
      imgs.map(img => {
        const url = '/api/scrape/img/' + sid + '/' + img.name;
        return `<img src="${url}" onclick="window.open('${url}','_blank')" style="width:160px;height:120px;object-fit:cover;border-radius:6px;cursor:pointer;" title="${escHtml(img.name)}">`;
      }).join('') + '</div>';
  } catch(e) { body.innerHTML = '<div class="file-info"><div class="fi-icon">❌</div>加载失败</div>'; }
}

async function expandScrapeTexts(sid) {
  const modal = document.getElementById('previewModal');
  const body = document.getElementById('previewBody');
  document.getElementById('previewTitle').textContent = '采集文本';
  body.innerHTML = '<div class="file-info"><div class="fi-icon">⏳</div>加载中...</div>';
  modal.classList.add('show');
  try {
    const session = await (await fetch('/api/scrape/session/' + sid)).json();
    const txts = session.texts || [];
    let html = '';
    for (const txt of txts) {
      const url = '/api/scrape/text/' + sid + '/' + txt.name;
      try {
        const r = await fetch(url);
        if (r.ok) {
          const text = await r.text();
          html += '<details style="margin-bottom:.3rem;"><summary style="cursor:pointer;font-weight:500;">' + escHtml(txt.name) + '</summary>';
          html += '<pre style="white-space:pre-wrap;word-break:break-word;max-height:300px;overflow:auto;background:var(--bg);padding:.5rem;border-radius:6px;font-size:.8rem;margin-top:.3rem;">' + escHtml(text) + '</pre>';
          html += '</details>';
        }
      } catch {}
    }
    body.innerHTML = html || '<div class="file-info"><div class="fi-icon">📄</div>无文本内容</div>';
  } catch(e) { body.innerHTML = '<div class="file-info"><div class="fi-icon">❌</div>加载失败</div>'; }
}

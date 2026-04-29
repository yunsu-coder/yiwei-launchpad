// server.js - 导航页主服务（路由分发）
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const { getStatus, listFiles, uploadFiles, deleteFile, getFilePath, getFilePreview,
        listNotes, saveNote, getNote, deleteNote, parseMultipart, invalidateSizeCache, MAX_STORAGE } = require('./lib/storage');
const { doScrape, listSessions, getSession, deleteSession, transferSession } = require('./lib/scraper');

// ===== 加载环境变量 =====
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const eq = line.indexOf('=');
    if (eq > 0) process.env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  });
}

const PORT = 3000;
const ROOT = __dirname;

// ===== 工具函数 =====

function sendJSON(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req, maxMemory = Infinity) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let tmpFile = null, tmpStream = null;
    req.on('data', c => {
      total += c.length;
      if (!tmpFile && total > maxMemory) {
        // 超过内存限制，切换到临时文件
        tmpFile = path.join(require('os').tmpdir(), 'upload_' + Date.now());
        tmpStream = fs.createWriteStream(tmpFile);
        for (const prev of chunks) tmpStream.write(prev);
        chunks.length = 0;
      }
      if (tmpStream) tmpStream.write(c);
      else chunks.push(c);
    });
    req.on('end', () => {
      if (tmpStream) {
        tmpStream.end(() => resolve({ path: tmpFile }));
      } else {
        resolve(Buffer.concat(chunks));
      }
    });
    req.on('error', reject);
  });
}

function parseJSON(raw) { try { return JSON.parse(raw.toString()); } catch { return null; } }

// ===== 静态文件 =====

function serveStatic(urlPath, res) {
  const filePath = urlPath === '/' ? '/index.html' : urlPath;
  const fullPath = path.join(ROOT, filePath);
  if (!fullPath.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  const ext = path.extname(fullPath);
  const mime = {
    '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
    '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
    '.md': 'text/markdown',
  };
  fs.readFile(fullPath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': mime[ext] || 'text/plain', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

// ===== 路由 =====

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const m = req.method;

  // --- 状态 ---
  if (p === '/api/status') return sendJSON(res, 200, getStatus());

  // --- 文件 ---
  if (p === '/api/files' && m === 'GET') return sendJSON(res, 200, listFiles());
  if (p === '/api/files' && m === 'POST') {
    const ct = req.headers['content-type'] || '';
    const match = ct.match(/boundary=(.+)/);
    if (!match) return sendJSON(res, 400, { error: 'need multipart' });
    const raw = await readBody(req, 50 * 1024 * 1024); // 超过50MB走磁盘
    let buf;
    // readBody 返回 Buffer 或 {path}
    if (raw.path) { buf = fs.readFileSync(raw.path); fs.unlinkSync(raw.path); }
    else buf = raw;
    const parts = parseMultipart(buf, match[1]);
    const result = uploadFiles(parts, MAX_STORAGE);
    if (result.error) return sendJSON(res, result.error === 'no file' ? 400 : 413, result);
    return sendJSON(res, 200, result);
  }
  if (p.startsWith('/api/files/') && m === 'DELETE') {
    const name = decodeURIComponent(p.slice('/api/files/'.length));
    const result = deleteFile(name);
    if (result.error) return sendJSON(res, 404, result);
    return sendJSON(res, 200, result);
  }
  // 重命名文件
  if (p.startsWith('/api/files/rename/') && m === 'PUT') {
    const name = decodeURIComponent(p.slice('/api/files/rename/'.length));
    const body = parseJSON(await readBody(req));
    if (!body?.newName) return sendJSON(res, 400, { error: 'no new name' });
    const oldPath = getFilePath(name);
    if (!oldPath) return sendJSON(res, 404, { error: 'not found' });
    const newPath = path.join(path.dirname(oldPath), body.newName);
    if (fs.existsSync(newPath)) return sendJSON(res, 409, { error: 'name exists' });
    fs.renameSync(oldPath, newPath);
    return sendJSON(res, 200, { ok: true, name: body.newName });
  }
  if (p.startsWith('/api/dl/')) {
    const name = decodeURIComponent(p.slice('/api/dl/'.length));
    const fp = getFilePath(name);
    if (!fp) { res.writeHead(404); return res.end('404'); }
    const stat = fs.statSync(fp);
    const mimeMap = { '.pdf':'application/pdf','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png',
      '.gif':'image/gif','.webp':'image/webp','.svg':'image/svg+xml','.mp4':'video/mp4','.webm':'video/webm',
      '.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg','.mov':'video/quicktime' };
    res.writeHead(200, {
      'Content-Type': mimeMap[path.extname(name).toLowerCase()] || 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Content-Length': stat.size,
    });
    return fs.createReadStream(fp).pipe(res);
  }

  // 内联预览（支持 Range 请求——视频拖动/PDF 翻页的基础）
  if (p.startsWith('/api/view/')) {
    const name = decodeURIComponent(p.slice('/api/view/'.length));
    const fp = getFilePath(name);
    if (!fp) { res.writeHead(404); return res.end('404'); }
    const ext = path.extname(name).toLowerCase();
    const mimeMap = { '.pdf':'application/pdf','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png',
      '.gif':'image/gif','.webp':'image/webp','.svg':'image/svg+xml','.mp4':'video/mp4','.webm':'video/webm',
      '.mov':'video/quicktime','.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg','.flac':'audio/flac' };
    const stat = fs.statSync(fp);
    const mimeType = mimeMap[ext] || 'application/octet-stream';

    // 支持 Range 请求
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      const chunkSize = (end - start) + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': mimeType,
      });
      return fs.createReadStream(fp, { start, end }).pipe(res);
    }

    res.writeHead(200, {
      'Content-Type': mimeType,
      'Content-Disposition': 'inline',
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
    });
    return fs.createReadStream(fp).pipe(res);
  }

  // M3U 播放列表（点击自动用 VLC/系统播放器打开）
  if (p.startsWith('/api/m3u/')) {
    const name = decodeURIComponent(p.slice('/api/m3u/'.length));
    const fp = getFilePath(name);
    if (!fp) { res.writeHead(404); return res.end('404'); }
    const fileUrl = `https://${req.headers.host}/api/view/${encodeURIComponent(name)}`;
    const m3u = `#EXTM3U\n#EXTINF:-1,${name}\n${fileUrl}\n`;
    res.writeHead(200, {
      'Content-Type': 'audio/x-mpegurl',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}.m3u"`,
      'Content-Length': Buffer.byteLength(m3u),
    });
    return res.end(m3u);
  }

  // 翻译（流式）
  if (p === '/api/translate' && m === 'POST') {
    const body = parseJSON(await readBody(req));
    if (!body?.text) return sendJSON(res, 400, { error: 'no text' });
    const from = body.from || 'auto';
    const to = body.to || 'zh';
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) return sendJSON(res, 500, { error: 'API key not configured' });
    
    // 流式转发
    try {
      const aiResp = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({
          model: 'deepseek-chat',
          stream: true,
          messages: [{
            role: 'system',
            content: `你是一个专业翻译。将用户输入${from === 'auto' ? '' : '从' + from}翻译成${to}。只输出译文，不要解释。`
          }, {
            role: 'user',
            content: body.text.slice(0, 8000)
          }],
          max_tokens: 4000, temperature: 0.1,
        }),
      });
      
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      
      // 把 DeepSeek 的 SSE 流直接转发给客户端
      for await (const chunk of aiResp.body) {
        res.write(chunk);
      }
      res.end();
    } catch(e) {
      sendJSON(res, 500, { error: e.message });
    }
    return;
  }

  // AI 配音 (Edge TTS)
  if (p === '/api/tts' && m === 'POST') {
    const body = parseJSON(await readBody(req));
    if (!body?.text) return sendJSON(res, 400, { error: 'no text' });
    const voice = body.voice || 'zh-CN-XiaoxiaoNeural';
    const { spawn } = require('child_process');
    const os = require('os');
    const tmpFile = path.join(os.tmpdir(), 'tts_' + Date.now() + '.mp3');
    try {
      await new Promise((resolve, reject) => {
        const proc = spawn('python3', ['-c', 'import edge_tts,asyncio,sys\nasync def main():\n tts=edge_tts.Communicate(sys.argv[1],sys.argv[2])\n await tts.save(sys.argv[3])\nasyncio.run(main())', body.text.slice(0, 3000), voice, tmpFile]);
        let err = '';
        proc.stderr.on('data', d => err += d.toString());
        proc.on('close', code => code === 0 ? resolve() : reject(new Error(err.slice(0, 200))));
      });
      const buf = fs.readFileSync(tmpFile);
      fs.unlinkSync(tmpFile);
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': buf.length });
      res.end(buf);
    } catch(e) {
      sendJSON(res, 500, { error: 'TTS failed: ' + e.message });
    }
    return;
  }

  // AI 多模型对话
  if (p === '/api/ai/chat' && m === 'POST') {
    const body = parseJSON(await readBody(req));
    const messages = body?.messages;
    const model = body?.model || 'deepseek-chat';
    if (!messages?.length) return sendJSON(res, 400, { error: 'no messages' });
    
    // 根据模型选择 API
    let apiUrl, apiKey, reqBody;
    
    if (model === 'doubao-pro') {
      apiUrl = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
      apiKey = process.env.DOUBAO_ACCESS_KEY;
      reqBody = { model: 'ep-20250428123456-abcde', messages, stream: true, temperature: body.temperature ?? 0.7 };
    } else if (model === 'qwen-max') {
      apiUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
      apiKey = process.env.QWEN_API_KEY;
      reqBody = { model: 'qwen-max', messages, stream: true, temperature: body.temperature ?? 0.7 };
    } else if (model === 'moonshot-v1') {
      apiUrl = 'https://api.moonshot.cn/v1/chat/completions';
      apiKey = process.env.KIMI_API_KEY;
      reqBody = { model: 'moonshot-v1-8k', messages, stream: true, temperature: body.temperature ?? 0.7 };
    } else if (model === 'doubao') {
      apiUrl = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
      apiKey = 'ark-b02179bf-67a7-4e6e-8350-6fc2763e100a-d58b0';
      reqBody = { model: 'ep-20260428200424-z6vzp', messages, stream: true, temperature: body.temperature ?? 0.7 };
    } else {
      apiUrl = 'https://api.deepseek.com/v1/chat/completions';
      apiKey = process.env.DEEPSEEK_API_KEY;
      reqBody = { model, messages, stream: true, temperature: body.temperature ?? 0.7 };
    }
    
    if (!apiKey) return sendJSON(res, 500, { error: 'API key not configured for ' + model });
    
    try {
      const aiResp = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify(reqBody),
      });
      
      if (!aiResp.ok) {
        const err = await aiResp.text().catch(() => '');
        return sendJSON(res, 502, { error: model + ' API error: ' + aiResp.status + ' ' + err.slice(0, 100) });
      }
      
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      for await (const chunk of aiResp.body) { res.write(chunk); }
      res.end();
    } catch(e) { sendJSON(res, 500, { error: e.message }); }
    return;
  }
  if (p.startsWith('/api/preview/')) {
    const name = decodeURIComponent(p.slice('/api/preview/'.length));
    const preview = getFilePreview(name);
    if (!preview) { res.writeHead(404); return res.end('404'); }
    if (preview.redirect) { res.writeHead(302, { Location: preview.redirect }); return res.end(); }
    if (preview.preview === false) return sendJSON(res, 200, preview);
    res.writeHead(200, { 'Content-Type': preview.type, 'Content-Length': preview.size });
    return res.end(preview.data);
  }

  // --- 笔记 ---
  if (p === '/api/notes' && m === 'GET') return sendJSON(res, 200, listNotes());
  if (p === '/api/notes' && m === 'POST') {
    const body = parseJSON(await readBody(req));
    if (!body || body.title === undefined) return sendJSON(res, 400, { error: 'bad request' });
    return sendJSON(res, 200, saveNote(body));
  }
  if (p.startsWith('/api/notes/') && m === 'GET') {
    const id = p.slice('/api/notes/'.length).replace(/\.json$/, '');
    const note = getNote(id);
    if (!note) return sendJSON(res, 404, { error: 'not found' });
    return sendJSON(res, 200, note);
  }
  if (p.startsWith('/api/notes/') && m === 'DELETE') {
    const id = p.slice('/api/notes/'.length).replace(/\.json$/, '');
    const result = deleteNote(id);
    if (result.error) return sendJSON(res, 404, result);
    return sendJSON(res, 200, result);
  }

  // --- 采集 ---
  if (p === '/api/scrape' && m === 'POST') {
    const body = parseJSON(await readBody(req));
    if (!body || !body.urls || !body.urls.length) return sendJSON(res, 400, { error: '请输入至少一个网址' });
    const type = body.type || 'both';
    if (!['text', 'images', 'both', 'video', 'music'].includes(type)) return sendJSON(res, 400, { error: 'type 只能是 text/images/both/video/music' });
    try {
      const result = await doScrape(body.urls, type, { minWidth: body.minWidth || 0, minHeight: body.minHeight || 0, followDetail: body.followDetail !== false, deepRender: body.deepRender !== false });
      return sendJSON(res, 200, result);
    } catch (e) {
      return sendJSON(res, 500, { error: e.message });
    }
  }
  if (p === '/api/scrape/list' && m === 'GET') return sendJSON(res, 200, listSessions());
  if (p.startsWith('/api/scrape/session/') && m === 'GET') {
    const sid = p.slice('/api/scrape/session/'.length);
    const session = getSession(sid);
    if (!session) return sendJSON(res, 404, { error: 'not found' });
    return sendJSON(res, 200, session);
  }
  if (p.startsWith('/api/scrape/session/') && m === 'DELETE') {
    deleteSession(p.slice('/api/scrape/session/'.length));
    return sendJSON(res, 200, { ok: true });
  }
  if (p.startsWith('/api/scrape/transfer/') && m === 'POST') {
    const sid = p.slice('/api/scrape/transfer/'.length);
    const body = parseJSON(await readBody(req));
    const transferred = transferSession(sid, body?.items || []);
    if (transferred.length) invalidateSizeCache();
    return sendJSON(res, 200, { ok: true, transferred });
  }
  // --- 壁纸专用：自动压缩大图 ---
  if (p.startsWith('/api/wallpaper/')) {
    const fname = decodeURIComponent(p.slice('/api/wallpaper/'.length));
    const fpath = getFilePath(fname);
    if (!fpath) { res.writeHead(404); return res.end('404'); }
    try {
      const sharp = require('sharp');
      const ext = path.extname(fname).toLowerCase();
      // 只处理光栅图片，SVG 直接返回
      if (ext === '.svg') {
        const buf = fs.readFileSync(fpath);
        res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Content-Length': buf.length, 'Cache-Control': 'max-age=86400' });
        return res.end(buf);
      }
      // 用 sharp 读取 metadata 判断是否需要压缩
      const meta = await sharp(fpath).metadata();
      const needResize = (meta.width || 9999) > 2560 || (meta.height || 9999) > 1600;
      const needCompress = (meta.format === 'png' && (fs.statSync(fpath).size > 500000));
      if (!needResize && !needCompress) {
        // 图片不大，直接返回
        const buf = fs.readFileSync(fpath);
        const mimes = { '.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.gif':'image/gif','.webp':'image/webp' };
        res.writeHead(200, { 'Content-Type': mimes[ext]||'image/jpeg', 'Content-Length': buf.length, 'Cache-Control': 'max-age=86400' });
        return res.end(buf);
      }
      // 压缩：缩放到 2560px 以内，PNG 转 JPEG
      const pipeline = sharp(fpath).resize(2560, 1600, { fit: 'inside', withoutEnlargement: true });
      const outBuf = needCompress ? await pipeline.jpeg({ quality: 85, progressive: true }).toBuffer()
        : await pipeline.toBuffer();
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': outBuf.length,
        'Cache-Control': 'max-age=86400' });
      return res.end(outBuf);
    } catch {
      // sharp 失败时返回原图
      const buf = fs.readFileSync(fpath);
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': buf.length, 'Cache-Control': 'max-age=3600' });
      return res.end(buf);
    }
  }

  // --- 采集缩略图 ---
  if (p.startsWith('/api/scrape/thumb/')) {
    const rest = p.slice('/api/scrape/thumb/'.length);
    const [sid, ...nameParts] = rest.split('/');
    const imgPath = path.join(ROOT, 'scrape', sid, 'images', nameParts.join('/'));
    if (!fs.existsSync(imgPath)) { res.writeHead(404); return res.end('404'); }
    try {
      const sharp = require('sharp');
      const buf = await sharp(imgPath).resize(200, 150, { fit: 'inside' }).jpeg({ quality: 70 }).toBuffer();
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': buf.length,
        'Cache-Control': 'public, max-age=86400' });
      return res.end(buf);
    } catch { res.writeHead(500); return res.end('thumb error'); }
  }

  // --- 采集文本读取 ---
  if (p.startsWith('/api/scrape/text/')) {
    const rest = p.slice('/api/scrape/text/'.length);
    const slashIdx = rest.indexOf('/');
    if (slashIdx === -1) { res.writeHead(404); return res.end('404'); }
    const sid = rest.slice(0, slashIdx);
    const fname = rest.slice(slashIdx + 1);
    const fpath = path.join(ROOT, 'scrape', sid, fname);
    if (!fs.existsSync(fpath)) { res.writeHead(404); return res.end('404'); }
    const text = fs.readFileSync(fpath, 'utf8').slice(0, 30000);
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(text) });
    return res.end(text);
  }

  // --- 采集图片 ---
  if (p.startsWith('/api/scrape/img/')) {
    const rest = p.slice('/api/scrape/img/'.length);
    const [sid, ...nameParts] = rest.split('/');
    const imgPath = path.join(ROOT, 'scrape', sid, 'images', nameParts.join('/'));
    if (!fs.existsSync(imgPath)) { res.writeHead(404); return res.end('404'); }
    const ext = path.extname(imgPath).toLowerCase();
    const mimes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
    const buf = fs.readFileSync(imgPath);
    res.writeHead(200, { 'Content-Type': mimes[ext] || 'image/png',
      'Content-Length': buf.length, 'Cache-Control': 'max-age=3600' });
    return res.end(buf);
  }

  // --- 静态文件 ---
  // 允许加载 node_modules 中的库
  if (p.startsWith('/lib/')) {
    const libPath = path.join(ROOT, 'node_modules', p.slice(5));
    if (!libPath.startsWith(path.join(ROOT, 'node_modules'))) { res.writeHead(403); return res.end(); }
    if (!fs.existsSync(libPath)) { res.writeHead(404); return res.end('404'); }
    const ext = path.extname(libPath).toLowerCase();
    const mime = { '.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.map':'application/json' };
    res.writeHead(200, { 'Content-Type': mime[ext]||'text/plain', 'Cache-Control': 'public, max-age=86400' });
    return fs.createReadStream(libPath).pipe(res);
  }
  
  serveStatic(p, res);
});

server.listen(PORT, '127.0.0.1', () => console.log(`📌 导航页已启动: http://127.0.0.1:${PORT}`));

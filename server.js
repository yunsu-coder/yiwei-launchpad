// server.js - 导航页主服务（路由分发）
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const { getStatus, listFiles, uploadFiles, deleteFile, getFilePath, getFilePreview,
        listNotes, saveNote, getNote, deleteNote, parseMultipart, MAX_STORAGE } = require('./lib/storage');
const { doScrape, listSessions, getSession, deleteSession, transferSession } = require('./lib/scraper');

const PORT = 3000;
const ROOT = __dirname;

// ===== 工具函数 =====

function sendJSON(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
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
    const parts = parseMultipart(await readBody(req), match[1]);
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
    if (!['text', 'images', 'both'].includes(type)) return sendJSON(res, 400, { error: 'type 只能是 text/images/both' });
    try {
      const result = await doScrape(body.urls, type);
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
    return sendJSON(res, 200, { ok: true, transferred });
  }
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

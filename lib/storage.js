// lib/storage.js - 文件 & 笔记存储
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const FILES_DIR = path.join(__dirname, '..', 'files');
const NOTES_DIR = path.join(__dirname, '..', 'notes');
const MAX_STORAGE = 20 * 1024 * 1024 * 1024; // 20GB

[FILES_DIR, NOTES_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// ===== 存储用量 =====

function dirSize(dir) {
  let size = 0;
  try {
    for (const f of fs.readdirSync(dir)) {
      const s = fs.statSync(path.join(dir, f));
      size += s.isDirectory() ? dirSize(path.join(dir, f)) : s.size;
    }
  } catch {}
  return size;
}

function fmtSize(sz) {
  if (sz < 1024) return sz + 'B';
  if (sz < 1024 * 1024) return (sz / 1024).toFixed(1) + 'K';
  if (sz < 1024 * 1024 * 1024) return (sz / 1024 / 1024).toFixed(1) + 'M';
  return (sz / 1024 / 1024 / 1024).toFixed(2) + 'G';
}

function getStatus() {
  const total = os.totalmem(), free = os.freemem(), used = total - free;
  const pct = Math.round((used / total) * 100);
  let uptime = '';
  const u = os.uptime();
  const d = Math.floor(u / 86400), h = Math.floor((u % 86400) / 3600), m = Math.floor((u % 3600) / 60);
  if (d > 0) uptime += d + '天';
  uptime += h + '时' + m + '分';
  const usedStorage = dirSize(FILES_DIR);
  return {
    mem_used: fmtSize(used), mem_total: fmtSize(total), mem_pct: pct,
    cpu: os.loadavg()[0].toFixed(1), disk_free: '41G', uptime,
    storage_used: usedStorage, storage_max: MAX_STORAGE,
    storage_pct: Math.max(Math.round((usedStorage / MAX_STORAGE) * 1000) / 10, usedStorage > 0 ? 0.1 : 0),
    storage_used_h: fmtSize(usedStorage), storage_max_h: '20G',
  };
}

// ===== 文件操作 =====

function listFiles() {
  return fs.readdirSync(FILES_DIR).map(name => {
    const stat = fs.statSync(path.join(FILES_DIR, name));
    return { name, size: stat.size, mtime: stat.mtime.toISOString() };
  }).sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
}

function uploadFiles(parts, maxSize) {
  const fileParts = parts.filter(p => p.filename);
  if (!fileParts.length) return { error: 'no file' };
  let totalNew = 0;
  for (const fp of fileParts) totalNew += fp.data.length;
  const current = dirSize(FILES_DIR);
  if (current + totalNew > maxSize) {
    return { error: `空间不足！剩余 ${((maxSize - current) / 1024 / 1024 / 1024).toFixed(1)}GB` };
  }
  const results = [];
  for (const fp of fileParts) {
    let finalName = safeName(fp.filename || 'unnamed');
    const ext = path.extname(finalName), base = path.basename(finalName, ext);
    let counter = 1;
    while (fs.existsSync(path.join(FILES_DIR, finalName)))
      finalName = base + '_' + (counter++) + ext;
    fs.writeFileSync(path.join(FILES_DIR, finalName), fp.data);
    results.push({ name: finalName, size: fp.data.length });
  }
  return { uploaded: results };
}

function deleteFile(name) {
  const fp = path.join(FILES_DIR, name);
  if (!fs.existsSync(fp)) return { error: 'not found' };
  fs.unlinkSync(fp);
  return { ok: true };
}

function getFilePath(name) {
  const fp = path.join(FILES_DIR, name);
  if (!fs.existsSync(fp)) return null;
  return fp;
}

function getFilePreview(name) {
  const fp = path.join(FILES_DIR, name);
  if (!fs.existsSync(fp)) return null;
  const ext = path.extname(name).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico', '.bmp'].includes(ext)) {
    return { redirect: '/api/dl/' + encodeURIComponent(name) };
  }
  const textExts = { '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json',
    '.csv': 'text/csv', '.log': 'text/plain', '.html': 'text/html', '.css': 'text/css',
    '.js': 'text/javascript', '.xml': 'text/xml' };
  const stat = fs.statSync(fp);
  const isText = ext in textExts || !['.pdf', '.doc', '.docx', '.zip', '.tar', '.gz', '.rar', '.7z',
    '.mp4', '.mp3', '.mov', '.avi', '.exe', '.bin'].includes(ext);
  if (!isText) return { preview: false, size: stat.size, mtime: stat.mtime.toISOString() };
  return { type: textExts[ext] || 'text/plain', data: fs.readFileSync(fp), size: stat.size };
}

// ===== 笔记操作 =====

function listNotes() {
  return fs.readdirSync(NOTES_DIR).filter(f => f.endsWith('.json')).map(f => {
    const raw = JSON.parse(fs.readFileSync(path.join(NOTES_DIR, f), 'utf8'));
    return { id: raw.id, title: raw.title, updated: raw.updated, preview: (raw.content || '').slice(0, 80) };
  }).sort((a, b) => new Date(b.updated) - new Date(a.updated));
}

function saveNote(body) {
  const id = body.id || crypto.randomBytes(8).toString('hex');
  const note = {
    id, title: body.title, content: body.content || '',
    created: body.created || new Date().toISOString(),
    updated: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(NOTES_DIR, id + '.json'), JSON.stringify(note, null, 2));
  return { id, updated: note.updated };
}

function getNote(id) {
  const fp = path.join(NOTES_DIR, id + '.json');
  if (!fs.existsSync(fp)) return null;
  return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

function deleteNote(id) {
  const fp = path.join(NOTES_DIR, id + '.json');
  if (!fs.existsSync(fp)) return { error: 'not found' };
  fs.unlinkSync(fp);
  return { ok: true };
}

// ===== 辅助 =====

function safeName(name) {
  return name.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]/g, '_');
}

function parseMultipart(buf, boundary) {
  const b = '--' + boundary;
  const parts = [];
  let idx = buf.indexOf(b);
  while (idx !== -1) {
    const end = buf.indexOf(b, idx + b.length);
    if (end === -1) break;
    const part = buf.slice(idx + b.length, end);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const headers = part.slice(0, headerEnd).toString();
      const nameMatch = headers.match(/name="([^"]+)"/);
      const fileMatch = headers.match(/filename="([^"]+)"/);
      if (nameMatch) {
        parts.push({
          name: nameMatch[1],
          filename: fileMatch ? fileMatch[1] : null,
          data: fileMatch ? part.slice(headerEnd + 4, part.length - 2) : part.slice(headerEnd + 4, part.length - 2).toString(),
        });
      }
    }
    idx = buf.indexOf(b, end > idx ? end : idx + 1);
  }
  return parts;
}

module.exports = {
  getStatus, listFiles, uploadFiles, deleteFile, getFilePath, getFilePreview,
  listNotes, saveNote, getNote, deleteNote,
  parseMultipart, safeName, dirSize, MAX_STORAGE,
  FILES_DIR, NOTES_DIR,
};

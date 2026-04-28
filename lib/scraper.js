// lib/scraper.js - 网页采集引擎（HTTP 抓取 + 浏览器渲染 + 截图 PDF）
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const cheerio = require('cheerio');
const { getBrowser, resetBrowserTimer } = require('./browser');
const { loadFontMap, decodeText } = require('./font');

const SCRAPE_DIR = path.join(__dirname, '..', 'scrape');
const FILES_DIR = path.join(__dirname, '..', 'files');

// ===== HTTP 抓取 =====

function fetchUrl(urlStr, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'https:' ? https : http;
    const opts = {
      timeout,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Referer': 'https://www.baidu.com/',
      },
    };
    const req = mod.get(urlStr, opts, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        return fetchUrl(new URL(res.headers.location, urlStr).href, timeout).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('连接超时')); });
    req.on('error', reject);
  });
}

function downloadImage(urlStr, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.get(urlStr, {
      timeout,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Baiduspider/2.0)',
        'Referer': 'https://pic.netbian.com/',
      },
    }, res => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (buf.length < 100) return reject(new Error('无效图片'));
        resolve(buf);
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('下载超时')); });
    req.on('error', reject);
  });
}

// ===== 浏览器级抓取 =====

async function fetchWithBrowser(urlStr) {
  const b = await getBrowser();
  resetBrowserTimer();
  const page = await b.newPage();
  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' });
    await page.setViewport({ width: 1920, height: 1080 });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      window.chrome = { runtime: {} };
    });
    await page.goto(urlStr, { waitUntil: 'networkidle2', timeout: 25000 });
    await new Promise(r => setTimeout(r, 3000));
    return Buffer.from(await page.content());
  } finally {
    await page.close();
  }
}

// ===== 截图模式 =====

async function screenshotPage(urlStr, sessionDir) {
  const b = await getBrowser();
  resetBrowserTimer();
  const page = await b.newPage();
  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    await page.setViewport({ width: 780, height: 1200 });
    await page.goto(urlStr, { waitUntil: 'networkidle2', timeout: 25000 });
    await page.evaluate(() => document.fonts.ready);
    await new Promise(r => setTimeout(r, 3000));

    const title = await page.title();

    // 展开所有容器让内容流入文档流
    await page.evaluate(() => {
      document.querySelectorAll('*').forEach(el => {
        const st = getComputedStyle(el);
        if (/hidden|scroll|auto/.test(st.overflow + st.overflowY)) {
          el.style.setProperty('overflow', 'visible', 'important');
          el.style.setProperty('overflow-y', 'visible', 'important');
        }
        if (st.height !== 'auto' && !st.height.includes('%'))
          el.style.setProperty('height', 'auto', 'important');
        if (st.maxHeight !== 'none')
          el.style.setProperty('max-height', 'none', 'important');
        if (st.position === 'fixed' || st.position === 'sticky')
          el.style.setProperty('position', 'static', 'important');
      });
      document.body.style.setProperty('height', 'auto', 'important');
      document.body.style.setProperty('overflow', 'visible', 'important');
      document.documentElement.style.setProperty('height', 'auto', 'important');
      document.documentElement.style.setProperty('overflow', 'visible', 'important');
    });
    await new Promise(r => setTimeout(r, 1000));

    const results = [];
    const pngName = 'screenshot.png';
    const pngPath = path.join(sessionDir, pngName);
    await page.screenshot({ path: pngPath, fullPage: true, type: 'png' });
    results.push({ name: pngName, title, size: fs.statSync(pngPath).size, type: 'png' });

    const pdfName = 'screenshot.pdf';
    const pdfPath = path.join(sessionDir, pdfName);
    await page.pdf({ path: pdfPath, format: 'A4', printBackground: true,
      margin: { top: '20px', bottom: '20px', left: '25px', right: '25px' } });
    results.push({ name: pdfName, title, size: fs.statSync(pdfPath).size, type: 'pdf' });

    return { title, results };
  } finally {
    await page.close();
  }
}

// ===== 主采集函数 =====

async function doScrape(urls, type) {
  const sessionId = Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex');
  const sessionDir = path.join(SCRAPE_DIR, sessionId);
  const imgDir = path.join(sessionDir, 'images');
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(imgDir, { recursive: true });

  const result = {
    sessionId, url: urls[0], urlCount: urls.length, type,
    title: '', images: [], texts: [], errors: [],
    imageCount: 0, textCount: 0, errorCount: 0,
    time: new Date().toISOString(),
  };

  for (const url of urls) {
    try {
      // ---------- 获取 HTML ----------
      const isFanqie = url.includes('fanqienovel.com');
      let htmlBuf;
      if (isFanqie) {
        htmlBuf = await fetchWithBrowser(url);
      } else {
        try { htmlBuf = await fetchUrl(url, 8000); }
        catch (e) { htmlBuf = await fetchWithBrowser(url); }
      }
      const html = htmlBuf.toString();
      const $ = cheerio.load(html);
      if (!result.title) result.title = $('title').text().trim() || url;

      // ---------- 文本提取 ----------
      if (type === 'text' || type === 'both') {
        let text = '';
        const sel = ['article', 'main', '[role="main"]', '.content', '.post-content',
          '.article-content', '.markdown-body', '.post-body', '#content',
          '[class*="reader-content"]', '.muye-reader-content'];
        for (const s of sel) { const el = $(s); if (el.length) { text = el.text().trim(); break; } }
        if (!text) text = $('body').text().trim();
        if (/[\uE000-\uF8FF]/.test(text)) {
          const fontMap = loadFontMap();
          if (Object.keys(fontMap).length > 0) text = decodeText(text, fontMap);
        }
        text = text.replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').slice(0, 500000);
        const txtName = 'text_' + safeName(result.title.slice(0, 30)).replace(/_+/g, '_') + '.txt';
        fs.writeFileSync(path.join(sessionDir, txtName), text);
        result.texts.push({ name: txtName, title: result.title, size: Buffer.byteLength(text), url });
        result.textCount++;
      }

      // ---------- 图片提取 ----------
      if (type === 'images' || type === 'both') {
        const imgUrls = [];
        $('img').each((i, el) => {
          if (imgUrls.length >= 100) return false;
          const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-original');
          if (src) { try { imgUrls.push(new URL(src, url).href); } catch {} }
        });

        const CONCURRENCY = 5;
        const globalBase = result.images.length;
        let downloaded = 0;

        for (let i = 0; i < imgUrls.length; i += CONCURRENCY) {
          const batch = imgUrls.slice(i, i + CONCURRENCY);
          const batchResults = await Promise.allSettled(
            batch.map(async (imgUrl, bi) => {
              try {
                const ext = (path.extname(new URL(imgUrl).pathname).split('?')[0] || '.jpg').toLowerCase();
                if (!['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'].includes(ext.slice(0, 5))) return null;
                const buf = await downloadImage(imgUrl, 8000);
                const idx = globalBase + i + bi + 1;
                const imgName = `img_${String(idx).padStart(4, '0')}${ext.slice(0, 5)}`;
                fs.writeFileSync(path.join(imgDir, imgName), buf);
                return { name: imgName, url: imgUrl, size: buf.length };
              } catch { return null; }
            })
          );
          for (const r of batchResults) {
            if (r.status === 'fulfilled' && r.value) { result.images.push(r.value); downloaded++; }
          }
        }
        result.imageCount += downloaded;
      }
    } catch (e) {
      result.errors.push({ url, error: e.message });
      result.errorCount++;
    }
  }

  fs.writeFileSync(path.join(sessionDir, 'meta.json'), JSON.stringify(result.images, null, 2));
  fs.writeFileSync(path.join(sessionDir, 'result.json'), JSON.stringify(result, null, 2));
  return result;
}

// ===== 辅助 =====

function safeName(name) {
  return name.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]/g, '_');
}

// ===== 采集历史 =====

function listSessions() {
  const sessions = [];
  if (fs.existsSync(SCRAPE_DIR)) {
    for (const dir of fs.readdirSync(SCRAPE_DIR)) {
      const rp = path.join(SCRAPE_DIR, dir, 'result.json');
      if (fs.existsSync(rp)) {
        try { sessions.push(JSON.parse(fs.readFileSync(rp, 'utf8'))); } catch {}
      }
    }
    sessions.sort((a, b) => new Date(b.time) - new Date(a.time));
  }
  return sessions;
}

function getSession(sid) {
  const rp = path.join(SCRAPE_DIR, sid, 'result.json');
  if (!fs.existsSync(rp)) return null;
  return JSON.parse(fs.readFileSync(rp, 'utf8'));
}

function deleteSession(sid) {
  const sp = path.join(SCRAPE_DIR, sid);
  if (fs.existsSync(sp)) fs.rmSync(sp, { recursive: true });
}

function transferSession(sid, items) {
  const sessionDir = path.join(SCRAPE_DIR, sid);
  if (!fs.existsSync(sessionDir)) return [];
  const imgDir = path.join(sessionDir, 'images');
  const transferred = [];

  if (fs.existsSync(imgDir)) {
    for (const img of fs.readdirSync(imgDir)) {
      if (items && items.length && !items.includes(img)) continue;
      let dest = path.join(FILES_DIR, img);
      let counter = 1;
      while (fs.existsSync(dest)) {
        const ext = path.extname(img), base = path.basename(img, ext);
        dest = path.join(FILES_DIR, base + '_' + (counter++) + ext);
      }
      fs.copyFileSync(path.join(imgDir, img), dest);
      transferred.push(img);
    }
  }

  for (const f of fs.readdirSync(sessionDir)) {
    if (f.startsWith('.') || ['result.json', 'meta.json', 'images'].includes(f)) continue;
    const fp = path.join(sessionDir, f);
    if (fs.statSync(fp).isDirectory()) continue;
    if (items && items.length && !items.includes(f)) continue;
    let dest = path.join(FILES_DIR, f);
    let counter = 1;
    while (fs.existsSync(dest)) {
      const ext = path.extname(f), base = path.basename(f, ext);
      dest = path.join(FILES_DIR, base + '_' + (counter++) + ext);
    }
    fs.copyFileSync(fp, dest);
    transferred.push(f);
  }
  return transferred;
}

module.exports = {
  doScrape, listSessions, getSession, deleteSession, transferSession,
  fetchUrl, downloadImage, safeName,
};

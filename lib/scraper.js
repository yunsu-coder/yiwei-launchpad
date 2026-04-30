// lib/scraper.js - 网页采集引擎（HTTP 抓取 + 浏览器渲染 + 截图 PDF）
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { URL } = require('url');
const cheerio = require('cheerio');
const sharp = require('sharp');
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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
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

function downloadImage(urlStr, timeout = 8000, referer = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'https:' ? https : http;
    const ref = referer || `${u.protocol}//${u.host}/`;
    const req = mod.get(urlStr, {
      timeout,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'identity',  // 不让服务器压缩，避免 gzip 问题
        'Referer': ref,
      },
    }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        return downloadImage(new URL(res.headers.location, urlStr).href, timeout, referer).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      const encoding = res.headers['content-encoding'];
      const stream = encoding === 'gzip' ? res.pipe(zlib.createGunzip())
        : encoding === 'deflate' ? res.pipe(zlib.createInflate())
        : encoding === 'br' ? res.pipe(zlib.createBrotliDecompress())
        : res;
      stream.on('data', c => chunks.push(c));
      stream.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (buf.length < 100) return reject(new Error('无效图片'));
        resolve(buf);
      });
      stream.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('下载超时')); });
    req.on('error', reject);
  });
}



// ===== Internet Archive 音频抓取 =====

async function scrapeArchiveOrg(urlStr, searchQuery) {
  // 支持搜索和详情页
  let ids = [];
  
  // 详情页: archive.org/details/IDENTIFIER
  const detailMatch = urlStr.match(/archive\.org\/details\/([^\/\?#]+)/);
  if (detailMatch) {
    ids.push(detailMatch[1]);
  }
  
  // 搜索页: archive.org/search?query=... 或直接搜
  if (!ids.length && searchQuery) {
    const searchUrl = 'https://archive.org/advancedsearch.php?q=' + encodeURIComponent(searchQuery + ' mediatype:audio') + '&fl[]=identifier,title&rows=10&output=json';
    const searchRes = await fetchUrl(searchUrl, 10000);
    const searchData = JSON.parse(searchRes.toString());
    ids = (searchData.response?.docs || []).map(d => d.identifier);
  }
  
  if (!ids.length) return null;
  
  const results = [];
  for (const id of ids.slice(0, 10)) {
    try {
      const metaRes = await fetchUrl('https://archive.org/metadata/' + id, 10000);
      const meta = JSON.parse(metaRes.toString());
      const mp3s = (meta.files || []).filter(f => f.name && /\.(mp3|wav|ogg|flac)$/i.test(f.name) && (f.size || 9999) > 50000);
      for (const f of mp3s.slice(0, 3)) {
        const dlUrl = 'https://archive.org/download/' + id + '/' + encodeURIComponent(f.name);
        results.push({ name: safeName(f.name).slice(0,60), url: dlUrl, size: f.size || 0 });
      }
    } catch {}
  }
  return results;
}

// ===== B站视频抓取 =====

async function scrapeBilibili(urlStr) {
  const bvidMatch = urlStr.match(/BV[a-zA-Z0-9]{10}/);
  if (!bvidMatch) return null;
  const bvid = bvidMatch[0];

  // B站 API 需要 Referer
  const apiHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131',
    'Referer': 'https://www.bilibili.com/',
  };

  const https = require('https');
  function apiGet(url) {
    return new Promise((resolve, reject) => {
      https.get(url, { headers: apiHeaders, timeout: 10000 }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('超时')); });
    });
  }

  // 1. 获取视频信息
  const infoRes = await apiGet('https://api.bilibili.com/x/web-interface/view?bvid=' + bvid);
  const info = JSON.parse(infoRes.toString());
  if (info.code !== 0) throw new Error('B站API错误: ' + (info.message || ''));
  
  const v = info.data;
  const cid = v.cid;
  const title = safeName(v.title.slice(0, 50));
  
  // 2. 获取播放地址
  const playRes = await apiGet(
    'https://api.bilibili.com/x/player/playurl?bvid=' + bvid + '&cid=' + cid + '&qn=80&fnval=1&fourk=1'
  );
  const play = JSON.parse(playRes.toString());
  if (play.code !== 0) throw new Error('播放地址获取失败');
  
  const durl = play.data.durl;
  if (!durl || !durl.length) return null;
  
  const results = [];
  for (let i = 0; i < durl.length; i++) {
    const seg = durl[i];
    // 加上 Referer 和 Range 头
    const buf = await new Promise((resolve, reject) => {
      const http = require('https');
      const u = new URL(seg.url);
      http.get(seg.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131',
          'Referer': 'https://www.bilibili.com/',
          'Range': 'bytes=0-' + (seg.size - 1),
        },
        timeout: 60000,
      }, res => {
        if (res.statusCode >= 400) return reject(new Error('HTTP ' + res.statusCode));
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }).on('error', reject);
    });
    
    const ext = '.mp4';
    const name = 'vid_' + title.slice(0, 30).replace(/_+/g,'_') + (durl.length > 1 ? '_p' + (i+1) : '') + ext;
    results.push({ name, url: seg.url, size: buf.length, buf });
  }
  return { results, title: v.title };
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
    // 滚动页面触发懒加载
    await page.evaluate(async () => {
      for (let i = 0; i < 5; i++) {
        window.scrollBy(0, window.innerHeight);
        await new Promise(r => setTimeout(r, 500));
      }
      window.scrollTo(0, 0);
    });
    await new Promise(r => setTimeout(r, 2000));
    return Buffer.from(await page.content());
  } finally {
    await page.close();
  }
}


// ===== 网络拦截式媒体抓取（深度模式）=====

async function captureMediaWithBrowser(urlStr, sessionDir) {
  const b = await getBrowser();
  resetBrowserTimer();
  const page = await b.newPage();
  const captured = [];
  try {
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
    await page.setViewport({ width: 1920, height: 1080 });
    
    // 拦截所有响应，捕获音频
    page.on("response", async (resp) => {
      const url = resp.url();
      const ct = resp.headers()["content-type"] || "";
      const cl = parseInt(resp.headers()["content-length"] || "0");
      if ((ct.includes("audio") || /\.(mp3|wav|ogg|flac|aac|m4a)(\?|$)/i.test(url)) && cl > 10000) {
        try {
          const buf = await resp.buffer();
          if (buf.length > 10000) {
            const ext = (url.split("?")[0].match(/\.(\w{3,4})$/)?.[1] || "mp3").slice(0,5);
            captured.push({ url, buf, ext, size: buf.length });
          }
        } catch {}
      }
    });
    
    await page.goto(urlStr, { waitUntil: "networkidle2", timeout: 25000 });
    // 滚动触发懒加载
    await page.evaluate(async () => {
      for (let i = 0; i < 3; i++) {
        window.scrollBy(0, window.innerHeight);
        await new Promise(r => setTimeout(r, 800));
      }
      window.scrollTo(0, 0);
    });
    await new Promise(r => setTimeout(r, 3000));
    
    // 尝试点击播放按钮触发加载
    await page.evaluate(() => {
      const btns = document.querySelectorAll('[class*="play"], [class*="Play"], [aria-label*="play" i], [aria-label*="Play" i], button:has([class*="play"])');
      btns.forEach(b => b.click());
    });
    await new Promise(r => setTimeout(r, 3000));
    
    // 保存到磁盘
    const results = [];
    for (let i = 0; i < captured.length; i++) {
      const c = captured[i];
      const name = `mus_${String(i + 1).padStart(4, "0")}.${c.ext}`;
      fs.writeFileSync(path.join(sessionDir, "images", name), c.buf);
      results.push({ name, url: c.url, size: c.size });
    }
    return results;
  } finally {
    await page.close();
  }
}

// ===== 跟踪详情页抓大图 =====

async function scrapeDetailPage(detailUrl, pageUrl) {
  let html, fromBrowser = false;
  try { html = (await fetchUrl(detailUrl, 8000)).toString(); }
  catch { return null; }

  // 尝试从静态 HTML 提取
  let best = await extractImagesFromHtml(html, detailUrl, pageUrl);

  // 静态 HTML 没找到大图 → 用浏览器渲染 SPA 页面
  if (!best || (best.meta && best.meta.width < 1200)) {
    try {
      const browserHtml = (await fetchWithBrowser(detailUrl)).toString();
      const browserBest = await extractImagesFromHtml(browserHtml, detailUrl, pageUrl);
      if (browserBest) {
        if (!best || (browserBest.meta.width || 0) > (best.meta.width || 0)) {
          best = browserBest;
          fromBrowser = true;
        }
      }
    } catch {}
  }

  // 还是没找到 → Puppeteer 高 DPI 截图兜底
  if (!best) {
    try {
      best = await screenshotDetailPage(detailUrl);
    } catch {}
  }

  return best;
}

async function extractImagesFromHtml(html, detailUrl, pageUrl) {
  const $ = cheerio.load(html);
  const candidates = [];

  // 找所有 img，收集高分辨率候选
  $('img').each((i, el) => {
    const $el = $(el);
    let src = $el.attr('data-original') || $el.attr('data-src') ||
              $el.attr('data-full') || $el.attr('data-hires') ||
              $el.attr('data-large') || $el.attr('src');
    if (!src) return;
    try { candidates.push(new URL(src, detailUrl).href); } catch {}
  });

  // 也找直接链接到图片的 <a>
  $('a').each((i, el) => {
    const href = $(el).attr('href');
    if (href && /\.(jpg|jpeg|png|gif|webp|bmp)(\?|$)/i.test(href)) {
      try { candidates.push(new URL(href, detailUrl).href); } catch {}
    }
  });

  if (!candidates.length) return null;

  // 去重 + 过滤明显缩略图 URL
  const unique = [...new Set(candidates)].filter(u => {
    const lower = u.toLowerCase();
    return !lower.includes('getcroppingimg') && !lower.includes('_256.') && !lower.includes('-150x150');
  });

  // 下载并比较，取最大的
  let best = null, bestSize = 0;
  const toCheck = unique.slice(0, 15);

  for (const imgUrl of toCheck) {
    try {
      const buf = await downloadImage(imgUrl, 8000, pageUrl);
      if (buf.length < 10240) continue; // <10KB 跳过
      const meta = await sharp(buf).metadata();
      const pixels = (meta.width || 0) * (meta.height || 0);
      if (pixels > bestSize) { best = { url: imgUrl, buf, meta }; bestSize = pixels; }
    } catch {}
  }
  return best;
}

// Puppeteer 截图兜底（SPA 站无直接图片链接时用）
async function screenshotDetailPage(detailUrl) {
  const b = await getBrowser();
  resetBrowserTimer();
  const page = await b.newPage();
  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    // 2x DPI + 大视口 = 高分辨率截图
    await page.setViewport({ width: 1920, height: 1200, deviceScaleFactor: 2 });
    await page.goto(detailUrl, { waitUntil: 'networkidle2', timeout: 25000 });
    await new Promise(r => setTimeout(r, 4000));

    // 找到页面上最大的可见图片元素
    const imgInfo = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'))
        .filter(el => el.naturalWidth > 400 && el.clientWidth > 400);
      if (!imgs.length) return null;
      imgs.sort((a, b) => (b.naturalWidth * b.naturalHeight) - (a.naturalWidth * a.naturalHeight));
      const el = imgs[0];
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, w: rect.width, h: rect.height, nw: el.naturalWidth, nh: el.naturalHeight };
    });

    if (imgInfo && imgInfo.w > 400) {
      const buf = await page.screenshot({
        clip: { x: imgInfo.x, y: imgInfo.y, width: imgInfo.w, height: imgInfo.h },
        type: 'png',
      });
      if (buf.length > 20000) {
        const meta = await sharp(buf).metadata();
        return { url: detailUrl, buf, meta };
      }
    }
    return null;
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

async function doScrape(urls, type, opts = {}) {
  // URL 去重：检查是否已经采集过
  const existingSessions = listSessions();
  const alreadyScraped = urls.filter(url =>
    existingSessions.some(s => s.url === url || (s.urls && s.urls.includes(url)))
  );
  if (alreadyScraped.length && !opts.force) {
    // 过滤掉已采集的 URL
    const newUrls = urls.filter(url => !alreadyScraped.includes(url));
    if (!newUrls.length) {
      // 全部重复，但仍允许强制重采
      if (opts.skipDup) {
        return {
          sessionId: 'dup_skipped', url: urls[0], urlCount: urls.length, type,
          title: '已全部采集过', images: [], texts: [], errors: [],
          imageCount: 0, textCount: 0, errorCount: 0,
          skippedLowRes: 0, detailFollowed: 0, dedupSkipped: alreadyScraped.length,
          time: new Date().toISOString(),
        };
      }
    } else {
      urls = newUrls;
    }
  }

  const sessionId = Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex');
  const sessionDir = path.join(SCRAPE_DIR, sessionId);
  const imgDir = path.join(sessionDir, 'images');
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(imgDir, { recursive: true });

  const minWidth = opts.minWidth || 0;
  const minHeight = opts.minHeight || 0;
  const followDetail = opts.followDetail !== false;
  const deepRender = opts.deepRender !== false; // 默认开启深度渲染

  const result = {
    sessionId, url: urls[0], urlCount: urls.length, type,
    title: '', images: [], texts: [], errors: [],
    imageCount: 0, textCount: 0, errorCount: 0,
    skippedLowRes: 0, detailFollowed: 0,
    time: new Date().toISOString(),
  };

  // 收集页面所有可能指向详情页的链接
  const allDetailUrls = [];

  for (const url of urls) {
    try {
      // ---------- Internet Archive 音频抓取 ----------
      if (url.includes('archive.org/details/') || url.includes('archive.org/search')) {
        try {
          const query = url.includes('?query=') ? decodeURIComponent(url.match(/[?&]query=([^&]+)/)?.[1] || '') : '';
          const iaResults = await scrapeArchiveOrg(url, query);
          if (iaResults && iaResults.length) {
            const imgDir = path.join(sessionDir, 'images');
            for (const r of iaResults) {
              try {
                const buf = await downloadImage(r.url, 180000, url);
                if (buf && buf.length > 10000) {
                  const ext = (r.name.match(/\.(\w{3,4})$/)?.[1] || 'mp3');
                  const name = 'mus_' + safeName(r.name.replace(/\.\w+$/,'')).slice(0,50) + '.' + ext;
                  fs.writeFileSync(path.join(imgDir, name), buf);
                  result.images.push({ name, url: r.url, size: buf.length });
                  result.imageCount++;
                }
              } catch {}
            }
          }
        } catch(e) {
          result.errors.push({ url, error: 'IA: ' + e.message });
          result.errorCount++;
        }
        continue;
      }

      // ---------- B站视频专用抓取 ----------
      // ---------- B站视频专用抓取 ----------
      if (url.includes('bilibili.com/video/')) {
        try {
          const bili = await scrapeBilibili(url);
          if (bili && bili.results) {
            for (const r of bili.results) {
              if (r.buf) {
                const imgDir = path.join(sessionDir, 'images');
                fs.writeFileSync(path.join(imgDir, r.name), r.buf);
                delete r.buf;
                result.images.push(r);
                result.imageCount++;
              }
            }
            if (bili.title) result.title = bili.title;
          }
        } catch(e) {
          result.errors.push({ url, error: 'B站: ' + e.message });
          result.errorCount++;
        }
        continue; // 跳过常规 HTML 抓取
      }

      // ---------- 获取 HTML ----------
      const isFanqie = url.includes('fanqienovel.com');
      let htmlBuf;
      if (isFanqie || deepRender) {
        htmlBuf = await fetchWithBrowser(url);
        // 深度模式：额外用网络拦截抓音视频
        if (deepRender && (type === 'both' || type === 'images' || type === 'video' || type === 'music')) {
          try {
            const mediaResults = await captureMediaWithBrowser(url, sessionDir);
            for (const r of mediaResults) {
              result.images.push(r);
              result.imageCount++;
            }
          } catch {}
        }
      } else {
        try { htmlBuf = await fetchUrl(url, 8000); }
        catch (e) { htmlBuf = await fetchWithBrowser(url); }
      }
      const html = htmlBuf.toString();
      const $ = cheerio.load(html);
      if (!result.title) result.title = $('title').text().trim() || url;

      // ---------- 文本提取 ----------
      if (type === 'text' || type === 'both') {
        // 提取元数据
        const meta = {};
        $('meta[name]').each((i, el) => {
          const name = ($(el).attr('name') || '').toLowerCase();
          if (['description','author','keywords','date'].includes(name))
            meta[name] = $(el).attr('content') || '';
        });
        meta.title = $('title').text().trim();

        // 可读性评分：找正文密度最高的容器
        let bestScore = 0, bestText = '';
        const candidates = [];
        $('article, main, [role="main"], .content, .post-content, .article-content, .markdown-body, .post-body, #content, #article, .entry-content, .post, .prose').each((i, el) => {
          const txt = extractText($(el), $);
          if (txt.length > 100) {
            const htmlLen = $(el).html()?.length || txt.length;
            const ratio = txt.length / Math.max(1, htmlLen);
            const score = txt.length * ratio;
            candidates.push({ el, txt, score, ratio });
            if (score > bestScore) { bestScore = score; bestText = txt; }
          }
        });
        // 无明确容器时尝试全页
        if (!bestText) {
          bestText = extractText($('body'), $);
        }

        // 字体混淆解码
        if (/[\uE000-\uF8FF]/.test(bestText)) {
          const fontMap = loadFontMap();
          if (Object.keys(fontMap).length > 0) bestText = decodeText(bestText, fontMap);
        }
        // 清洗
        bestText = cleanText(bestText);

        const titlePrefix = meta.title ? meta.title.slice(0, 30) : result.title;
        const txtName = 'text_' + safeName(titlePrefix).replace(/_+/g, '_') + '.txt';

        // 添加元数据头
        const header = [];
        if (meta.title) header.push('标题：' + meta.title);
        if (meta.author) header.push('作者：' + meta.author);
        if (meta.date) header.push('日期：' + meta.date);
        if (meta.description) header.push('摘要：' + meta.description.slice(0, 200));
        const fullText = (header.length ? header.join('\n') + '\n\n---\n\n' : '') + bestText.slice(0, 500000);

        fs.writeFileSync(path.join(sessionDir, txtName), fullText);
        result.texts.push({ name: txtName, title: result.title, size: Buffer.byteLength(fullText), url, meta: header.length > 0 });
        result.textCount++;
      }

      // ---------- 图片提取 ----------
      if (type === 'images' || type === 'both' || type === 'video' || type === 'music') {
        // 收集页面所有详情页链接（供后续图片匹配）
        // 只保留看起来像内容详情页的链接
        const pageDetailUrls = [];
        $('a[href]').each((i, el) => {
          const href = $(el).attr('href');
          if (!href || href.startsWith('#') || href.startsWith('javascript')) return;
          if (/\.(jpg|jpeg|png|gif|webp|bmp|svg|css|js|ico)(\?|$)/i.test(href)) return;
          // 过滤明显不是详情页的链接
          const lower = href.toLowerCase();
          const isNav = /\/(login|register|about|contact|faq|privacy|terms|tag|tags|user|profile|settings|upload|random|toplist|forum|search|api)\b/.test(lower);
          if (isNav) return;
          try {
            const full = new URL(href, url).href;
            // 只取同域名的链接作为详情页候选
            if (new URL(full).hostname === new URL(url).hostname) {
              pageDetailUrls.push(full);
            }
          } catch {}
        });
        // 去重，优先保留包含数字/字母 ID 的路径
        const uniqueDetailUrls = [...new Set(pageDetailUrls)]
          .filter(u => /\/[a-z0-9]{4,10}(\b|$|\/)/i.test(u)) // 有短 ID 的才像详情页
          .slice(0, 50);
        // 如果过滤后为空，放宽条件取所有同域名链接
        if (!uniqueDetailUrls.length) {
          uniqueDetailUrls.push(...[...new Set(pageDetailUrls)].filter(u => {
            try { return new URL(u).hostname === new URL(url).hostname; } catch { return false; }
          }).slice(0, 50));
        }

        let detailIdx = 0;
        const MAX_DETAIL_FOLLOW = 10; // 最多跟踪 10 个详情页

        let imgCandidates = [];

        // 类型过滤：video 模式只保留视频，music 模式只保留音频
        if (type === 'video') {
          const videoExts = ['.mp4','.webm','.mov','.mkv'];
          // 过滤在后面图片收集之后做
        } else if (type === 'music') {
          const musicExts = ['.mp3','.wav','.ogg','.flac','.aac','.m4a'];
        }

        $('img').each((i, el) => {
          if (imgCandidates.length >= 100) return false;
          const $el = $(el);

          // 1. 优先取高分辨率属性
          let src = $el.attr('data-original') || $el.attr('data-src') ||
                    $el.attr('data-full') || $el.attr('data-hires') ||
                    $el.attr('data-large') || $el.attr('src');

          // 2. srcset 里取最大尺寸
          const srcset = $el.attr('srcset');
          if (srcset) {
            const candidates = srcset.split(',').map(s => {
              const parts = s.trim().split(/\s+/);
              return { url: parts[0], val: parseInt(parts[1]) || (parts[1]==='2x'?2:1) };
            });
            candidates.sort((a, b) => b.val - a.val);
            if (candidates[0]?.url) src = candidates[0].url;
          }

          // 3. 父级 <a> 链接
          const $parent = $el.closest('a');
          let detailUrl = null;
          if ($parent.length) {
            const href = $parent.attr('href');
            if (href && /\.(jpg|jpeg|png|gif|webp|bmp)(\?|$)/i.test(href)) {
              src = href;  // 直接链接到图片，优先用
            } else if (href && !href.startsWith('#') && !href.startsWith('javascript')) {
              // 链接到详情页，记下来后续跟踪
              try { detailUrl = new URL(href, url).href; } catch {}
            }
          }

          if (src) {
            try {
              const resolved = new URL(src, url).href;
              const upgraded = upgradeImageUrl(resolved);
              // 如果父级没找到 <a>，尝试从图片 URL 推导详情页
              let finalDetail = detailUrl;
              if (!finalDetail) {
                // wallhaven: th.wallhaven.cc/small/4v/4v9ml0.jpg → wallhaven.cc/w/4v9ml0
                const wallhavenMatch = resolved.match(/wallhaven\.cc\/(?:small|lg)\/\w+\/(\w+)\.\w+/i);
                if (wallhavenMatch) {
                  finalDetail = resolved.replace(/th\.wallhaven\.cc\/(?:small|lg)\/\w+\/\w+\.\w+/i,
                    'wallhaven.cc/w/' + wallhavenMatch[1]);
                }
              }
              if (!finalDetail) finalDetail = uniqueDetailUrls[detailIdx++] || null;
              imgCandidates.push({ orig: resolved, upgraded: upgraded !== resolved ? upgraded : null, detailUrl: finalDetail });
            } catch {}
          }
        });

      // ---------- 视频提取 ----------
      if (type === 'both' || type === 'video') { // 视频
        $('video, video source, a[href]').each((i, el) => {
          const tag = (el.tagName || '').toLowerCase();
          let src = '';
          if (tag === 'video' || tag === 'source') {
            src = $(el).attr('src') || '';
          } else if (tag === 'a') {
            const href = $(el).attr('href') || '';
            if (/\.(mp4|webm|mov|mkv|avi|flv|m3u8|mpd)(\?|$)/i.test(href)) {
              src = href;
            }
          }
          if (src) {
            try {
              const resolved = new URL(src, url).href;
              // 避免重复
              if (!imgCandidates.some(c => c.orig === resolved)) {
                const ext = (path.extname(new URL(resolved).pathname).split('?')[0] || '.mp4').toLowerCase();
                if (['.mp4', '.webm', '.mov', '.mkv', '.avi'].includes(ext)) {
                  imgCandidates.push({ orig: resolved, upgraded: null, detailUrl: null, isVideo: true });
                }
              }
            } catch {}
          }
        });
      }

      // ---------- 音频提取 ----------
      if (type === 'both' || type === 'music') {
        $('audio, audio source, a[href]').each((i, el) => {
          const tag = (el.tagName || '').toLowerCase();
          let src = '';
          if (tag === 'audio' || tag === 'source') {
            src = $(el).attr('src') || '';
          } else if (tag === 'a') {
            const href = $(el).attr('href') || '';
            if (/\.(mp3|wav|ogg|flac|aac|m4a|wma)(\?|$)/i.test(href)) {
              src = href;
            }
          }
          if (src) {
            try {
              const resolved = new URL(src, url).href;
              if (!imgCandidates.some(c => c.orig === resolved)) {
                imgCandidates.push({ orig: resolved, upgraded: null, detailUrl: null, isAudio: true });
              }
            } catch {}
          }
        });
      }

      // ---------- 文档提取 ----------
      if (type === 'both' || type === 'images') {
        const docExts = ['.pdf','.doc','.docx','.xls','.xlsx','.ppt','.pptx','.csv','.zip','.rar','.7z'];
        $('a[href]').each((i, el) => {
          const href = $(el).attr('href') || '';
          const lower = href.toLowerCase();
          if (docExts.some(ext => lower.includes(ext))) {
            try {
              const resolved = new URL(href, url).href;
              if (!imgCandidates.some(c => c.orig === resolved)) {
                imgCandidates.push({ orig: resolved, upgraded: null, detailUrl: null, isDoc: true });
              }
            } catch {}
          }
        });
      }

        // 类型过滤：video 只保留视频，music 只保留音频
        if (type === 'video') {
          const videoExts = ['.mp4','.webm','.mov','.mkv'];
          imgCandidates = imgCandidates.filter(c => {
            try { const ext = new URL(c.orig).pathname.split('?')[0].toLowerCase().match(/\.\w{3,4}$/)?.[0] || ''; return videoExts.includes(ext); } catch { return false; }
          });
        } else if (type === 'music') {
          const musicExts = ['.mp3','.wav','.ogg','.flac','.aac','.m4a'];
          imgCandidates = imgCandidates.filter(c => {
            try { const ext = new URL(c.orig).pathname.split('?')[0].toLowerCase().match(/\.\w{3,4}$/)?.[0] || ''; return musicExts.includes(ext); } catch { return false; }
          });
        }

        const CONCURRENCY = 4;
        const globalBase = result.images.length;
        let downloaded = 0;

        for (let i = 0; i < imgCandidates.length; i += CONCURRENCY) {
          const batch = imgCandidates.slice(i, i + CONCURRENCY);
          const batchResults = await Promise.allSettled(
            batch.map(async (cand, bi) => {
              try {
                const ext = (path.extname(new URL(cand.orig).pathname).split('?')[0] || '.jpg').toLowerCase();
                if (['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a'].includes(ext.slice(0,5))) { const buf = await downloadImage(cand.orig, 30000, url); if (!buf || buf.length < 1024) return null; const idx = globalBase + i + bi + 1; const imgName = 'mus_' + String(idx).padStart(4,'0') + ext.slice(0,5); fs.writeFileSync(path.join(imgDir, imgName), buf); return { name: imgName, url: cand.orig, size: buf.length }; }
                if (['.mp4', '.webm', '.mov', '.mkv'].includes(ext.slice(0,5))) { const buf = await downloadImage(cand.orig, 30000, url); if (!buf || buf.length < 1024) return null; const idx = globalBase + i + bi + 1; const imgName = 'vid_' + String(idx).padStart(4,'0') + ext; fs.writeFileSync(path.join(imgDir, imgName), buf); return { name: imgName, url: cand.orig, size: buf.length }; }
                const docExts = ['.pdf','.doc','.docx','.xls','.xlsx','.ppt','.pptx','.csv','.zip','.rar','.7z','.txt'];
                if (docExts.includes(ext)) { const buf = await downloadImage(cand.orig, 30000, url); if (!buf || buf.length < 1024) return null; const idx = globalBase + i + bi + 1; const name = 'doc_' + String(idx).padStart(4,'0') + ext; fs.writeFileSync(path.join(imgDir, name), buf); return { name, url: cand.orig, size: buf.length }; }
                if (!['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.mp4', '.webm', '.mov', '.mkv'].includes(ext.slice(0, 5))) return null;

                // 先下载原始 URL（传原页面 URL 作为 Referer）
                let buf = null, finalUrl = cand.orig;
                try { buf = await downloadImage(cand.orig, 8000, url); } catch {}

                let w = 0, h = 0;
                if (buf && ext !== '.svg') {
                  try {
                    const meta = await sharp(buf).metadata();
                    w = meta.width || 0; h = meta.height || 0;
                  } catch {}
                }

                // 太低分辨率 → 尝试升级版 URL
                const tooSmall = (minWidth > 0 && w < minWidth) || (minHeight > 0 && h < minHeight);
                if (buf && tooSmall && cand.upgraded) {
                  try {
                    const upgradedExt = (path.extname(new URL(cand.upgraded).pathname).split('?')[0] || ext).toLowerCase();
                    if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(upgradedExt.slice(0, 5))) {
                      const buf2 = await downloadImage(cand.upgraded, 8000, url);
                      const meta2 = await sharp(buf2).metadata();
                      if ((meta2.width || 0) > w || (meta2.height || 0) > h) {
                        buf = buf2; finalUrl = cand.upgraded;
                        w = meta2.width || 0; h = meta2.height || 0;
                      }
                    }
                  } catch {}
                }

                // 还是太小 + 有详情页 → 跟踪详情页找大图（不超过上限）
                const stillTooSmall = (minWidth > 0 && w < minWidth) || (minHeight > 0 && h < minHeight);
                if (followDetail && cand.detailUrl && result.detailFollowed < MAX_DETAIL_FOLLOW && (!buf || stillTooSmall || (w < 800 && h < 600))) {
                  const detail = await scrapeDetailPage(cand.detailUrl, url);
                  if (detail && detail.buf) {
                    const dp = (detail.meta.width || 0) * (detail.meta.height || 0);
                    const cp = w * h;
                    if (dp > cp) {
                      buf = detail.buf; finalUrl = detail.url;
                      w = detail.meta.width || 0; h = detail.meta.height || 0;
                      result.detailFollowed++;
                    }
                  }
                }

                // 最终检查：如果仍不满足最低分辨率，跳过
                if (buf && (minWidth > 0 || minHeight > 0) && ext !== '.svg') {
                  if (w < minWidth || h < minHeight) {
                    return { _skip: true, w, h };
                  }
                }

                if (!buf) return null;
                const idx = globalBase + i + bi + 1;
                const imgName = `img_${String(idx).padStart(4, '0')}${ext.slice(0, 5)}`;
                fs.writeFileSync(path.join(imgDir, imgName), buf);
                return { name: imgName, url: finalUrl, size: buf.length };
              } catch { return null; }
            })
          );
          for (const r of batchResults) {
            if (r.status === 'fulfilled' && r.value) {
              if (r.value._skip) { result.skippedLowRes++; continue; }
              result.images.push(r.value); downloaded++;
            }
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

// ===== URL 升级：尝试从缩略图 URL 推导原图 URL =====

function upgradeImageUrl(imgUrl) {
  try {
    const u = new URL(imgUrl);
    // 去掉常见尺寸查询参数
    const sizeParams = ['w', 'width', 'h', 'height', 'size', 'quality', 'resize', 'thumb', 'thumbnail'];
    for (const p of sizeParams) u.searchParams.delete(p);
    // 去掉 URL path 里的缩略图后缀: -150x150, _thumb, _small, -preview 等
    u.pathname = u.pathname.replace(/[-_](?:\d{2,4}x\d{2,4}|thumb|small|medium|tn|thumbnail|preview|mini)(?=\.\w{3,4}$)/i, '');
    return u.toString();
  } catch { return imgUrl; }
}

// ===== 辅助 =====

function safeName(name) {
  return name.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]/g, '_');
}

// 智能文本提取：保留段落结构
function extractText(el, $) {
  const clone = el.clone();
  // 移除无关元素
  clone.find('script, style, nav, header, footer, .nav, .header, .footer, .sidebar, .ad, .advertisement, [class*="comment"], [class*="share"], [class*="related"], .recommend, .widget, .social, .breadcrumb, [role="navigation"], [role="banner"]').remove();
  // 块级元素 → 换行
  clone.find('p, div, li, h1, h2, h3, h4, h5, h6, section, article, blockquote, pre, table, tr').each((i, el) => {
    $(el).append('\n');
  });
  clone.find('br').replaceWith('\n');
  let text = clone.text();
  // 清理多余空白
  text = text.replace(/\n[ \t]+/g, '\n').replace(/[ \t]+\n/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  // 合并过短的相邻行
  const lines = text.split('\n');
  const merged = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { merged.push(''); continue; }
    const prev = merged[merged.length - 1];
    if (prev && prev.length < 40 && !prev.endsWith('。') && !prev.endsWith('！') && !prev.endsWith('？')) {
      merged[merged.length - 1] = prev + trimmed;
    } else {
      merged.push(trimmed);
    }
  }
  return merged.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// 文本后处理：去除噪音、空行压缩、长度截断
function cleanText(text) {
  // 去常见噪音行
  return text
    .split('\n')
    .filter(line => {
      const t = line.trim();
      if (!t) return true; // 保留空行
      if (t.length < 3 && !/^[#\-*]/.test(t)) return false;
      if (/^(copyright|©|all rights|隐私|备案|粤ICP|京ICP|沪ICP|苏ICP|举报|投诉|广告|赞助|推广)/i.test(t)) return false;
      return true;
    })
    .join('\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

// ===== 采集历史 =====

function listSessions() {
  const sessions = [];
  if (fs.existsSync(SCRAPE_DIR)) {
    for (const dir of fs.readdirSync(SCRAPE_DIR)) {
      const rp = path.join(SCRAPE_DIR, dir, 'result.json');
      if (fs.existsSync(rp)) {
        try {
          const raw = JSON.parse(fs.readFileSync(rp, 'utf8'));
          // 贴吧采集会话
          if (raw.kw !== undefined) {
            sessions.push({
              sessionId: raw.sessionId || dir,
              type: 'tieba',
              kw: raw.kw,
              title: raw.kw + '吧',
              threadCount: raw.threadCount || 0,
              fetchedCount: raw.fetchedCount || 0,
              textSize: raw.textSize || 0,
              textFile: raw.textFile || '',
              errorCount: (raw.errors || []).length,
              time: raw.time,
            });
            continue;
          }
          // 常规采集会话
          const summary = {
            sessionId: raw.sessionId, url: raw.url, urlCount: raw.urlCount, type: raw.type,
            title: raw.title, imageCount: raw.imageCount, textCount: raw.textCount,
            errorCount: raw.errorCount, skippedLowRes: raw.skippedLowRes || 0,
            detailFollowed: raw.detailFollowed || 0,
            time: raw.time,
            images: (raw.images || []).map(i => ({ name: i.name, size: i.size })),
            texts: (raw.texts || []).map(t => ({ name: t.name, title: t.title, size: t.size })),
          };
          sessions.push(summary);
        } catch {}
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

// ===== 百度贴吧爬虫 =====

/**
 * 爬取百度贴吧帖子列表及内容/评论
 * @param {string} kw - 贴吧名称（如 "孙笑川"）
 * @param {object} opts - { maxPages, maxThreads, includeComments, sessionDir }
 */
async function scrapeTieba(kw, opts = {}) {
  const maxPages = Math.min(opts.maxPages || 2, 10);
  const maxThreads = Math.min(opts.maxThreads || 15, 30);
  const includeComments = opts.includeComments !== false;
  const sessionDir = opts.sessionDir;
  const imgDir = path.join(sessionDir, 'images');

  const errors = [];
  const threads = [];
  let toFetch = [];

  const b = await getBrowser();
  resetBrowserTimer();
  const page = await b.newPage();

  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131');
    await page.setViewport({ width: 1920, height: 1080 });

    // 先访问 baidu.com 获取 cookies 以绕过 WAF
    try {
      await page.goto('https://www.baidu.com/', { waitUntil: 'domcontentloaded', timeout: 10000 });
      await sleep(1500);
    } catch (e) {
      // baidu.com 超时不影响，尝试直接访问贴吧
      console.error('baidu.com cookie skip:', e.message.slice(0, 50));
    }

    // 逐页爬取帖子列表
    for (let pg = 0; pg < maxPages; pg++) {
      if (threads.length >= maxThreads) break;

      const listUrl = `https://tieba.baidu.com/f?ie=utf-8&kw=${encodeURIComponent(kw)}&pn=${pg * 50}`;
      try {
        await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await sleep(2500);

        // 检查是否被安全验证拦截
        const title = await page.title();
        if (title.includes('安全验证') || title.includes('验证')) {
          errors.push({ page: pg + 1, error: '遇到百度安全验证，请稍后重试' });
          continue;
        }

        // 提取当前页的帖子列表
        const pageThreads = await page.evaluate(() => {
          const results = [];

          // 策略1：通过 thread-content-link 和 top-thread-card-item 类名定位（新版贴吧 Vue 渲染）
          const threadLinks = document.querySelectorAll('a.thread-content-link, a.top-thread-card-item');
          if (threadLinks.length > 0) {
            const seen = new Set();
            threadLinks.forEach(a => {
              const href = a.getAttribute('href') || '';
              const m = href.match(/\/p\/(\d+)/);
              if (!m || seen.has(m[1])) return;
              seen.add(m[1]);

              // 标题在 .thread-title 子元素中，比 a 的全文干净
              const titleEl = a.querySelector('.thread-title, [class*="title"]');
              const title = (titleEl ? titleEl.textContent.trim() : a.textContent.trim()).slice(0, 200);
              if (!title || title.length < 2) return;

              // 从全文提取作者名+时间+预览
              const fullText = a.textContent.trim();
              let author = '';
              const authorMatch = fullText.match(/^(.+?)\s{2,}/);
              if (authorMatch && !authorMatch[1].includes('置顶') && authorMatch[1].length < 30) {
                author = authorMatch[1].trim();
              }
              // 预览文本：标题之后的文字（即楼主首帖内容）
              let preview = '';
              if (title && fullText.includes(title)) {
                preview = fullText.slice(fullText.indexOf(title) + title.length).trim();
                preview = preview.replace(/\.{3}全文$/, '').trim();
              }
              // 时间
              let time = '';
              const tm = fullText.match(/回复于(\S+)/);
              if (tm) time = tm[1];

              // 回复数
              let replyCount = 0;
              const parent = a.closest('li, div[class*="thread"]') || a.parentElement;
              if (parent) {
                const replyEl = parent.querySelector('[class*="reply"], [class*="count"], .threadlist_rep_num');
                if (replyEl) {
                  const n = parseInt(replyEl.textContent.replace(/[^0-9]/g, ''));
                  if (!isNaN(n)) replyCount = n;
                }
              }

              results.push({ tid: m[1], title, author, time, preview, replyCount, href: href.startsWith('http') ? href : 'https://tieba.baidu.com' + href });
            });
            if (results.length) return results;
          }

          // 策略2：兜底——遍历所有 /p/ 链接
          const seen = new Set();
          document.querySelectorAll('a[href*="/p/"]').forEach(a => {
            const href = a.getAttribute('href') || '';
            const m = href.match(/\/p\/(\d+)/);
            if (!m || seen.has(m[1])) return;

            const text = a.textContent.trim();
            if (!text || text.length < 3 || /^\d+$/.test(text)) return;

            seen.add(m[1]);
            let author = '';
            let replyCount = 0;
            const parent = a.closest('li') || a.parentElement?.parentElement;
            if (parent) {
              const authorEl = parent.querySelector('[class*="author"], [class*="name"], .frs-author-name');
              if (authorEl) author = authorEl.textContent.trim();
              const replyEl = parent.querySelector('[class*="reply"], [class*="count"], [class*="num"]');
              if (replyEl) {
                const n = parseInt(replyEl.textContent);
                if (!isNaN(n)) replyCount = n;
              }
            }
            results.push({ tid: m[1], title: text.slice(0, 200), author, replyCount, href: href.startsWith('http') ? href : 'https://tieba.baidu.com' + href });
          });
          return results;
        });

        // 去重后加入
        const existingIds = new Set(threads.map(t => t.tid));
        for (const t of pageThreads) {
          if (!existingIds.has(t.tid)) {
            // 确保链接完整
            if (!t.href || t.href.startsWith('/')) {
              t.href = 'https://tieba.baidu.com/p/' + t.tid;
            }
            threads.push(t);
            existingIds.add(t.tid);
          }
        }

        if (!pageThreads.length) {
          break; // 没有更多帖子了
        }
      } catch (e) {
        errors.push({ page: pg + 1, error: '页面加载失败: ' + e.message });
      }
    }

    // 爬取帖子详情（评论）—— 仅当需要评论时访问详情页，且限制数量
    const detailLimit = Math.min(maxThreads, 3); // 评论模式最多爬3个详情页
    toFetch = includeComments ? threads.slice(0, detailLimit) : [];
    for (let i = 0; i < toFetch.length; i++) {
      const t = toFetch[i];
      let detailDone = false;
      // 详情页重试机制（最多2次）
      for (let retry = 0; retry < 2 && !detailDone; retry++) {
        try {
          if (retry > 0) {
            // 重试前先回列表页刷新 cookies
            try {
              await page.goto('https://tieba.baidu.com/f?ie=utf-8&kw=' + encodeURIComponent(kw) + '&pn=0',
                { waitUntil: 'domcontentloaded', timeout: 15000 });
              await sleep(1500);
            } catch {}
          }
          await page.goto(t.href, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await sleep(2000);

        // 滚动以加载懒加载内容
        await page.evaluate(async () => {
          window.scrollBy(0, 600);
          await new Promise(r => setTimeout(r, 300));
          window.scrollTo(0, 0);
        });
        await sleep(1000);

        const detail = await page.evaluate(() => {
          const posts = [];

          // 新贴吧 Vue 渲染，正文在 .main-content 区域的 .pb-page-wrapper 中
          const bodyText = (document.body?.innerText || '').trim();
          if (!bodyText || bodyText.length < 30) return { posts, title: document.title };

          // 按行解析，识别楼层边界（作者名 → badge → 时间 → 地点 → 内容）
          const lines = bodyText.split('\n').filter(l => l.trim());
          let currentPost = null;
          let contentLines = [];
          let isFirstPost = true;
          let headerDone = false;

          const badges = new Set(['贴吧成长等级','本吧头衔','核心吧友','知名人士','人气楷模',
            '铁杆吧友','活跃吧友','吧主','小吧主','贴吧SVIP','贴吧人气楷模','人气楷模','初级粉丝']);
          const provinces = new Set(['浙江','江苏','广东','北京','上海','四川','湖北','河南','山东',
            '福建','湖南','河北','安徽','辽宁','陕西','重庆','江西','广西','云南','贵州',
            '山西','吉林','黑龙江','甘肃','内蒙古','海南','新疆','宁夏','青海','西藏','天津']);

          function isBadge(s) { return badges.has(s); }
          function isProvince(s) { return provinces.has(s); }
          function isTime(s) { return /^(\d{2}-\d{2}|\d+分钟前|\d+小时前|\d+天前|\d{4}-\d{2}-\d{2}|\d+:\d{2})/.test(s); }
          function isNum(s) { return /^[\d.,]+[Ww万]?$/.test(s) && s.length <= 10; }
          function isNav(s) {
            const nav = ['发贴','登录','首页','我的','分享','收藏','关注','回复','转发','赞',
              '只看楼主','热门','正序','倒序','发贴千百度','加载中','请求超时'];
            return nav.includes(s) || s.startsWith('全部回复') || s === '0';
          }
          function isBoardName(s) {
            const names = ['孙笑川','抗压背锅','kpl','asoul','bilibili','异环','鸣潮','原神',
              '王者荣耀','明日方舟','三角洲','国产动画','第五人格','洛克王国','艾欧尼亚',
              '咒术回战','尐家军','崩坏','2ch','新鸣潮','有男不玩'];
            return names.some(n => s === n || s === n + '吧');
          }

          function savePost() {
            if (currentPost && contentLines.length > 0) {
              currentPost.content = contentLines.join('\n').trim();
              if (currentPost.content.length > 1) posts.push(currentPost);
            }
            contentLines = [];
          }

          // 过滤掉常见噪音和广告文本
          const noisePatterns = [
            /^Tommmmmm$/, /^意见领袖$/, /^展开\s*\d+\s*条回复/, /^广告$/,
            /^建吧日期/, /^猜猜我是谁/, /^欢迎来到/, /^进吧看看$/,
            /^本吧热议话题/, /^热度[\d.]+[Ww万]/, /^去$/,
            /^谁懂啊！/, /^装备掉不停！/, /^高爆率/,
            /传奇/, /散人/, /神装/, /无限进阶/, /上线送/,
            /^上班摸鱼/, /^游戏推荐/, /^点击下载/, /^立即领取/,
          ];

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const nextLine = lines[i + 1] || '';

            // 遇到板元数据停止
            if (/^(建吧日期|本吧热议|猜猜我是谁|欢迎来到|进吧看看)/.test(line)) break;

            // 跳过数字、导航、板名、统计、广告噪音
            if (/^\d+$/.test(line) || isNum(line) || isNav(line) || isBoardName(line)) continue;
            if (/^[\u4e00-\u9fff]+吧$/.test(line) || /^关注[\d.]+[W万]/.test(line)) continue;
            if (noisePatterns.some(p => p.test(line))) continue;

            // 检测楼层边界：当前行不是元数据，下一行是 badge
            if (isBadge(nextLine) && !isBadge(line) && !isTime(line) && !isProvince(line) &&
                !isNum(line) && !isNav(line) && line.length >= 2 && line.length < 40) {
              savePost();
              currentPost = {
                floor: isFirstPost ? '楼主' : ('#' + (posts.length + 1)),
                author: line.trim(),
                time: '', content: '', comments: [],
              };
              isFirstPost = false;
              continue;
            }

            // 元数据行
            if (isBadge(line) || isProvince(line)) continue;
            if (isTime(line)) {
              if (currentPost && !currentPost.time) currentPost.time = line.trim();
              continue;
            }

            // 楼中楼回复
            const rm = line.match(/^回复\s+(.+?)\s*[:：]\s*(.+)/);
            if (rm && currentPost) {
              currentPost.comments.push({ user: rm[1].trim(), content: rm[2].trim() });
              continue;
            }

            // 内容行
            if (currentPost && line.length > 1 && !isBadge(line) && !isTime(line) &&
                !isProvince(line) && !isNum(line) && !isNav(line)) {
              contentLines.push(line.trim());
            }
          }
          savePost();
          return { posts: posts.slice(0, 30), title: document.title };
        });

        t.posts = detail.posts || [];
        t.detailTitle = (detail.title || t.title).replace(/[-_].*$/, '').trim();
        detailDone = true; // 成功
      } catch (e) {
        if (retry === 1) { // 最后一次重试失败
          t.posts = [];
          t.fetchError = e.message;
          errors.push({ thread: t.title?.slice(0, 30), error: '详情加载失败: ' + e.message });
        }
      }
      } // end retry loop
    } // end for each thread
  } finally {
    await page.close();
  }

  // 格式化输出文本
  const textContent = formatTiebaText(kw, threads, includeComments);
  const txtName = 'tieba_' + safeName(kw).replace(/_+/g, '_').slice(0, 30) + '.txt';
  fs.writeFileSync(path.join(sessionDir, txtName), textContent);

  // 保存结构化数据
  const metaData = threads.map(t => ({
    tid: t.tid, title: t.title, author: t.author, time: t.time,
    preview: t.preview?.slice(0, 300),
    replyCount: t.replyCount, href: t.href,
    postCount: (t.posts || []).length,
    posts: (t.posts || []).map(p => ({
      floor: p.floor, author: p.author, time: p.time,
      content: p.content?.slice(0, 500),
      commentCount: (p.comments || []).length,
    })),
  }));
  fs.writeFileSync(path.join(sessionDir, 'meta.json'), JSON.stringify(metaData, null, 2));

  return {
    kw, threadCount: threads.length, fetchedCount: toFetch?.length || 0,
    errors,
    textFile: txtName,
    textSize: Buffer.byteLength(textContent),
    time: new Date().toISOString(),
    threads: metaData,
  };
}

/**
 * 格式化贴吧内容为易读文本，保持意群换行和合理分布
 */
function formatTiebaText(kw, threads, includeComments) {
  const lines = [];
  lines.push('='.repeat(60));
  lines.push('  百度贴吧 —— ' + kw + '吧');
  lines.push('  采集时间：' + new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }));
  lines.push('  帖子数量：' + threads.length + (includeComments ? '  |  含评论' : '  |  含楼主内容（勾选「含评论」获取帖内回复）'));
  lines.push('='.repeat(60));
  lines.push('');

  for (let i = 0; i < threads.length; i++) {
    const t = threads[i];
    lines.push('─'.repeat(50));
    lines.push('【' + (i + 1) + '】' + (t.detailTitle || t.title));

    if (t.author) lines.push('作者：' + t.author);
    if (t.replyCount > 0) lines.push('回复数：' + t.replyCount);
    lines.push('链接：' + t.href);
    lines.push('');

    // 帖子内容
    if (t.posts && t.posts.length > 0) {
      // 有详情页爬取的内容
      for (const post of t.posts) {
        let floorLine = '  ' + post.floor;
        if (post.author) floorLine += '  |  ' + post.author;
        if (post.time) floorLine += '  |  ' + post.time;
        lines.push(floorLine);
        lines.push('  ' + '-'.repeat(30));
        if (post.content) {
          const formatted = formatContentWithBreaks(post.content);
          for (const para of formatted) { lines.push('  ' + para); lines.push(''); }
        }
        if (includeComments && post.comments && post.comments.length > 0) {
          lines.push('  【评论】');
          for (const c of post.comments) {
            const commentText = c.content.trim();
            const formattedComment = formatContentWithBreaks(commentText);
            const prefix = c.user ? '    ' + c.user + '：' : '    ';
            lines.push(prefix + formattedComment.join(' '));
          }
          lines.push('');
        }
      }
    } else if (t.preview && t.preview.length > 2) {
      // 从列表页提取的楼主内容预览
      lines.push('  楼主  |  ' + (t.author || '') + (t.time ? '  |  ' + t.time : ''));
      lines.push('  ' + '-'.repeat(30));
      const formatted = formatContentWithBreaks(t.preview);
      for (const para of formatted) { lines.push('  ' + para); lines.push(''); }
      if (!includeComments) {
        lines.push('  💡 勾选「含评论」可获取帖内回复');
        lines.push('');
      }
    } else if (!includeComments) {
      lines.push('  点击上方链接查看完整内容');
      lines.push('');
    } else if (t.fetchError) {
      lines.push('  [加载失败：' + t.fetchError + ']');
      lines.push('');
    } else {
      lines.push('  [未获取到内容]');
      lines.push('');
    }
  }

  lines.push('='.repeat(60));
  lines.push('  —— 采集完毕 ——');
  lines.push('='.repeat(60));

  return lines.join('\n');
}

/**
 * 按语义意群换行：在句号、问号、感叹号、省略号后断行
 * 每行尽量不超过 40 个字符，保持自然阅读节奏
 */
function formatContentWithBreaks(text) {
  if (!text) return [''];

  // 先清理多余空白
  let cleaned = text
    .replace(/[\r\t]+/g, '')
    .replace(/  +/g, ' ')
    .trim();

  // 按句末标点分割成句子
  const sentences = cleaned
    .split(/(?<=[。！？…\.!?])/)
    .map(s => s.trim())
    .filter(Boolean);

  // 重组为合适的段落
  const paragraphs = [];
  let current = '';

  for (const s of sentences) {
    const candidate = current ? current + s : s;
    if (candidate.length > 45 && current.length > 0) {
      paragraphs.push(current.trim());
      current = s;
    } else {
      current = candidate;
    }
  }
  if (current.trim()) paragraphs.push(current.trim());

  return paragraphs.length ? paragraphs : [cleaned.slice(0, 100)];
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = {
  doScrape, listSessions, getSession, deleteSession, transferSession,
  fetchUrl, downloadImage, safeName, scrapeDetailPage, upgradeImageUrl,
  extractImagesFromHtml, screenshotDetailPage, fetchWithBrowser, extractText, cleanText,
  scrapeBilibili, scrapeArchiveOrg, captureMediaWithBrowser,
  scrapeTieba, formatTiebaText, formatContentWithBreaks,
};

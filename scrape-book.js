// scrape-book.js - Scrape entire fanqienovel book as PDF screenshots
// Usage: node scrape-book.js <reader_url> [start_chapter] [end_chapter]
// Example: node scrape-book.js https://fanqienovel.com/reader/7147599605763572227 1 10

const puppeteer = require('puppeteer-extra');
const Stealth = require('puppeteer-extra-plugin-stealth');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

puppeteer.use(Stealth());

const readerUrl = process.argv[2];
const startChap = parseInt(process.argv[3]) || 1;
const endChap = parseInt(process.argv[4]) || 0; // 0 = all

if (!readerUrl) {
  console.error('Usage: node scrape-book.js <reader_url> [start_chapter] [end_chapter]');
  console.error('Example: node scrape-book.js https://fanqienovel.com/reader/7147599605763572227 1 50');
  process.exit(1);
}

// Parse the first chapter ID from URL
const firstItemId = readerUrl.match(/\/reader\/(\d+)/)?.[1];
if (!firstItemId) {
  console.error('Could not parse item ID from URL');
  process.exit(1);
}

const OUT_DIR = '/home/ubuntu/dashboard/scrape/' + Date.now().toString(36);
const PDF_DIR = path.join(OUT_DIR, 'pdfs');
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(PDF_DIR, { recursive: true });

(async () => {
  console.log(`📚 番茄小说批量截取PDF`);
  console.log(`   Chapter 1 ID: ${firstItemId}`);
  
  const b = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  try {
    // Step 1: Get book info and chapter list
    const p0 = await b.newPage();
    await p0.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    
    // Navigate to first chapter to get bookId
    await p0.goto(readerUrl, { waitUntil: 'networkidle2', timeout: 25000 });
    await new Promise(r => setTimeout(r, 3000));
    
    const bookInfo = await p0.evaluate(() => {
      const title = document.title;
      const authorEl = document.querySelector('[class*="author"], .author-name');
      return { title, author: authorEl?.innerText || '' };
    });
    
    // Get bookId from a network request
    let bookId = null;
    const chapterListIds = []; // Will collect from the reader API response
    
    // We need to get the book ID - let's use the API
    const bookInfoPage = await p0.goto(`https://fanqienovel.com/api/reader/directory/detail?bookId=&itemId=${firstItemId}`, { waitUntil: 'networkidle2', timeout: 10000 }).then(() => p0.evaluate(() => document.body.innerText)).catch(() => null);
    
    // Actually, let's use a different approach - intercept the API call
    let directoryData = null;
    p0.on('response', async r => {
      if (r.url().includes('directory/detail')) {
        try {
          const body = await r.json();
          directoryData = body;
        } catch {}
      }
    });
    
    await p0.goto(readerUrl, { waitUntil: 'networkidle2', timeout: 25000 });
    await new Promise(r => setTimeout(r, 3000));
    await p0.close();
    
    if (!directoryData) {
      // Try direct API call
      console.log('Retrying directory API...');
      const p1 = await b.newPage();
      await p1.goto(readerUrl, { waitUntil: 'networkidle2', timeout: 25000 });
      await new Promise(r => setTimeout(r, 5000));
      
      const dirResult = await p1.evaluate(async () => {
        try {
          const r = await fetch('/api/reader/directory/detail?' + new URLSearchParams({ itemId: document.location.pathname.split('/').pop() }));
          const d = await r.json();
          return d;
        } catch { return null; }
      });
      directoryData = dirResult;
      await p1.close();
    }
    
    if (!directoryData || !directoryData.data?.allItemIds) {
      console.error('✗ Could not get chapter list');
      console.log('Data:', JSON.stringify(directoryData).slice(0, 500));
      await b.close();
      process.exit(1);
    }
    
    const allIds = directoryData.data.allItemIds;
    const bookName = bookInfo.title?.replace(/第\d+章.*/, '').trim() || '未命名书籍';
    const total = allIds.length;
    
    console.log(`   书名: ${bookName}`);
    console.log(`   总章节: ${total}`);
    
    const startIdx = Math.max(0, startChap - 1);
    const endIdx = endChap > 0 ? Math.min(endChap, total) : total;
    const chapIds = allIds.slice(startIdx, endIdx);
    
    console.log(`   采集范围: 第 ${startIdx + 1} 章 - 第 ${endIdx} 章 (共 ${chapIds.length} 章)`);
    console.log(`   输出目录: ${OUT_DIR}`);
    console.log('');
    
    // Step 2: Scrape each chapter as PDF
    const pdfFiles = [];
    let success = 0;
    let failed = 0;
    
    for (let i = 0; i < chapIds.length; i++) {
      const id = chapIds[i];
      const chapNum = startIdx + i + 1;
      const pdfName = `chapter_${String(chapNum).padStart(4, '0')}.pdf`;
      const pdfPath = path.join(PDF_DIR, pdfName);
      
      if (fs.existsSync(pdfPath)) {
        console.log(`  [${chapNum}/${endIdx}] 已存在，跳过`);
        pdfFiles.push(pdfPath);
        success++;
        continue;
      }
      
      const chapUrl = `https://fanqienovel.com/reader/${id}`;
      
      try {
        const page = await b.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        await page.setViewport({ width: 800, height: 1200 });
        await page.goto(chapUrl, { waitUntil: 'networkidle2', timeout: 20000 });
        await new Promise(r => setTimeout(r, 2000));
        
        // Get chapter title
        const chapTitle = await page.evaluate(() => {
          const el = document.querySelector('h1, h2, .chapter-title, [class*="chapter"]');
          return el?.innerText?.trim() || '';
        });
        
        await page.pdf({
          path: pdfPath,
          format: 'A5',
          printBackground: true,
          margin: { top: '30px', bottom: '30px', left: '25px', right: '25px' },
        });
        
        await page.close();
        
        const size = (fs.statSync(pdfPath).size / 1024).toFixed(0);
        console.log(`  [${chapNum}/${endIdx}] ✅ ${chapTitle.slice(0, 40)} (${size}KB)`);
        pdfFiles.push(pdfPath);
        success++;
      } catch (e) {
        console.log(`  [${chapNum}/${endIdx}] ❌ ${e.message}`);
        failed++;
      }
    }
    
    // Step 3: Merge PDFs
    console.log('');
    console.log(`📊 完成: ${success} 成功, ${failed} 失败`);
    
    if (pdfFiles.length > 0) {
      const mergedPath = path.join(OUT_DIR, `${bookName}.pdf`);
      console.log(`📄 合并 PDF: ${mergedPath}`);
      
      try {
        const filesList = pdfFiles.map(f => `'${f}'`).join(' ');
        execSync(`pdfunite ${filesList} '${mergedPath}' 2>/dev/null`, { timeout: 60000 });
        const mergedSize = (fs.statSync(mergedPath).size / 1024 / 1024).toFixed(1);
        console.log(`✅ 合并完成: ${mergedSize}MB`);
        console.log(`   文件: ${mergedPath}`);
        
        // Also copy to files dir
        const finalPath = `/home/ubuntu/dashboard/files/${bookName}.pdf`;
        fs.copyFileSync(mergedPath, finalPath);
        console.log(`   已复制到文件中转站: ${bookName}.pdf`);
      } catch (e) {
        console.log('⚠️ pdfunite 合并失败 (可能需要安装 poppler-utils):', e.message);
        console.log(`   PDF 分章文件在: ${PDF_DIR}/`);
      }
    }
    
    // Save metadata
    const meta = {
      bookName,
      url: readerUrl,
      total: total,
      range: [startIdx + 1, endIdx],
      scraped: success,
      failed,
      time: new Date().toISOString(),
      dir: OUT_DIR,
    };
    fs.writeFileSync(path.join(OUT_DIR, 'book-meta.json'), JSON.stringify(meta, null, 2));
    
  } finally {
    await b.close();
    console.log('\n✨ 全部完成');
  }
})().catch(e => { console.error('FATAL:', e); process.exit(1); });

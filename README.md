# 一苇 · YiWei Launchpad

> 一苇以航，轻量启程 — 个人综合启动页

## 功能

- 🏠 **首页导航** — 书签分类、Bing 搜索、服务器状态、主题切换
- 📁 **文件中转站** — 拖拽上传、20GB 限额、批量删除、文件预览（图片/PDF/视频/音频/代码）
- 📝 **Markdown 笔记** — 分屏实时预览、自动保存、导出 PDF
- 🔍 **网页采集** — 图片/文本批量爬取、智能 URL 展开
- 📖 **阅读器** — EPUB/PDF/TXT/Markdown、键盘翻页、自动滚屏、划词进笔记

## 启动

```bash
# 安装依赖
npm install

# 启动服务（默认 3000 端口）
npm start

# 或使用 systemd 后台常驻
sudo cp yiwei.service /etc/systemd/system/
sudo systemctl enable --now yiwei
```

## 技术栈

Node.js · Puppeteer · cheerio · epub.js · Nginx · Let's Encrypt · systemd

## 许可

MIT

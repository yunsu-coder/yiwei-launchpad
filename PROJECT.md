# 一苇 YiWei Launchpad — 项目交接文档

## 基本信息
- **域名**: https://gzhysu.top
- **服务器**: 2核/1.9GB RAM/58GB 磁盘/Ubuntu 24.04/Node.js v22
- **GitHub**: https://github.com/yunsu-coder/yiwei-launchpad
- **部署**: Nginx 反代 → 127.0.0.1:3000，systemd user service

## 启动命令
```bash
cd /home/ubuntu/dashboard
npm start          # 直接启动
systemctl --user restart dashboard   # systemd 重启
journalctl --user -u dashboard -n 30 # 查看日志
```

## 架构

### 后端（稳定，不要动）
- `server.js` — 路由分发，25个API端点
- `lib/scraper.js` — 采集引擎：B站视频/Internet Archive音频/Wallhaven 4K/深度渲染/可读性文本
- `lib/storage.js` — 文件+笔记存储
- `lib/browser.js` — Puppeteer 浏览器管理
- `lib/font.js` — 字体混淆解码

### 前端（当前版本：初始commit纯原生JS）
- `index.html` — 5面板：首页/文件/笔记/采集/阅读
- `css/styles.css` — 样式（桌面+移动端）
- 无框架，纯HTML+CSS+JS

### 重要：不要改后端！
后端经过长期打磨非常稳定。前端可以重写，但后端API接口不要动。

## API 端点速查

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/status | 服务器状态 |
| GET | /api/files | 文件列表 |
| POST | /api/files | 上传文件 |
| DELETE | /api/files/:name | 删除文件 |
| GET | /api/dl/:name | 下载 |
| GET | /api/view/:name | 预览 |
| GET | /api/preview/:name | 文本预览 |
| GET | /api/wallpaper/:name | 壁纸压缩 |
| GET/POST | /api/notes | 笔记CRUD |
| POST | /api/scrape | 采集(type:images/text/both/video/music) |
| GET | /api/scrape/list | 采集历史 |
| DELETE | /api/scrape/session/:id | 删除采集 |
| POST | /api/scrape/transfer/:id | 转存到文件 |
| GET | /api/scrape/thumb/:sid/:name | 缩略图 |
| GET | /api/scrape/img/:sid/:name | 原图 |
| GET | /api/scrape/text/:sid/:name | 采集文本 |
| POST | /api/translate | 翻译 |
| POST | /api/ai/chat | AI对话 |
| POST | /api/tts | 文字转语音 |

## 前端编写注意事项

1. **用纯原生JS**，不要引入Vue/Alpine等框架——今天试过了，全翻了
2. 每个面板一个 `<div class="panel" id="panel-xxx">`，通过添加/移除 `active` class 切换
3. 导航栏用 `data-panel` 属性关联面板
4. 预览弹窗ID：`previewModal`/`previewTitle`/`previewBody`
5. Toast提示ID：`toast`，加 `show` class 显示
6. CSS 变量在 `:root` 定义，暗色模式用 `.dark` 重写
7. 写完用 Puppeteer 实测：`node -e "const {getBrowser}=require('./lib/browser');..." `

## 今日踩坑记录
- Vue 3 生产模式 `__vue_app__._instance` 为 null
- HTML 属性双引号嵌套导致页面崩溃
- CSS 大括号缺失导致后续规则全部失效
- `write` 工具覆盖大文件会截断内容
- 浏览器缓存清除：Nginx 加 `Cache-Control: no-store`

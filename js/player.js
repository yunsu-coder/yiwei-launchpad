// ===== 播放器模块 =====
let playerCurrent = null, playerType = null;
let miniActive = false, playerQueue = [], queueIdx = -1;

const MEDIA_EXTS = ['mp4','webm','mov','mkv','mp3','wav','ogg','flac','aac','m4a'];

async function loadPlayer() {
  try {
    const resp = await (await fetch('/api/files')).json();
    const files = (resp.files || []).filter(f => !f.isDir && MEDIA_EXTS.includes(f.name.split('.').pop().toLowerCase()));
    const el = document.getElementById('playerShelf');
    const empty = document.getElementById('playerEmpty');
    if (!files.length) { el.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';
    const icons = { mp4:'🎬', webm:'🎬', mov:'🎬', mkv:'🎬', mp3:'🎵', wav:'🎵', ogg:'🎵', flac:'🎵', aac:'🎵', m4a:'🎵' };
    const sz = b => b < 1024 ? b+'B' : b < 1024*1024 ? (b/1024).toFixed(1)+'KB' : (b/1024*1024).toFixed(1)+'MB';
    playerQueue = files.map(f => f.relPath || f.name);
    el.innerHTML = files.map(f => {
      const icon = icons[f.name.split('.').pop().toLowerCase()] || '🎬';
      return `<div class="file-card" onclick="openPlayer('${escAttr(f.relPath || f.name)}')">
        <div class="file-card-preview" style="font-size:2.5rem;">${icon}</div>
        <div class="file-card-name">${escHtml(f.name)}</div>
        <div class="file-card-size">${sz(f.size)}</div>
      </div>`;
    }).join('');
  } catch(e) { console.error(e); }
}

function openPlayer(name) {
  playerCurrent = name;
  const ext = name.split('.').pop().toLowerCase();
  playerType = ['mp3','wav','ogg','flac','aac','m4a'].includes(ext) ? 'audio' : 'video';
  queueIdx = playerQueue.indexOf(name);
  document.getElementById('playerShelf').style.display = 'none';
  document.getElementById('playerEmpty').style.display = 'none';
  document.getElementById('playerView').style.display = 'block';
  document.getElementById('playerTitle').textContent = name;
  const url = '/api/view/' + encodeURIComponent(name);

  if (playerType === 'video') renderVideoPlayer(url, name);
  else renderAudioPlayer(url, name);
  startMiniPlayer(name, url, playerType);
}

let playerQuality = 'orig';

function switchQuality(q) {
  playerQuality = q;
  const video = document.getElementById('mainVideo');
  if (!video || !playerCurrent) return;
  const url = '/api/stream/' + encodeURIComponent(playerCurrent) + '?q=' + q;
  const ct = video.currentTime;
  const wasPlaying = !video.paused;
  video.src = url;
  video.currentTime = ct;
  if (wasPlaying) video.play();
}

function renderVideoPlayer(url, name) {
  playerQuality = 'orig';
  document.getElementById('vpQuality').value = 'orig';
  const content = document.getElementById('playerContent');
  content.innerHTML = `
    <div class="vp-container">
      <video id="mainVideo" preload="auto" style="max-width:100%;max-height:55vh;display:block;width:100%;cursor:pointer;background:#000;">
        <source src="/api/stream/${encodeURIComponent(name)}?q=${playerQuality}" type="video/mp4">
      </video>
      <div class="vp-loading" id="vpLoading" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#fff;font-size:1.5rem;pointer-events:none;">⏳ 加载中...</div>
      <div class="vp-controls" id="vpControls">
        <button class="vp-btn" onclick="vpPlayPause()" id="vpPlayBtn"><span class="mi">play_arrow</span></button>
        <span id="vpTime" class="vp-time">00:00 / 00:00</span>
        <input type="range" id="vpProgress" class="vp-progress" value="0" min="0" max="100" oninput="vpSeek(this.value)" title="进度">
        <input type="range" id="vpVolume" class="vp-volume" value="100" min="0" max="100" oninput="vpSetVolume(this.value)" title="音量">
        <select id="vpQuality" onchange="switchQuality(this.value)" style="background:rgba(255,255,255,0.1);color:#fff;border:1px solid rgba(255,255,255,0.2);border-radius:4px;padding:.2rem;font-size:.7rem;cursor:pointer;">
          <option value="orig" selected>原始</option>
          <option value="1080">1080p</option>
          <option value="720">720p</option>
          <option value="480">480p</option>
        </select>
        <button class="vp-btn" onclick="togglePiP()"><span class="mi">picture_in_picture</span></button>
        <button class="vp-btn" onclick="vpFullscreen()"><span class="mi">fullscreen</span></button>
        <button class="vp-btn" onclick="vpNext()"><span class="mi">skip_next</span></button>
      </div>
    </div>`;
  bindVideoEvents();
}

function renderAudioPlayer(url, name) {
  const content = document.getElementById('playerContent');
  content.innerHTML = `
    <div style="text-align:center;padding:2rem;">
      <div style="font-size:5rem;margin-bottom:1rem;">🎵</div>
      <div style="font-weight:600;margin-bottom:.5rem;color:var(--accent);">${escHtml(name)}</div>
      <audio id="mainAudio" preload="auto" style="display:none;">
        <source src="${url}">
      </audio>
      <div class="vp-loading" id="vpLoading" style="color:var(--sub);margin-bottom:.5rem;">⏳ 加载中...</div>
      <div style="display:flex;align-items:center;gap:.8rem;max-width:500px;margin:1rem auto;">
        <button class="vp-btn" onclick="vpPlayPause()" id="vpPlayBtn"><span class="mi">play_arrow</span></button>
        <input type="range" id="vpProgress" class="vp-progress" value="0" min="0" max="100" oninput="vpSeek(this.value)" style="flex:1;">
        <button class="vp-btn" onclick="vpNext()"><span class="mi">skip_next</span></button>
      </div>
      <div style="display:flex;align-items:center;justify-content:center;gap:.8rem;">
        <span id="vpTime" class="vp-time">00:00 / 00:00</span>
        <input type="range" id="vpVolume" class="vp-volume" value="100" min="0" max="100" oninput="vpSetVolume(this.value)" title="音量">
      </div>
    </div>`;
  bindAudioEvents();
  document.getElementById('mainAudio').play();
}

function bindVideoEvents() {
  const video = document.getElementById('mainVideo');
  if (!video) return;
  video.volume = localStorage.getItem('player-volume') ? parseFloat(localStorage.getItem('player-volume')) : 1;
  const vpVol = document.getElementById('vpVolume');
  if (vpVol) vpVol.value = Math.round(video.volume * 100);
  const vpPlayBtn = document.getElementById('vpPlayBtn');
  if (vpPlayBtn) vpPlayBtn.querySelector('.mi').textContent = 'play_arrow';

  video.addEventListener('click', () => vpPlayPause());
  video.addEventListener('play', () => { if (vpPlayBtn) vpPlayBtn.querySelector('.mi').textContent = 'pause'; });
  video.addEventListener('pause', () => { if (vpPlayBtn) vpPlayBtn.querySelector('.mi').textContent = 'play_arrow'; });
  video.addEventListener('waiting', () => { const ld = document.getElementById('vpLoading'); if (ld) ld.style.display = 'block'; });
  video.addEventListener('canplay', () => { const ld = document.getElementById('vpLoading'); if (ld) ld.style.display = 'none'; });
  
  video.addEventListener('loadedmetadata', () => {
    const p = document.getElementById('vpProgress');
    if (p) p.max = video.duration;
    document.getElementById('vpLoading').style.display = 'none';
    const q = document.getElementById('playerQuality');
    if (q) {
      const w = video.videoWidth, h = video.videoHeight;
      const mb = (video.duration * (w * h * 30) / 8 / 1024 / 1024).toFixed(0);
      q.textContent = (w && h) ? `${w}×${h}` : '';
    }
  });
  video.addEventListener('timeupdate', () => {
    if (!video.duration) return;
    const p = document.getElementById('vpProgress');
    if (p) { p.max = video.duration; p.value = video.currentTime; }
    document.getElementById('vpTime').textContent = fmtTime(video.currentTime) + ' / ' + fmtTime(video.duration);
    const ma = document.getElementById('bgAudio');
    if (ma && !ma.paused) ma.currentTime = video.currentTime;
  });
  video.addEventListener('ended', () => vpNext());
}

function bindAudioEvents() {
  const audio = document.getElementById('mainAudio');
  if (!audio) return;
  audio.volume = localStorage.getItem('player-volume') ? parseFloat(localStorage.getItem('player-volume')) : 1;
  const vpPlayBtn = document.getElementById('vpPlayBtn');
  if (vpPlayBtn) vpPlayBtn.querySelector('.mi').textContent = 'play_arrow';

  audio.addEventListener('play', () => { if (vpPlayBtn) vpPlayBtn.querySelector('.mi').textContent = 'pause'; document.getElementById('vpLoading').style.display = 'none'; });
  audio.addEventListener('pause', () => { if (vpPlayBtn) vpPlayBtn.querySelector('.mi').textContent = 'play_arrow'; });
  audio.addEventListener('waiting', () => { document.getElementById('vpLoading').style.display = 'block'; });
  audio.addEventListener('canplay', () => { document.getElementById('vpLoading').style.display = 'none'; });
  audio.addEventListener('loadedmetadata', () => {
    document.getElementById('vpLoading').style.display = 'none';
    document.getElementById('vpProgress').max = audio.duration;
    const q = document.getElementById('playerQuality');
    if (q) {
      const kbps = audio.duration ? (document.querySelector('audio source')?.duration * 128) : '';
      q.textContent = audio.duration ? (Math.round(audio.duration) + 's') : '';
    }
  });
  audio.addEventListener('timeupdate', () => {
    if (!audio.duration) return;
    document.getElementById('vpProgress').value = audio.currentTime;
    document.getElementById('vpTime').textContent = fmtTime(audio.currentTime) + ' / ' + fmtTime(audio.duration);
  });
  audio.addEventListener('ended', () => vpNext());
}

function vpPlayPause() {
  const el = playerType === 'video' ? document.getElementById('mainVideo') : document.getElementById('mainAudio');
  if (!el) return;
  el.paused ? el.play() : el.pause();
}

function vpSeek(val) {
  const el = playerType === 'video' ? document.getElementById('mainVideo') : document.getElementById('mainAudio');
  if (el) el.currentTime = parseFloat(val);
}

function vpSetVolume(val) {
  const v = parseFloat(val) / 100;
  const video = document.getElementById('mainVideo');
  const audio = document.getElementById('mainAudio');
  if (video) video.volume = v;
  if (audio) audio.volume = v;
  localStorage.setItem('player-volume', v);
}

function vpFullscreen() {
  const container = document.querySelector('.vp-container');
  if (!container) return;
  if (document.fullscreenElement) document.exitFullscreen();
  else container.requestFullscreen();
}

function vpNext() {
  if (queueIdx >= 0 && queueIdx < playerQueue.length - 1) {
    openPlayer(playerQueue[queueIdx + 1]);
  }
}

// ===== 键盘快捷键 =====
document.addEventListener('keydown', e => {
  if (!playerCurrent) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  const el = playerType === 'video' ? document.getElementById('mainVideo') : document.getElementById('mainAudio');
  if (!el) return;

  switch(e.key) {
    case ' ': case 'k': e.preventDefault(); vpPlayPause(); break;
    case 'ArrowLeft': el.currentTime = Math.max(0, el.currentTime - (e.shiftKey ? 30 : 5)); break;
    case 'ArrowRight': el.currentTime = Math.min(el.duration || Infinity, el.currentTime + (e.shiftKey ? 30 : 5)); break;
    case 'ArrowUp': el.volume = Math.min(1, el.volume + 0.1); document.getElementById('vpVolume').value = Math.round(el.volume*100); localStorage.setItem('player-volume', el.volume); break;
    case 'ArrowDown': el.volume = Math.max(0, el.volume - 0.1); document.getElementById('vpVolume').value = Math.round(el.volume*100); localStorage.setItem('player-volume', el.volume); break;
    case 'f': vpFullscreen(); break;
    case 'm': el.muted = !el.muted; break;
    case 'n': vpNext(); break;
  }
});

// ===== 迷你播放器 =====
function startMiniPlayer(name, url, type) {
  miniActive = true;
  document.getElementById('miniPlayer').style.display = 'block';
  document.getElementById('miniTitle').textContent = name;
  const audio = document.getElementById('bgAudio');
  const video = document.getElementById('bgVideo');
  video.style.display = 'none'; video.pause();
  audio.style.display = 'none'; audio.pause();
  audio.src = url;
  audio.play().catch(() => {});
  syncMiniWith(audio);
}

function syncMiniWith(el) {
  el.ontimeupdate = () => {
    if (!el.duration) return;
    document.getElementById('miniProgress').max = el.duration;
    document.getElementById('miniProgress').value = el.currentTime;
    document.getElementById('miniTime').textContent = fmtTime(el.currentTime);
  };
  el.onended = () => { closeMiniPlayer(); };
  el.onplay = () => { document.getElementById('miniPlayBtn').querySelector('.mi').textContent = 'pause'; };
  el.onpause = () => { document.getElementById('miniPlayBtn').querySelector('.mi').textContent = 'play_arrow'; };
}

function miniTogglePlay() {
  const el = document.getElementById('bgAudio');
  el.paused ? el.play() : el.pause();
}

function miniSeek(val) { document.getElementById('bgAudio').currentTime = val; }

function closeMiniPlayer() {
  document.getElementById('bgAudio').pause();
  document.getElementById('bgVideo').pause();
  document.getElementById('miniPlayer').style.display = 'none';
  miniActive = false;
  playerCurrent = null;
}

function closePlayer() {
  document.getElementById('bgAudio').pause();
  document.getElementById('bgVideo').pause();
  document.getElementById('playerView').style.display = 'none';
  document.getElementById('playerContent').innerHTML = '';
  document.getElementById('playerShelf').style.display = '';
  playerCurrent = null;
  document.getElementById('miniPlayer').style.display = 'none';
  miniActive = false;
  loadPlayer();
}

function fmtTime(s) {
  if (!isFinite(s)) return '00:00';
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return String(m).padStart(2,'0') + ':' + String(sec).padStart(2,'0');
}

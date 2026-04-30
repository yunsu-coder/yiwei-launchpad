// ===== 播放器模块 =====
let playerCurrent = null, playerType = null, playerSpeed = 1;
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
    el.innerHTML = files.map(f => {
      const icon = icons[f.name.split('.').pop().toLowerCase()] || '🎬';
      return `<div class="file-card" onclick="openPlayer('${escAttr(f.relPath || f.name)}')">
        <div class="file-card-preview" style="font-size:2.5rem;">${icon}</div>
        <div class="file-card-name">${escHtml(f.name)}</div>
        <div class="file-card-size">${sz(f.size)}</div>
      </div>`;
    }).join('');
    // 设置队列
    playerQueue = files.map(f => f.relPath || f.name);
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
  playerSpeed = 1;

  if (playerType === 'video') renderVideoPlayer(url, name);
  else renderAudioPlayer(url, name);
  startMiniPlayer(name, url, playerType);
}

function renderVideoPlayer(url, name) {
  const content = document.getElementById('playerContent');
  content.innerHTML = `
    <div class="vp-container">
      <video id="mainVideo" src="${url}" preload="auto" style="max-width:100%;max-height:60vh;border-radius:6px 6px 0 0;display:block;width:100%;cursor:pointer;"></video>
      <div class="vp-controls" id="vpControls">
        <button class="vp-btn" onclick="vpPlayPause()" id="vpPlayBtn"><span class="mi">play_arrow</span></button>
        <span id="vpTime" class="vp-time">00:00 / 00:00</span>
        <input type="range" id="vpProgress" class="vp-progress" value="0" min="0" max="100" oninput="vpSeek(this.value)" title="进度">
        <span class="vp-speed" onclick="cycleSpeed()" title="倍速">1×</span>
        <input type="range" id="vpVolume" class="vp-volume" value="100" min="0" max="100" oninput="vpSetVolume(this.value)" title="音量">
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
      <audio id="mainAudio" src="${url}" preload="auto" style="display:none;"></audio>
      <div style="display:flex;align-items:center;gap:.8rem;max-width:500px;margin:1rem auto;">
        <button class="vp-btn" onclick="vpPlayPause()" id="vpPlayBtn"><span class="mi">play_arrow</span></button>
        <input type="range" id="vpProgress" class="vp-progress" value="0" min="0" max="100" oninput="vpSeek(this.value)" style="flex:1;">
        <button class="vp-btn" onclick="vpNext()"><span class="mi">skip_next</span></button>
      </div>
      <div style="display:flex;align-items:center;justify-content:center;gap:.8rem;margin-top:.5rem;">
        <span id="vpTime" class="vp-time">00:00 / 00:00</span>
        <span class="vp-speed" onclick="cycleSpeed()" title="倍速">1×</span>
        <input type="range" id="vpVolume" class="vp-volume" value="100" min="0" max="100" oninput="vpSetVolume(this.value)" title="音量">
      </div>
    </div>`;
  bindAudioEvents();
  document.getElementById('mainAudio').play();
}

function bindVideoEvents() {
  const video = document.getElementById('mainVideo');
  if (!video) return;
  video.playbackRate = playerSpeed;
  video.volume = localStorage.getItem('player-volume') ? parseFloat(localStorage.getItem('player-volume')) : 1;
  document.getElementById('vpVolume').value = Math.round(video.volume * 100);
  const vpPlayBtn = document.getElementById('vpPlayBtn');
  vpPlayBtn.querySelector('.mi').textContent = 'play_arrow';

  video.addEventListener('click', () => vpPlayPause());
  video.addEventListener('play', () => { vpPlayBtn.querySelector('.mi').textContent = 'pause'; });
  video.addEventListener('pause', () => { vpPlayBtn.querySelector('.mi').textContent = 'play_arrow'; });
  video.addEventListener('loadedmetadata', () => {
    document.getElementById('vpProgress').max = video.duration;
  });
  video.addEventListener('timeupdate', () => {
    if (!video.duration) return;
    document.getElementById('vpProgress').value = video.currentTime;
    document.getElementById('vpTime').textContent = fmtTime(video.currentTime) + ' / ' + fmtTime(video.duration);
    // 同步迷你播放器
    const ma = document.getElementById('bgAudio');
    if (ma && !ma.paused) ma.currentTime = video.currentTime;
  });
  video.addEventListener('ended', () => vpNext());
}

function bindAudioEvents() {
  const audio = document.getElementById('mainAudio');
  if (!audio) return;
  audio.playbackRate = playerSpeed;
  audio.volume = localStorage.getItem('player-volume') ? parseFloat(localStorage.getItem('player-volume')) : 1;
  const vpPlayBtn = document.getElementById('vpPlayBtn');
  if (vpPlayBtn) { vpPlayBtn.querySelector('.mi').textContent = 'play_arrow'; }

  audio.addEventListener('play', () => { if (vpPlayBtn) vpPlayBtn.querySelector('.mi').textContent = 'pause'; });
  audio.addEventListener('pause', () => { if (vpPlayBtn) vpPlayBtn.querySelector('.mi').textContent = 'play_arrow'; });
  audio.addEventListener('loadedmetadata', () => {
    document.getElementById('vpProgress').max = audio.duration;
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

function cycleSpeed() {
  const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
  const idx = speeds.indexOf(playerSpeed);
  playerSpeed = speeds[(idx + 1) % speeds.length];
  const el = playerType === 'video' ? document.getElementById('mainVideo') : document.getElementById('mainAudio');
  if (el) el.playbackRate = playerSpeed;
  const label = document.querySelector('.vp-speed');
  if (label) label.textContent = playerSpeed + '×';
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

function togglePiP() {
  const video = document.getElementById('mainVideo');
  if (!video) return;
  if (document.pictureInPictureElement) document.exitPictureInPicture();
  else video.requestPictureInPicture().catch(() => {});
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
    case 'p': togglePiP(); break;
    case '>': case '.': cycleSpeed(); break;
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

function miniSeek(val) {
  document.getElementById('bgAudio').currentTime = val;
}

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
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return String(m).padStart(2,'0') + ':' + String(sec).padStart(2,'0');
}

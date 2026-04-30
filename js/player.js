// ===== 播放器模块 =====
let playerCurrent = null;
let playerType = null; // 'video' | 'audio'
let miniActive = false;

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
      const ext = f.name.split('.').pop().toLowerCase();
      return `<div class="file-card" onclick="openPlayer('${escAttr(f.relPath || f.name)}')">
        <div class="file-card-preview" style="font-size:2.5rem;">${icons[ext]||'🎬'}</div>
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
  document.getElementById('playerShelf').style.display = 'none';
  document.getElementById('playerEmpty').style.display = 'none';
  document.getElementById('playerView').style.display = 'block';
  document.getElementById('playerTitle').textContent = name;
  const content = document.getElementById('playerContent');
  const url = '/api/view/' + encodeURIComponent(name);
  if (playerType === 'video') {
    content.innerHTML = `<video id="mainVideo" controls autoplay style="max-width:100%;max-height:65vh;border-radius:6px;" src="${url}"></video>`;
  } else {
    content.innerHTML = `<div style="padding:3rem;font-size:4rem;">🎵</div>
      <audio id="mainAudio" controls autoplay style="width:100%;max-width:500px;" src="${url}"></audio>`;
  }
  startMiniPlayer(name, url, playerType);
}

function closePlayer() {
  document.getElementById('playerView').style.display = 'none';
  document.getElementById('playerContent').innerHTML = '';
  document.getElementById('playerShelf').style.display = '';
  playerCurrent = null;
  loadPlayer();
}

// ===== 迷你播放器 =====
function startMiniPlayer(name, url, type) {
  miniActive = true;
  document.getElementById('miniPlayer').style.display = 'block';
  document.getElementById('miniTitle').textContent = name;
  const audio = document.getElementById('bgAudio');
  const video = document.getElementById('bgVideo');
  if (type === 'audio') {
    audio.src = url; audio.style.display = 'none';
    video.style.display = 'none'; video.pause();
    audio.play().catch(() => {});
    syncMiniWith(audio);
  } else {
    video.src = url; video.style.display = 'none';
    audio.style.display = 'none'; audio.pause();
    // 迷你播放器用音频轨道（后台播放）
    audio.src = url; audio.currentTime = video.currentTime || 0;
    audio.play().catch(() => {});
    syncMiniWith(audio);
  }
}

function syncMiniWith(el) {
  el.ontimeupdate = () => {
    if (!el.duration) return;
    document.getElementById('miniProgress').max = el.duration;
    document.getElementById('miniProgress').value = el.currentTime;
    const m = Math.floor(el.currentTime / 60), s = Math.floor(el.currentTime % 60);
    document.getElementById('miniTime').textContent = String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
  };
  el.onended = () => { closeMiniPlayer(); };
}

function miniTogglePlay() {
  const el = document.getElementById('bgAudio');
  const btn = document.getElementById('miniPlayBtn').querySelector('.mi');
  if (el.paused) { el.play(); btn.textContent = 'pause'; }
  else { el.pause(); btn.textContent = 'play_arrow'; }
}

function miniSeek(val) {
  document.getElementById('bgAudio').currentTime = val;
}

function closeMiniPlayer() {
  document.getElementById('bgAudio').pause();
  document.getElementById('bgVideo').pause();
  document.getElementById('miniPlayer').style.display = 'none';
  miniActive = false;
}

function togglePiP() {
  const video = document.getElementById('mainVideo');
  if (!video) return;
  if (document.pictureInPictureElement) {
    document.exitPictureInPicture();
  } else {
    video.requestPictureInPicture().catch(() => {});
  }
}

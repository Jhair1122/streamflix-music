const API_BASE = 'https://streamflix-music.onrender.com';   // ← Cambia por tu URL real

let allSongs     = [];
let nowPlayingId = null;
let searchQuery  = '';
let activeGenre  = null;

let audioCtx     = null;
let analyser     = null;
let sourceNode   = null;
let sourceLinked = false;
let visRaf       = null;

const $ = id => document.getElementById(id);
function esc(s){ return (s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])) }
function txt(id,v){ const e=$(id); if(e) e.textContent=v }

function toast(msg, color=''){
  const t=$('toast');
  t.textContent=msg;
  t.style.borderColor=color||'rgba(167,139,250,0.25)';
  t.classList.add('show');
  clearTimeout(t._to);
  t._to=setTimeout(()=>t.classList.remove('show'),2600);
}

const GENRE_EMOJI = {
  'Pop':'🎤','Electrónica':'🎛️','Anime':'⛩️','Rock':'🎸',
  'Latino':'💃','Alternativo':'🌊','Trap':'🎧','Balada':'🎻','J-Pop':'🎌','Phonk':'💜','default':'🎵'
};
const GENRE_COLORS = {
  'Pop':['#ec4899','#f472b6'],
  'Electrónica':['#6366f1','#a78bfa'],
  'Anime':['#f59e0b','#fbbf24'],
  'Rock':['#ef4444','#f87171'],
  'Latino':['#10b981','#34d399'],
  'Alternativo':['#0ea5e9','#38bdf8'],
  'Trap':['#8b5cf6','#a78bfa'],
  'Balada':['#f97316','#fb923c'],
  'J-Pop':['#ec4899','#f472b6'],
  'Phonk':['#8b5cf6','#a78bfa'],
  'default':['#6b7280','#9ca3af']
};
function genreEmoji(g){ return GENRE_EMOJI[g]||GENRE_EMOJI.default }
function genreGradient(g){ const c=GENRE_COLORS[g]||GENRE_COLORS.default; return `linear-gradient(135deg,${c[0]},${c[1]})` }

async function loadSongs() {
  const res = await fetch(`${API_BASE}/api/songs`);
  const data = await res.json();
  allSongs = data.data || [];
  txt('hsSongs', allSongs.length);
  buildGenrePills();
  renderCatalog();
}

function buildGenrePills() {
  const genres = [...new Set(allSongs.map(s => s.genero))].sort();
  const el = $('genrePills');
  if (!el) return;
  el.innerHTML = `<button class="gpill active" onclick="filterGenre(this,null)">Todos</button>`
    + genres.map(g => `<button class="gpill" onclick="filterGenre(this,'${esc(g)}')">${esc(g)}</button>`).join('');
}
function filterGenre(btn, genre) {
  document.querySelectorAll('.gpill').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  activeGenre = genre;
  renderCatalog();
}
function onSearch() {
  searchQuery = $('searchInput').value.toLowerCase();
  renderCatalog();
}
function renderCatalog() {
  let songs = allSongs;
  if (activeGenre) songs = songs.filter(s => s.genero === activeGenre);
  if (searchQuery) songs = songs.filter(s => s.titulo.toLowerCase().includes(searchQuery) || s.artista.toLowerCase().includes(searchQuery));
  txt('catalogCount', songs.length + ' canciones');
  renderCards(songs, 'catalogCards', 'No se encontraron canciones.');
}

function songCard(s) {
  const playing = nowPlayingId === s.id;
  let coverContent = '';
  if (s.url_imagen) {
    coverContent = `<img src="${esc(s.url_imagen)}" alt="${esc(s.titulo)}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;">`;
  } else {
    coverContent = genreEmoji(s.genero);
  }
  return `<div class="song-card${playing?' playing':''}" data-id="${s.id}" onclick="playSong(event, ${s.id})">
    <div class="card-cover">
      <div class="card-cover-inner" style="background:${genreGradient(s.genero)}">${coverContent}</div>
      ${playing ? '<div class="now-playing-badge">Reproduciendo</div>' : ''}
    </div>
    <div class="card-body">
      <div class="card-title" title="${esc(s.titulo)}">${esc(s.titulo)}</div>
      <div class="card-artist" title="${esc(s.artista)}">${esc(s.artista)}</div>
      <div class="card-genre">${esc(s.genero)}</div>
      <div class="card-attrs">
        <span class="card-attr">⚡${(s.energia*100).toFixed(0)}%</span>
        <span class="card-attr">💃${(s.bailabilidad*100).toFixed(0)}%</span>
        <span class="card-attr">🔥${s.popularidad}</span>
      </div>
      <div class="card-actions" onclick="event.stopPropagation()">
        <button class="cta" onclick="showLoginAlert()">🤍</button>
        <button class="cta" onclick="showLoginAlert()">☆</button>
        <button class="cta play-btn" onclick="playSong(event,${s.id});event.stopPropagation()">▶ Play</button>
      </div>
    </div>
  </div>`;
}

function renderCards(songs, containerId, emptyMsg) {
  const el = $(containerId); if (!el) return;
  if (!songs || !songs.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">🎵</div><p>${emptyMsg}</p></div>`;
    return;
  }
  el.innerHTML = songs.map(s => songCard(s)).join('');
}

// ── Reproductor (completo, igual que en script.js) ──
function playSong(e, songId) {
  if (e && e.stopPropagation) e.stopPropagation();
  const song = allSongs.find(s => s.id === songId);
  if (!song) return;

  nowPlayingId = songId;
  txt('plTitle', song.titulo);
  txt('plArtist', song.artista);

  updateDiscCover($('plDiscCover'), song);
  if (!$('expandedPlayer').classList.contains('hidden')) {
    updateDiscCover($('expDiscCover'), song);
    $('expDisc').classList.toggle('spinning', false);
    $('expPlayPauseBtn').textContent = '▶';
    txt('expTitle', song.titulo);
    txt('expArtist', song.artista);
  }

  const audio = $('audioEl');
  if (song.url_preview) {
    audio.src = song.url_preview;
    audio.load();
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(()=>{});
    }
    audio.play().then(() => {
      $('plDisc').classList.add('spinning');
      updatePlayPauseBtn(true);
      if (sourceLinked) startVisRaf(); else startIdleVisualizer();
      ensureAudioContext(audio);
      toast('▶ ' + song.titulo);
    }).catch(err => {
      console.warn('play error:', err);
      toast('⚠️ No se pudo reproducir');
    });
  } else {
    audio.pause();
    audio.removeAttribute('src');
    $('plDisc').classList.remove('spinning');
    updatePlayPauseBtn(false);
    toast('⚠️ Sin archivo de audio');
  }
  refreshCardHighlight();
}

function updateDiscCover(coverEl, song) {
  coverEl.innerHTML = '';
  coverEl.style.background = genreGradient(song.genero);
  if (song.url_imagen) {
    const img = document.createElement('img');
    img.src = song.url_imagen;
    img.alt = song.titulo;
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    img.style.borderRadius = '50%';
    coverEl.appendChild(img);
  } else {
    coverEl.textContent = genreEmoji(song.genero);
  }
}

function playPrevSong() { /* igual */ }
function playNextSong() { /* igual */ }
function skipBackward() { /* igual */ }
function skipForward() { /* igual */ }
function ensureAudioContext(audioEl) { /* igual */ }
function refreshCardHighlight() { /* igual */ }
function togglePlayPause() { /* igual */ }
function updatePlayPauseBtn(playing) { /* igual */ }
function startVisRaf() { /* igual */ }
function stopVisRaf() { /* igual */ }
function startIdleVisualizer() { /* igual */ }
function updateProgress() { /* igual */ }
function seekProgress(e) { /* igual */ }
function seekProgressExpanded(e) { /* igual */ }
function fmtTime(s) { /* igual */ }
function setVolume(val) { /* igual */ }
function onAudioEnded() { /* igual */ }
function openExpandedPlayer() { /* igual */ }
function closeExpandedPlayer() { /* igual */ }
function showLoginAlert() { toast('🔒 Inicia sesión para usar esta función'); }

window.addEventListener('load', async () => {
  await loadSongs();
  const vizEl = $('audioVisualizer');
  if (vizEl) vizEl.innerHTML = Array.from({ length: 14 }, (_, i) => `<div class="vis-bar idle" style="--d:${i * 0.06}s"></div>`).join('');
  const audio = $('audioEl');
  if (audio) {
    audio.addEventListener('timeupdate', updateProgress);
    audio.addEventListener('ended', onAudioEnded);
    audio.addEventListener('play', () => {
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
      $('plDisc')?.classList.add('spinning');
      updatePlayPauseBtn(true);
      $('expDisc')?.classList.add('spinning');
      $('expPlayPauseBtn').textContent = '⏸';
      if (sourceLinked) startVisRaf(); else startIdleVisualizer();
    });
    audio.addEventListener('pause', () => {
      $('plDisc')?.classList.remove('spinning');
      updatePlayPauseBtn(false);
      $('expDisc')?.classList.remove('spinning');
      $('expPlayPauseBtn').textContent = '▶';
      startIdleVisualizer();
    });
  }
  const volRange = $('volumeRange');
  if (volRange) { volRange.value = 0.8; setVolume(0.8); }
  $('playerBar').classList.remove('hidden');
});

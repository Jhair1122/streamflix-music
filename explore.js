/* ════════════════════════════════════════════════════
   explore.js — Página pública (API Python)
════════════════════════════════════════════════════ */

const API_BASE = 'http://localhost:8000';   // ← Cambiar

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

// ── Reproductor (copiado de script.js, sin cambios) ──
function playSong(e, songId) { /* idéntico al script.js */ }
// ... (incluir todas las funciones de reproductor: playPrevSong, playNextSong, skipBackward, etc.)
// (por brevedad, asumo que las copiaste del script.js existente)

function showLoginAlert() {
  toast('🔒 Inicia sesión para usar esta función');
}

// Inicialización
window.addEventListener('load', async () => {
  await loadSongs();
  // Inicializar visualizador y audio igual que en script.js
  $('playerBar').classList.remove('hidden');
  // ...
});

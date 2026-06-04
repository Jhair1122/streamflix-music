/* ════════════════════════════════════════════════════
   SoundMind — script.js (v9 Flask API)
   - Todas las operaciones de BD e IA se hacen en backend.
   - El frontend solo consume la API REST.
════════════════════════════════════════════════════ */

const API_BASE = 'https://streamflix-music.onrender.com';   // ← Cambia por tu URL real

/* ── State ── */
let currentUser  = null;
let allSongs     = [];
let myInter      = [];
let allInter     = [];   // no se usa globalmente
let nowPlayingId = null;
let activeGenre  = null;
let searchQuery  = '';
let playlistContext = 'global';   // 'global', 'favorites', 'likes'

/* Web Audio */
let audioCtx     = null;
let analyser     = null;
let sourceNode   = null;
let sourceLinked = false;
let visRaf       = null;
let recognition  = null;
let isListening  = false;

// ── Variables de nuevas funciones ──
let sleepTimer = null;
let queue = [];

/* ── Helpers DOM ── */
const $ = id => document.getElementById(id);
function esc(s){ return (s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])) }
function txt(id,v){ const e=$(id); if(e) e.textContent=v }
function html(id,v){ const e=$(id); if(e) e.innerHTML=v }

function toast(msg, color=''){
  const t=$('toast');
  t.textContent=msg;
  t.style.borderColor=color||'rgba(167,139,250,0.25)';
  t.classList.add('show');
  clearTimeout(t._to);
  t._to=setTimeout(()=>t.classList.remove('show'),2600);
}

/* ── Genre helpers ── */
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

/* ═══════════════════ SESSION ══════════════════ */
const SESSION_KEY = 'soundmind_user';
function saveSession(user){ localStorage.setItem(SESSION_KEY, JSON.stringify(user)) }
function loadSession(){ try{ return JSON.parse(localStorage.getItem(SESSION_KEY)||'null') }catch(_){ return null } }
function clearSession(){ localStorage.removeItem(SESSION_KEY) }

function checkSession(){
  const saved = loadSession();
  if (!saved) { window.location.href = 'explore.html'; return false; }
  currentUser = saved;
  return true;
}

/* ═══════════════════ BOOT ══════════════════ */
async function bootApp(){
  if (!checkSession()) return;
  $('app').classList.remove('hidden');
  $('playerBar').classList.remove('hidden');

  const initials=(currentUser.nombre||currentUser.username).slice(0,2).toUpperCase();
  txt('userAvatar',initials);
  txt('userName',currentUser.nombre||currentUser.username);
  txt('heroName',currentUser.nombre||currentUser.username);

  try {
    const [songsRes, myRes] = await Promise.all([
      fetch(`${API_BASE}/api/songs`).then(r=>r.json()),
      fetch(`${API_BASE}/api/my-interactions?user_id=${currentUser.id}`).then(r=>r.json())
    ]);
    allSongs = songsRes.data || [];
    myInter = myRes.data || [];
    allInter = [];   // no se usa
  } catch (err) {
    console.error('Error cargando datos:', err);
    toast('⚠️ Error de conexión. Algunos datos pueden no estar actualizados.');
    myInter = [];
    allInter = [];
  }
  buildGenrePills();
  renderAll();
  renderWeekly();
  updateQueue();
  showPage('home');
  initVoiceSearch();
}

/* ═══════════════════ LOGOUT ══════════════════ */
async function doLogout(){
  currentUser=null; myInter=[]; allInter=[]; nowPlayingId=null;
  clearSession();
  stopVisRaf();
  const audio=$('audioEl');
  if(audio){ audio.pause(); audio.removeAttribute('src') }
  $('plDisc')?.classList.remove('spinning');
  updatePlayPauseBtn(false);
  resetEnergyEffect();
  window.location.href = 'explore.html';
}

/* ═══════════════════ VOICE SEARCH (local) ══════════════════ */
function initVoiceSearch(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { const vb=$('voiceBtn'); if(vb) vb.style.opacity='.35'; return; }
  recognition = new SR();
  recognition.lang = 'es-ES';
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onstart = () => {
    isListening = true;
    $('voiceBtn').classList.add('listening');
    $('voiceOverlay').classList.add('show');
    txt('voiceTranscript','Escuchando… di "buscar" para iniciar la búsqueda');
  };
  recognition.onend = () => {
    isListening = false;
    $('voiceBtn').classList.remove('listening');
    $('voiceOverlay').classList.remove('show');
  };
  recognition.onerror = (e) => {
    isListening = false;
    $('voiceBtn').classList.remove('listening');
    $('voiceOverlay').classList.remove('show');
    toast('⚠️ Micrófono: ' + e.error);
  };
  recognition.onresult = (e) => {
    let transcript = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      transcript += e.results[i][0].transcript;
    }
    txt('voiceTranscript', '"' + transcript + '"');

    const keyword = 'buscar';
    const lowerTranscript = transcript.toLowerCase();
    const keywordIndex = lowerTranscript.lastIndexOf(keyword);

    if (keywordIndex !== -1) {
      let rawQuery = transcript.substring(0, keywordIndex).trim();
      if (rawQuery) {
        const bestMatch = findBestMatch(rawQuery, allSongs);
        const finalQuery = bestMatch || rawQuery;
        searchQuery = finalQuery.toLowerCase();
        const si = $('searchInput');
        if (si) si.value = finalQuery;
        renderCatalog();
        toast(bestMatch ? '🎤 Buscando: ' + bestMatch + ' (corregido)' : '🎤 Buscando: ' + rawQuery);
      }
      recognition.stop();
    }
  };
}

function toggleVoice(){
  if (!recognition) { toast('⚠️ Voz no disponible en este navegador'); return; }
  if (isListening) { recognition.stop(); }
  else {
    try { recognition.start(); } catch(e) {
      recognition.stop();
      setTimeout(() => recognition.start(), 100);
    }
  }
}

function levenshtein(a, b) { /* igual que antes */ }
function findBestMatch(query, songs) { /* igual que antes */ }

/* ═══════════════════ RENDER ALL ══════════════════ */
function renderAll(){
  updateHeroStats();
  updateBadges();
  renderHomePopular();
  renderHomeRec();
  renderCatalog();
  renderFavorites();
  renderLikes();
}

function updateHeroStats(){
  txt('hsSongs',allSongs.length);
  txt('hsLikes',myInter.filter(i=>i.es_like).length);
  txt('hsFavs', myInter.filter(i=>i.es_favorito).length);
}
function updateBadges(){
  const likes=myInter.filter(i=>i.es_like).length;
  const favs =myInter.filter(i=>i.es_favorito).length;
  const bl=$('badge-like'),bf=$('badge-fav');
  if(likes>0){bl.textContent=likes;bl.classList.remove('hidden')}else bl.classList.add('hidden');
  if(favs>0) {bf.textContent=favs; bf.classList.remove('hidden')}else bf.classList.add('hidden');
}

/* ── Song Card ── */
function songCard(s, context = 'global'){
  const inter  =myInter.find(i=>i.cancion_id===s.id);
  const liked  =inter&&inter.es_like;
  const faved  =inter&&inter.es_favorito;
  const playing=nowPlayingId===s.id;
  const ctxParam = context === 'global' ? '' : `, '${context}'`;

  let coverContent = '';
  if (s.url_imagen) {
    coverContent = `<img src="${esc(s.url_imagen)}" alt="${esc(s.titulo)}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;">`;
  } else {
    coverContent = genreEmoji(s.genero);
  }

  return `<div class="song-card${liked?' liked':''}${faved?' faved':''}${playing?' playing':''}"
            data-id="${s.id}"
            onclick="playSong(event, ${s.id}${ctxParam})">
    <div class="card-cover">
      <div class="card-cover-inner" style="background:${genreGradient(s.genero)}">
        ${coverContent}
      </div>
      ${playing?`<div class="now-playing-badge">Reproduciendo</div>`:''}
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
        <button class="cta${liked?' liked-btn':''}" onclick="toggleLike(event,${s.id})">${liked?'❤️':'🤍'}</button>
        <button class="cta${faved?' faved-btn':''}" onclick="toggleFav(event,${s.id})">${faved?'⭐':'☆'}</button>
        <button class="cta play-btn" onclick="playSong(event,${s.id}${ctxParam}); event.stopPropagation()">▶ Play</button>
      </div>
    </div>
  </div>`;
}

function renderCards(songs,containerId,emptyMsg='No hay canciones aquí aún.', context = 'global'){
  const el=$(containerId); if(!el) return;
  if(!songs||!songs.length){
    el.innerHTML=`<div class="empty-state"><div class="empty-icon">🎵</div><p>${emptyMsg}</p></div>`;
    return;
  }
  el.innerHTML=songs.map(s => songCard(s, context)).join('');
}

/* ── Populars (API) ── */
async function renderHomePopular() {
  try {
    const res = await fetch(`${API_BASE}/api/popular`);
    const data = await res.json();
    if (data.popular && data.popular.length > 0) {
      renderCards(data.popular, 'homePopCards');
    } else {
      renderCards([], 'homePopCards', 'Aún no hay suficientes interacciones en la comunidad para mostrar populares.');
    }
  } catch(e) {
    renderCards([], 'homePopCards', 'Error al cargar populares.');
  }
}

/* ── Home Rec (IA) ── */
async function renderHomeRec() {
  try {
    const res = await fetch(`${API_BASE}/api/recommend?user_id=${currentUser.id}`);
    const data = await res.json();
    const recSongs = data.recommendations || [];
    renderCards(recSongs, 'homeRecCards', 'Da likes a canciones para recibir recomendaciones personalizadas.', 'global');
  } catch(e) {
    renderCards([], 'homeRecCards', 'Error al obtener recomendaciones.');
  }
}

/* ── Catalog ── */
function buildGenrePills(){
  const genres=[...new Set(allSongs.map(s=>s.genero))].sort();
  const el=$('genrePills'); if(!el) return;
  el.innerHTML=`<button class="gpill active" onclick="filterGenre(this,null)">Todos</button>`
    +genres.map(g=>`<button class="gpill" onclick="filterGenre(this,'${esc(g)}')">${esc(g)}</button>`).join('');
}
function filterGenre(btn,genre){
  document.querySelectorAll('.gpill').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  activeGenre=genre;
  renderCatalog();
}
function onSearch(){
  searchQuery=$('searchInput').value.toLowerCase();
  renderCatalog();
}
function renderCatalog(){
  let songs = allSongs;
  if (activeGenre) songs = songs.filter(s => s.genero === activeGenre);
  if (searchQuery) songs = songs.filter(s => s.titulo.toLowerCase().includes(searchQuery) || s.artista.toLowerCase().includes(searchQuery));
  txt('catalogCount', songs.length + ' canciones');
  renderCards(songs, 'catalogCards', 'No se encontraron canciones.', 'global');
}

/* ── Library ── */
function getFavoriteSongs(){
  const ids=new Set(myInter.filter(i=>i.es_favorito).map(i=>i.cancion_id));
  return allSongs.filter(s=>ids.has(s.id));
}
function getLikedSongs(){
  const ids=new Set(myInter.filter(i=>i.es_like).map(i=>i.cancion_id));
  return allSongs.filter(s=>ids.has(s.id));
}
function renderFavorites(){
  renderCards(getFavoriteSongs(),'favCards','Aún no tienes favoritos. Haz clic en ☆ en cualquier canción.', 'favorites');
}
function renderLikes(){
  renderCards(getLikedSongs(),'likeCards','Aún no tienes likes. Haz clic en 🤍 en cualquier canción.', 'likes');
}

/* ═══════════════════ INTERACTIONS (API) ══════════════════ */
async function toggleLike(e, songId) {
  e.stopPropagation();
  const res = await fetch(`${API_BASE}/api/like`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ user_id: currentUser.id, song_id: songId })
  });
  const result = await res.json();
  if (!res.ok) { toast('Error al actualizar like'); return; }

  const existing = myInter.find(i => i.cancion_id === songId);
  if (existing) {
    existing.es_like = result.es_like;
  } else {
    myInter.push({ usuario_id: currentUser.id, cancion_id: songId, es_like: result.es_like, es_favorito: false });
  }
  toast(result.es_like ? '❤️ Like añadido' : 'Like eliminado');
  renderAll();
  checkAchievements();
}

async function toggleFav(e, songId) {
  e.stopPropagation();
  const res = await fetch(`${API_BASE}/api/favorite`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ user_id: currentUser.id, song_id: songId })
  });
  const result = await res.json();
  if (!res.ok) { toast('Error al actualizar favorito'); return; }

  const existing = myInter.find(i => i.cancion_id === songId);
  if (existing) {
    existing.es_favorito = result.es_favorito;
  } else {
    myInter.push({ usuario_id: currentUser.id, cancion_id: songId, es_like: false, es_favorito: result.es_favorito });
  }
  toast(result.es_favorito ? '⭐ Favorito añadido' : 'Favorito eliminado');
  renderAll();
  checkAchievements();
}

/* ═══════════════════ PLAYER (sin cambios) ══════════════════ */
function setPlaylistContext(context){ playlistContext = context; }
function getContextSongs(){
  if (playlistContext === 'favorites') return getFavoriteSongs();
  if (playlistContext === 'likes') return getLikedSongs();
  return allSongs;
}

async function playSong(e, songId, context = null){
  if (e && e.stopPropagation) e.stopPropagation();
  const song = allSongs.find(s => s.id === songId);
  if (!song) return;
  if (context) setPlaylistContext(context);

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
      try { await audioCtx.resume(); } catch(e) {}
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
  applyEnergyEffect(song);
  updateQueue();
}

function updateDiscCover(coverEl, song) { /* igual que antes */ }
function playPrevInContext(){ /* igual que antes */ }
function playNextInContext(){ /* igual que antes */ }
function skipBackward() { /* igual que antes */ }
function skipForward() { /* igual que antes */ }
function ensureAudioContext(audioEl){ /* igual que antes */ }
function refreshCardHighlight(){ /* igual que antes */ }
function togglePlayPause(){ /* igual que antes */ }
function updatePlayPauseBtn(playing){ /* igual que antes */ }
/* Visualizer, Progress, Volumen (igual) */

/* ── onAudioEnded con stats y logros ── */
function onAudioEnded(){
  $('plDisc').classList.remove('spinning');
  updatePlayPauseBtn(false);
  $('expDisc')?.classList.remove('spinning');
  $('expPlayPauseBtn').textContent = '▶';

  if(nowPlayingId){
    const duration = $('audioEl').duration || 0;
    updateStats(nowPlayingId, duration);
    checkAchievements();

    if (queue.length > 0) {
      const nextSong = queue.shift();
      renderQueueUI();
      playSong(null, nextSong.id, playlistContext);
    } else {
      playNextInContext();
    }
  }
}

/* ═══════════════════ NUEVAS FUNCIONES (Discover Weekly, Estadísticas, Logros, Sleep Timer, Efectos, Cola) ══════════════════ */
// (Se mantienen exactamente igual que en la v8 anterior, solo que Discover Weekly ahora llama a /api/weekly)

async function generateWeekly() {
  const res = await fetch(`${API_BASE}/api/weekly?user_id=${currentUser.id}`);
  const data = await res.json();
  return data.weekly || [];
}
// getWeeklyData, saveWeeklyData, renderWeekly, getStats, updateStats, renderProfile, ACHIEVEMENTS, checkAchievements,
// toggleSleepMenu, setSleepTimer, clearSleepTimer, applyEnergyEffect, resetEnergyEffect,
// recursivePlaylistLocal, updateQueue, renderQueueUI, clearQueue, openQueueModal, closeQueue
// (todo este bloque se copia igual de la versión anterior)

/* ═══════════════════ PANEL EXPANDIDO ══════════════════ */
function openExpandedPlayer() { /* igual */ }
function closeExpandedPlayer() { /* igual */ }

/* ═══════════════════ NAVEGACIÓN Y PANEL IA (API) ══════════════════ */
function showPage(name){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const pg=$('page-'+name), nv=$('nav-'+name);
  if(pg) pg.classList.add('active');
  if(nv) nv.classList.add('active');
  if(window.innerWidth<=900) $('sidebar').classList.remove('open');

  if (name === 'weekly') renderWeekly();
  else if (name === 'profile') renderProfile();
  else if (name === 'analysis') renderAnalysis();
}
function toggleSidebar(){ $('sidebar').classList.toggle('open') }

async function renderAnalysis() {
  try {
    const res = await fetch(`${API_BASE}/api/analysis?user_id=${currentUser.id}`);
    const data = await res.json();
    txt('mUsers', data.metrics.users);
    txt('mSongs', data.metrics.songs);
    txt('mInter', data.metrics.interactions);
    txt('mLikes', data.metrics.likes);
    txt('mAcc', data.metrics.accuracy);
    txt('mAvg', data.metrics.avg_likes_per_user);
    // gráfico de géneros
    const sorted = Object.entries(data.genre_chart).sort((a,b) => b[1] - a[1]);
    const maxVal = Math.max(1, ...sorted.map(e => e[1]));
    let html = '';
    sorted.forEach(([genre, count]) => {
      const pct = (count / maxVal) * 100;
      html += `<div class="bar-col">
        <div class="bar-fill" style="height:${pct}%; background:${genreGradient(genre)}"></div>
        <div class="bar-lbl">${genreEmoji(genre)} ${genre}</div>
        <div class="bar-num">${count}</div>
      </div>`;
    });
    if (!html) html = '<p style="color:var(--text2);padding:20px">No tienes suficientes interacciones para mostrar gráfico.</p>';
    $('genreBar').innerHTML = html;
    $('treeViz').textContent = data.tree_rules;
    const cvBody = $('cvBody');
    let rows = '';
    data.cross_validation.forEach(cv => {
      rows += `<tr>
        <td>${cv.fold}</td><td>${cv.train}</td><td>${cv.test}</td>
        <td class="${cv.accuracy>=70?'good':cv.accuracy>=50?'mid':''}">${cv.accuracy}%</td>
        <td>${cv.detected}</td>
      </tr>`;
    });
    cvBody.innerHTML = rows;
  } catch (e) {
    toast('Error al cargar análisis');
  }
}

/* ═══════════════════ INIT ══════════════════ */
window.addEventListener('load', async ()=>{
  if (!loadSession()) { window.location.href = 'explore.html'; return; }
  try {
    const res = await fetch(`${API_BASE}/api/songs`);
    const data = await res.json();
    allSongs = data.data || [];
  } catch(e) {
    allSongs = [];
  }
  // visualizer, audio events, etc. (igual que antes)
  // ...
  await bootApp();
});

document.addEventListener('keydown', e => {
  if (e.key === ' ' && e.target.tagName !== 'INPUT') { e.preventDefault(); togglePlayPause(); }
});

/* ════════════════════════════════════════════════════
   SoundMind — script.js (v17 Spotify-like)
   - Incluye nuevas páginas (Buscar, Playlist detalle, Menú contextual)
   - Todas las funciones previas intactas
════════════════════════════════════════════════════ */

const API_BASE = 'https://streamflix-music.onrender.com';   // ← Cambia por tu URL real

/* ── State ── */
let currentUser  = null;
let allSongs     = [];
let myInter      = [];
let nowPlayingId = null;
let activeGenre  = null;
let searchQuery  = '';
let playlistContext = 'global';   // 'global', 'favorites', 'likes', 'playlist'

/* Web Audio */
let audioCtx     = null;
let analyser     = null;
let sourceNode   = null;
let sourceLinked = false;
let visRaf       = null;
let recognition  = null;
let isListening  = false;

// ── Variables de funciones extra ──
let sleepTimer = null;
let queue = [];
let userPlaylist = [];               // Array de IDs de canciones en la playlist del usuario

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
  'Pop':['#ec4899','#f472b6'], 'Electrónica':['#6366f1','#a78bfa'], 'Anime':['#f59e0b','#fbbf24'],
  'Rock':['#ef4444','#f87171'], 'Latino':['#10b981','#34d399'], 'Alternativo':['#0ea5e9','#38bdf8'],
  'Trap':['#8b5cf6','#a78bfa'], 'Balada':['#f97316','#fb923c'], 'J-Pop':['#ec4899','#f472b6'],
  'Phonk':['#8b5cf6','#a78bfa'], 'default':['#6b7280','#9ca3af']
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
  // Cargar playlist del usuario desde localStorage
  const stored = localStorage.getItem(`playlist_${currentUser.id}`);
  userPlaylist = stored ? JSON.parse(stored) : [];
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
  } catch (err) {
    console.error('Error cargando datos:', err);
    toast('⚠️ Error de conexión. Algunos datos pueden no estar actualizados.');
    myInter = [];
  }
  buildGenrePills();
  renderAll();
  renderWeekly();
  showPage('home');
  initVoiceSearch();
  initChat();
  initStaticSections();   // ← Inicializa las nuevas secciones estáticas
}

/* ═══════════════════ LOGOUT ══════════════════ */
async function doLogout(){
  currentUser=null; myInter=[]; allSongs=[]; nowPlayingId=null;
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

function levenshtein(a, b) {
  const an = a.length, bn = b.length;
  const matrix = Array.from({ length: an + 1 }, () => Array(bn + 1).fill(0));
  for (let i = 0; i <= an; i++) matrix[i][0] = i;
  for (let j = 0; j <= bn; j++) matrix[0][j] = j;
  for (let i = 1; i <= an; i++) {
    for (let j = 1; j <= bn; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[an][bn];
}

function findBestMatch(query, songs) {
  const lowerQuery = query.toLowerCase();
  let bestMatch = null;
  let bestDistance = Infinity;
  for (const song of songs) {
    const title = song.titulo.toLowerCase();
    const artist = song.artista.toLowerCase();
    const distTitle = levenshtein(lowerQuery, title);
    const distArtist = levenshtein(lowerQuery, artist);
    const minDist = Math.min(distTitle, distArtist);
    const maxAllowed = Math.max(title.length, artist.length, lowerQuery.length) * 0.4;
    if (minDist <= maxAllowed && minDist < bestDistance) {
      bestDistance = minDist;
      bestMatch = distTitle < distArtist ? song.titulo : song.artista;
    }
  }
  return bestMatch;
}

/* ═══════════════════ RENDER ALL ══════════════════ */
function renderAll(){
  updateHeroStats();
  updateBadges();
  renderHomePopular();
  renderHomeRec();
  renderCatalog();
  renderPlaylist();
}

function updateHeroStats(){
  txt('hsSongs',allSongs.length);
  txt('hsLikes',myInter.filter(i=>i.es_like).length);
  txt('hsFavs', myInter.filter(i=>i.es_favorito).length);
}
function updateBadges(){
  const bp = $('badge-playlist');
  if (bp) {
    bp.textContent = userPlaylist.length;
    if (userPlaylist.length > 0) bp.classList.remove('hidden');
    else bp.classList.add('hidden');
  }
}

/* ── Song Card (con botón de playlist y menú contextual) ── */
function songCard(s, context = 'global'){
  const inter  =myInter.find(i=>i.cancion_id===s.id);
  const liked  =inter&&inter.es_like;
  const faved  =inter&&inter.es_favorito;
  const playing=nowPlayingId===s.id;
  const ctxParam = context === 'global' ? '' : `, '${context}'`;

  const inPlaylist = userPlaylist.includes(s.id);

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
      <div class="card-actions" onclick="event.stopPropagation()">
        <button class="cta${liked?' liked-btn':''}" onclick="toggleLike(event,${s.id})">${liked?'❤️':'🤍'}</button>
        <button class="cta${faved?' faved-btn':''}" onclick="toggleFav(event,${s.id})">${faved?'⭐':'☆'}</button>
        <button class="cta${inPlaylist?' playlist-btn':''}" onclick="toggleAddToPlaylist(event,${s.id})" title="${inPlaylist?'Quitar de Playlist':'Agregar a Playlist'}">${inPlaylist?'➖':'➕'}</button>
        <button class="cta play-btn" onclick="playSong(event,${s.id}${ctxParam}); event.stopPropagation()">▶ Play</button>
        <button class="cta" onclick="openContextMenu(event,${s.id})" title="Más opciones">⋮</button>
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
function onSearchBig(){
  searchQuery=$('searchInputBig').value.toLowerCase();
  renderCatalog();
}
function renderCatalog(){
  let songs = allSongs;
  if (activeGenre) songs = songs.filter(s => s.genero === activeGenre);
  if (searchQuery) songs = songs.filter(s => s.titulo.toLowerCase().includes(searchQuery) || s.artista.toLowerCase().includes(searchQuery));
  txt('catalogCount', songs.length + ' canciones');
  renderCards(songs, 'catalogCards', 'No se encontraron canciones.', 'global');
}

/* ── Playlist (nueva) ── */
function getPlaylistSongs() {
  return allSongs.filter(s => userPlaylist.includes(s.id));
}

function renderPlaylist() {
  const songs = getPlaylistSongs();
  renderCards(songs, 'playlistCards', 'Tu playlist está vacía. Usa el botón ➕ en cualquier canción para añadirla.', 'playlist');
  updateBadges();
}

function savePlaylist() {
  if (currentUser) {
    localStorage.setItem(`playlist_${currentUser.id}`, JSON.stringify(userPlaylist));
  }
}

async function toggleAddToPlaylist(e, songId) {
  e.stopPropagation();
  const index = userPlaylist.indexOf(songId);
  if (index >= 0) {
    userPlaylist.splice(index, 1);
    toast('🗑️ Canción eliminada de tu Playlist');
  } else {
    userPlaylist.push(songId);
    toast('➕ Canción añadida a tu Playlist');
  }
  savePlaylist();
  renderAll();
  if (document.getElementById('page-playlist').classList.contains('active')) {
    renderPlaylist();
  }
}

/* ═══════════════════ INTERACTIONS (Likes/Favs) ══════════════════ */
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

/* ═══════════════════ PLAYER ══════════════════ */
function setPlaylistContext(context){ playlistContext = context; }
function getContextSongs(){
  if (playlistContext === 'favorites') return getFavoriteSongs();
  if (playlistContext === 'likes') return getLikedSongs();
  if (playlistContext === 'playlist') return getPlaylistSongs();
  return allSongs;
}

function getFavoriteSongs(){
  const ids=new Set(myInter.filter(i=>i.es_favorito).map(i=>i.cancion_id));
  return allSongs.filter(s=>ids.has(s.id));
}
function getLikedSongs(){
  const ids=new Set(myInter.filter(i=>i.es_like).map(i=>i.cancion_id));
  return allSongs.filter(s=>ids.has(s.id));
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

  // Actualizar panel derecho
  updateRightPanel(song);
  // Actualizar sección "Más como..."
  updateMoreLikeSection(song);

  const audio = $('audioEl');
  if (song.url_preview) {
    audio.src = song.url_preview;
    audio.crossOrigin = "anonymous";
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
      if (audio.currentTime > 0 || audio.duration > 0) {
        // ya está sonando, no mostrar error
      } else {
        console.warn('play error:', err);
        toast('⚠️ No se pudo reproducir');
      }
    });
  } else {
    audio.pause(); audio.removeAttribute('src');
    $('plDisc').classList.remove('spinning');
    updatePlayPauseBtn(false);
    toast('⚠️ Sin archivo de audio');
  }
  refreshCardHighlight();
  applyEnergyEffect(song);
  updateQueue();
}

function updateDiscCover(coverEl, song) {
  coverEl.innerHTML = '';
  coverEl.style.background = genreGradient(song.genero);
  if (song.url_imagen) {
    const img = document.createElement('img');
    img.src = song.url_imagen;
    img.alt = song.titulo;
    img.style.width = '100%'; img.style.height = '100%';
    img.style.objectFit = 'cover'; img.style.borderRadius = '50%';
    coverEl.appendChild(img);
  } else { coverEl.textContent = genreEmoji(song.genero); }
}

function playPrevInContext(){
  const list = getContextSongs();
  if (!nowPlayingId || list.length === 0) return;
  const idx = list.findIndex(s => s.id === nowPlayingId);
  const prevIdx = idx > 0 ? idx - 1 : list.length - 1;
  playSong(null, list[prevIdx].id, playlistContext);
}

function playNextInContext(){
  const list = getContextSongs();
  if (!nowPlayingId || list.length === 0) return;
  const idx = list.findIndex(s => s.id === nowPlayingId);
  const nextIdx = idx < list.length - 1 ? idx + 1 : 0;
  playSong(null, list[nextIdx].id, playlistContext);
}

function skipBackward() {
  const audio = $('audioEl');
  if (!audio || !audio.src || audio.src === window.location.href) return;
  audio.currentTime = Math.max(0, audio.currentTime - 15);
  updateProgress();
}

function skipForward() {
  const audio = $('audioEl');
  if (!audio || !audio.src || audio.src === window.location.href) return;
  audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 15);
  updateProgress();
}

function ensureAudioContext(audioEl){
  if(sourceLinked) return;
  try{
    audioCtx=new (window.AudioContext||window.webkitAudioContext)();
    analyser=audioCtx.createAnalyser();
    analyser.fftSize=64;
    sourceNode=audioCtx.createMediaElementSource(audioEl);
    sourceNode.connect(analyser);
    analyser.connect(audioCtx.destination);
    sourceLinked=true;
    startVisRaf();
  }catch(err){
    console.warn('AudioContext no disponible:',err);
    startIdleVisualizer();
  }
}
function refreshCardHighlight(){
  document.querySelectorAll('.song-card').forEach(card=>{
    const id=parseInt(card.dataset.id);
    card.classList.toggle('playing',id===nowPlayingId);
    const badge=card.querySelector('.now-playing-badge');
    if(id===nowPlayingId&&!badge){
      const cover=card.querySelector('.card-cover');
      const b=document.createElement('div');
      b.className='now-playing-badge'; b.textContent='Reproduciendo';
      cover.appendChild(b);
    } else if(id!==nowPlayingId&&badge){
      badge.remove();
    }
  });
}

function togglePlayPause(){
  const audio=$('audioEl');
  if(!audio.src||audio.src===window.location.href) return;
  if(audio.paused){
    if(audioCtx&&audioCtx.state==='suspended') audioCtx.resume();
    audio.play().then(()=>{
      $('plDisc').classList.add('spinning');
      updatePlayPauseBtn(true);
      if (sourceLinked) startVisRaf(); else startIdleVisualizer();
      $('expPlayPauseBtn').textContent = '⏸';
      $('expDisc')?.classList.add('spinning');
    });
  } else {
    audio.pause();
    $('plDisc').classList.remove('spinning');
    updatePlayPauseBtn(false);
    $('expPlayPauseBtn').textContent = '▶';
    $('expDisc')?.classList.remove('spinning');
    startIdleVisualizer();
  }
}
function updatePlayPauseBtn(playing){
  const btn=$('playPauseBtn');
  if(btn) btn.textContent=playing?'⏸':'▶';
  const expBtn=$('expPlayPauseBtn');
  if(expBtn) expBtn.textContent=playing?'⏸':'▶';
  // Sincronizar disco del panel derecho
  const rightDisc = document.getElementById('rightDisc');
  if (rightDisc) {
    if (playing) rightDisc.classList.add('spinning');
    else rightDisc.classList.remove('spinning');
  }
}

/* Visualizer */
function startVisRaf(){
  stopVisRaf();
  if(!analyser) return;
  const bars=document.querySelectorAll('.vis-bar');
  if(!bars.length) return;
  const bufLen=analyser.frequencyBinCount;
  const dataArr=new Uint8Array(bufLen);
  function draw(){
    analyser.getByteFrequencyData(dataArr);
    bars.forEach((bar,i)=>{
      const idx=Math.floor(i*(bufLen/bars.length));
      const h=Math.max(3,(dataArr[idx]/255)*26);
      bar.style.height=h+'px';
      bar.classList.remove('idle');
    });
    visRaf=requestAnimationFrame(draw);
  }
  draw();
}
function stopVisRaf(){
  if(visRaf){ cancelAnimationFrame(visRaf); visRaf=null }
}
function startIdleVisualizer(){
  stopVisRaf();
  document.querySelectorAll('.vis-bar').forEach((bar,i)=>{
    bar.style.setProperty('--d',(i*0.06)+'s');
    bar.classList.add('idle');
    bar.style.height='';
  });
}

/* Progress */
function updateProgress(){
  const audio=$('audioEl');
  if(!audio.duration) return;
  const pct=(audio.currentTime/audio.duration)*100;
  const fill=$('progressFill'); if(fill) fill.style.width=pct+'%';
  txt('currentTime',fmtTime(audio.currentTime));
  txt('totalTime',fmtTime(audio.duration));
  const expFill=$('expProgressFill'); if(expFill) expFill.style.width=pct+'%';
  txt('expCurrentTime',fmtTime(audio.currentTime));
  txt('expTotalTime',fmtTime(audio.duration));
}
function seekProgress(e){
  const audio=$('audioEl'); if(!audio.duration) return;
  const bar=$('progressBar');
  const rect=bar.getBoundingClientRect();
  const pct=Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width));
  audio.currentTime=pct*audio.duration;
}
function seekProgressExpanded(e){
  const audio=$('audioEl'); if(!audio.duration) return;
  const bar=$('expProgressBar');
  const rect=bar.getBoundingClientRect();
  const pct=Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width));
  audio.currentTime=pct*audio.duration;
}
function fmtTime(s){
  if(isNaN(s)||!isFinite(s)) return '0:00';
  const m=Math.floor(s/60),sec=Math.floor(s%60);
  return m+':'+(sec<10?'0':'')+sec;
}
function setVolume(val){
  const audio=$('audioEl'); if(audio) audio.volume=parseFloat(val);
  const pct = Math.round(val*100);
  txt('volPercent', pct+'%');
  txt('expVolPercent', pct+'%');
  $('volumeRange').value=val;
  $('expVolumeRange').value=val;
  const icon=$('volIcon');
  if(icon) icon.textContent=val==0?'🔇':val<0.5?'🔉':'🔊';
}

/* ── onAudioEnded ── */
function onAudioEnded(){
  $('plDisc').classList.remove('spinning');
  updatePlayPauseBtn(false);
  $('expDisc')?.classList.remove('spinning');
  $('expPlayPauseBtn').textContent = '▶';

  if(nowPlayingId){
    const duration = $('audioEl').duration || 0;
    updateStats(nowPlayingId, duration);
    checkAchievements();

    const list = getContextSongs();
    const idx = list.findIndex(s => s.id === nowPlayingId);
    if (idx >= 0 && idx < list.length - 1) {
      playSong(null, list[idx + 1].id, playlistContext);
    } else if (list.length > 0) {
      playSong(null, list[0].id, playlistContext);
    }
  }
}

/* ═══════════════════ NUEVAS FUNCIONES ══════════════════ */

// ── Discover Weekly ──
async function generateWeekly() {
  const res = await fetch(`${API_BASE}/api/weekly?user_id=${currentUser.id}`);
  const data = await res.json();
  return data.weekly || [];
}
function getWeeklyData() {
  try { return JSON.parse(localStorage.getItem('weeklyData')) || null; } catch { return null; }
}
function saveWeeklyData(data) {
  localStorage.setItem('weeklyData', JSON.stringify(data));
}
async function renderWeekly() {
  const weeklyDiv = $('weeklyCards');
  if (!weeklyDiv) return;
  const data = getWeeklyData();
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  monday.setHours(0,0,0,0);

  if (!data || new Date(data.weekStart) < monday) {
    const songs = await generateWeekly();
    if (songs.length > 0) {
      saveWeeklyData({ weekStart: monday.toISOString(), songs: songs.map(s => s.id) });
      renderCards(songs, 'weeklyCards', 'Aún no hay suficientes datos.');
    } else {
      weeklyDiv.innerHTML = '<div class="empty-state"><p>Dale like a más canciones para activar Discover Weekly.</p></div>';
    }
  } else {
    const songs = data.songs.map(id => allSongs.find(s => s.id === id)).filter(Boolean);
    renderCards(songs, 'weeklyCards', 'Lista semanal vacía.');
  }
}

// ── Estadísticas y logros ──
function getStats() {
  try { return JSON.parse(localStorage.getItem('playStats')) || {}; } catch { return {}; }
}
function saveStats(stats) {
  localStorage.setItem('playStats', JSON.stringify(stats));
}
function updateStats(songId, duration) {
  const stats = getStats();
  const key = songId.toString();
  stats[key] = stats[key] || { plays: 0, totalTime: 0 };
  stats[key].plays++;
  stats[key].totalTime += duration || 0;
  saveStats(stats);
}
function renderProfile() {
  const stats = getStats();
  const totalPlays = Object.values(stats).reduce((a,b) => a + b.plays, 0);
  const totalTimeMin = Math.round(Object.values(stats).reduce((a,b) => a + b.totalTime, 0) / 60);
  txt('profilePlays', totalPlays);
  txt('profileTime', totalTimeMin + ' min');

  const artistCount = {};
  myInter.forEach(inter => {
    const song = allSongs.find(s => s.id === inter.cancion_id);
    if (song) artistCount[song.artista] = (artistCount[song.artista] || 0) + 1;
  });
  const favArtist = Object.entries(artistCount).sort((a,b) => b[1] - a[1])[0];
  txt('profileArtist', favArtist ? favArtist[0] : '—');

  const achievements = getAchievements();
  const logrosDiv = $('achievementsList');
  if (logrosDiv) logrosDiv.innerHTML = achievements.map(a => `<span class="achievement-badge">${a.icon} ${a.name}</span>`).join('');
}

const ACHIEVEMENTS = [
  { id: 'first_like', name: 'Primer like', icon: '❤️', condition: (ctx) => ctx.likes >= 1 },
  { id: 'ten_likes', name: '10 likes', icon: '💘', condition: (ctx) => ctx.likes >= 10 },
  { id: 'first_fav', name: 'Primer favorito', icon: '⭐', condition: (ctx) => ctx.favs >= 1 },
  { id: 'explorer', name: 'Explorador', icon: '🗺️', condition: (ctx) => ctx.genres >= 5 },
  { id: 'marathon', name: 'Maratonista', icon: '🏃', condition: (ctx) => ctx.totalPlays >= 50 },
];
function getAchievements() {
  try { return JSON.parse(localStorage.getItem('achievements')) || []; } catch { return []; }
}
function saveAchievements(achieved) {
  localStorage.setItem('achievements', JSON.stringify(achieved));
}
function checkAchievements() {
  const likes = myInter.filter(i => i.es_like).length;
  const favs = myInter.filter(i => i.es_favorito).length;
  const genres = new Set(allSongs.filter(s => myInter.some(i => i.cancion_id === s.id)).map(s => s.genero)).size;
  const stats = getStats();
  const totalPlays = Object.values(stats).reduce((a,b) => a + b.plays, 0);
  const ctx = { likes, favs, genres, totalPlays };
  const achieved = getAchievements();
  ACHIEVEMENTS.forEach(ach => {
    if (!achieved.some(a => a.id === ach.id) && ach.condition(ctx)) {
      achieved.push(ach);
      toast(`🏆 ¡Logro desbloqueado! ${ach.icon} ${ach.name}`);
    }
  });
  saveAchievements(achieved);
}

// ── Sleep Timer (mejorado) ──
function toggleSleepMenu() {
  const menu = $('sleepMenu');
  if (menu) menu.classList.toggle('hidden');
}
function cancelSleepMenu() {
  $('sleepMenu')?.classList.add('hidden');
}
function startCustomSleepTimer() {
  const input = $('sleepMinutesInput');
  if (!input) return;
  const minutes = parseInt(input.value, 10);
  if (isNaN(minutes) || minutes < 1) {
    toast('⚠️ Ingresa un número válido de minutos');
    return;
  }
  setSleepTimer(minutes);
  $('sleepMenu')?.classList.add('hidden');
}
function setSleepTimer(minutes) {
  clearSleepTimer();
  const countdownEl = $('sleepCountdown');
  const expCountdownEl = $('expSleepCountdown');
  const cancelBtn = $('cancelSleepBtn');
  const expCancelBtn = $('expCancelSleepBtn');
  
  let remaining = minutes * 60;
  const updateCountdown = () => {
    const min = Math.floor(remaining / 60);
    const sec = remaining % 60;
    const text = `${min}:${sec < 10 ? '0' : ''}${sec}`;
    if (countdownEl) { countdownEl.textContent = text; countdownEl.classList.remove('hidden'); }
    if (expCountdownEl) { expCountdownEl.textContent = text; expCountdownEl.classList.remove('hidden'); }
    if (cancelBtn) cancelBtn.classList.remove('hidden');
    if (expCancelBtn) expCancelBtn.classList.remove('hidden');
  };
  updateCountdown();
  
  sleepTimer = setInterval(() => {
    remaining--;
    updateCountdown();
    if (remaining <= 0) {
      clearSleepTimer();
      togglePlayPause();
      toast('⏰ Temporizador finalizado');
    }
  }, 1000);
}
function clearSleepTimer() {
  if (sleepTimer) { clearInterval(sleepTimer); sleepTimer = null; }
  $('sleepCountdown')?.classList.add('hidden');
  $('expSleepCountdown')?.classList.add('hidden');
  $('cancelSleepBtn')?.classList.add('hidden');
  $('expCancelSleepBtn')?.classList.add('hidden');
}

// ── Efectos visuales por energía ──
function applyEnergyEffect(song) {
  if (!song) return;
  const energy = song.energia || 0.5;
  const hue = 260 + (energy * 40);
  document.body.style.transition = 'background 1s';
  document.body.style.background = `linear-gradient(135deg, hsl(${hue}, 80%, 5%) 0%, hsl(${hue-40}, 60%, 12%) 100%)`;
}
function resetEnergyEffect() {
  document.body.style.background = '';
  document.body.style.transition = '';
}

// ── Cola de reproducción (local) ──
function recursivePlaylistLocal(seedId, depth, visited = new Set()) {
  if (depth === 0 || !seedId) return [];
  const seed = allSongs.find(s => s.id === seedId);
  if (!seed || visited.has(seedId)) return [];
  visited.add(seedId);
  const next = allSongs
    .filter(s => !visited.has(s.id))
    .map(s => ({
      s,
      score: s.genero === seed.genero ? 3 : 0
    }))
    .sort((a, b) => b.score - a.score)[0];
  if (!next) return [];
  return [next.s, ...recursivePlaylistLocal(next.s.id, depth - 1, visited)];
}
function updateQueue() {
  if (playlistContext === 'favorites') {
    queue = getFavoriteSongs().filter(s => s.id !== nowPlayingId);
  } else if (playlistContext === 'likes') {
    queue = getLikedSongs().filter(s => s.id !== nowPlayingId);
  } else if (playlistContext === 'playlist') {
    queue = getPlaylistSongs().filter(s => s.id !== nowPlayingId);
  } else {
    if (nowPlayingId) {
      queue = recursivePlaylistLocal(nowPlayingId, 10, new Set([nowPlayingId]));
    } else {
      queue = allSongs.slice(0, 20);
    }
  }
  renderQueueUI();
  updateRightQueue();
}
function renderQueueUI() {
  const list = $('queueList');
  if (!list) return;
  list.innerHTML = queue.map(s => `<li onclick="playSong(null, ${s.id}, '${playlistContext}')" class="queue-item">
    <img src="${s.url_imagen || ''}" style="width:30px;height:30px;border-radius:4px;" onerror="this.style.display='none'">
    ${esc(s.titulo)} — ${esc(s.artista)}
  </li>`).join('');
}
function clearQueue() {
  queue = [];
  renderQueueUI();
  toast('Cola vaciada');
}
function openQueueModal() {
  $('queueModal')?.classList.remove('hidden');
}
function closeQueue() {
  $('queueModal')?.classList.add('hidden');
}

/* ═══════════════════ PANEL EXPANDIDO ══════════════════ */
function openExpandedPlayer() {
  if (!nowPlayingId) return;
  const song = allSongs.find(s => s.id === nowPlayingId);
  if (!song) return;
  txt('expTitle', song.titulo);
  txt('expArtist', song.artista);
  const disc = $('expDisc');
  updateDiscCover($('expDiscCover'), song);
  const audio = $('audioEl');
  if (audio && !audio.paused) {
    disc.classList.add('spinning');
    $('expPlayPauseBtn').textContent = '⏸';
  } else {
    disc.classList.remove('spinning');
    $('expPlayPauseBtn').textContent = '▶';
  }
  $('expVolumeRange').value = audio ? audio.volume : 0.8;
  txt('expVolPercent', Math.round((audio?.volume || 0.8)*100)+'%');
  $('expandedPlayer').classList.remove('hidden');
}
function closeExpandedPlayer() {
  $('expandedPlayer').classList.add('hidden');
}

/* ═══════════════════ CHAT EN TIEMPO REAL (página dedicada) ══════════════════ */
let chatSubscription = null;

function initChat() {
  loadChatMessages();

  if (!window.supabase) return;
  const supabaseClient = window.supabase.createClient(
    'https://jhlktvdylbiieeuwykgj.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpobGt0dmR5bGJpaWVldXd5a2dqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMzIwNjMsImV4cCI6MjA5NTkwODA2M30.jie5MZF36VXhsfEZggCCWJ3M5HQVShGmyss6f-nLa3s'
  );
  chatSubscription = supabaseClient
    .channel('table-db-changes')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mensajes' }, payload => {
      addMessageToUI(payload.new);
      const container = document.getElementById('chatMessagesPanel');
      if (container) container.scrollTop = container.scrollHeight;
    })
    .subscribe();
}

function loadChatMessages() {
  fetch(`${API_BASE}/api/messages`)
    .then(r => r.json())
    .then(data => {
      const container = document.getElementById('chatMessagesPanel');
      if (container) {
        container.innerHTML = '';
        (data.messages || []).forEach(msg => addMessageToUI(msg));
        container.scrollTop = container.scrollHeight;
      }
    })
    .catch(err => {
      console.error('Error cargando mensajes:', err);
      toast('Error al cargar el chat');
    });
}

function addMessageToUI(msg) {
  const container = document.getElementById('chatMessagesPanel');
  if (!container) return;
  const div = document.createElement('div');
  const isMine = currentUser && msg.user_id === currentUser.id;
  div.className = 'msg-bubble' + (isMine ? ' my-msg' : '');
  if (isMine) {
    div.innerHTML = esc(msg.mensaje);
  } else {
    div.innerHTML = `<div class="msg-user">${esc(msg.username)}</div>${esc(msg.mensaje)}`;
    const hue = hashCode(msg.user_id || msg.username) % 360;
    div.style.backgroundColor = `hsla(${hue}, 60%, 25%, 0.6)`;
  }
  container.appendChild(div);
}

async function sendMessage() {
  const input = document.getElementById('chatInput');
  const mensaje = input.value.trim();
  if (!mensaje || !currentUser) return;
  input.value = '';
  try {
    const res = await fetch(`${API_BASE}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: currentUser.id,
        username: currentUser.nombre || currentUser.username,
        mensaje
      })
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Error al enviar');
    }
  } catch (e) {
    console.error('Error enviando mensaje:', e);
    toast('Error al enviar mensaje: ' + e.message);
  }
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return Math.abs(hash);
}

/* ═══════════════════ INICIALIZACIÓN DE SECCIONES ESTÁTICAS (NUEVAS) ══════════════════ */
function initStaticSections() {
  // Most listened (lo más escuchado)
  const listenedContainer = document.getElementById('mostListenedCards');
  if (listenedContainer && allSongs.length > 0) {
    const topSongs = allSongs.slice(0, 5);
    listenedContainer.innerHTML = topSongs.map(s => `
      <div class="mix-card" style="background-image:url(${s.url_imagen || ''})" onclick="playSong(null, ${s.id})">
        <span>${s.titulo}</span>
      </div>
    `).join('');
  }

  // Moods (estados de ánimo)
  const moodContainer = document.getElementById('moodCards');
  if (moodContainer) {
    const moods = [
      { name: 'Canciones tristes', color: '#3b82f6' },
      { name: 'Para estudiar', color: '#8b5cf6' },
      { name: 'Para ejercitarse', color: '#ef4444' },
    ];
    moodContainer.innerHTML = moods.map(m => `
      <div class="mood-card" style="background:${m.color}" onclick="toast('Próximamente')">
        <span>${m.name}</span>
      </div>
    `).join('');
  }

  // Explore genres (explora tus géneros)
  const genreContainer = document.getElementById('exploreGenresCards');
  if (genreContainer) {
    const genres = [...new Set(allSongs.map(s => s.genero))];
    genreContainer.innerHTML = genres.map(g => `
      <div class="genre-card" onclick="filterGenre(null, '${g}')">
        <span>#${g}</span>
      </div>
    `).join('');
  }

  // Mixes (tus mixes más escuchados)
  const mixesContainer = document.getElementById('mixesCards');
  if (mixesContainer) {
    const artists = [...new Set(allSongs.map(s => s.artista))];
    mixesContainer.innerHTML = artists.slice(0, 5).map(artist => `
      <div class="mix-card" style="background: linear-gradient(135deg, var(--accent2), #4f46e5);" onclick="toast('Mix de ${artist}')">
        <span>Mix de ${artist}</span>
      </div>
    `).join('');
  }

  // Discover cards (página Buscar)
  const discoverContainer = document.getElementById('discoverCards');
  if (discoverContainer) {
    const genres = [...new Set(allSongs.map(s => s.genero))];
    discoverContainer.innerHTML = genres.map(g => `
      <div class="genre-card" onclick="filterGenre(null, '${g}')">
        <span>#${g}</span>
      </div>
    `).join('');
  }

  // Explore all grid (página Buscar)
  const exploreGrid = document.getElementById('exploreAllGrid');
  if (exploreGrid) {
    exploreGrid.innerHTML = `
      <div class="explore-card" style="background:#ec4899" onclick="showPage('home')"><span>Música</span><span class="icon">🎵</span></div>
      <div class="explore-card" style="background:#10b981" onclick="showPage('playlist')"><span>Playlist</span><span class="icon">📋</span></div>
      <div class="explore-card" style="background:#8b5cf6" onclick="showPage('chat')"><span>Chat</span><span class="icon">💬</span></div>
      <div class="explore-card" style="background:#3b82f6" onclick="showPage('weekly')"><span>Discover Weekly</span><span class="icon">📅</span></div>
    `;
  }
}

/* ═══════════════════ MENÚ CONTEXTUAL ══════════════════ */
let contextSongId = null;
function openContextMenu(e, songId) {
  e.stopPropagation();
  const song = allSongs.find(s => s.id === songId);
  if (!song) return;
  contextSongId = songId;
  document.getElementById('ctxTitle').textContent = song.titulo;
  document.getElementById('ctxArtist').textContent = song.artista;
  const imgEl = document.getElementById('ctxImage');
  if (song.url_imagen) {
    imgEl.innerHTML = `<img src="${song.url_imagen}" style="width:100%;height:100%;object-fit:cover;border-radius:8px">`;
  } else {
    imgEl.innerHTML = genreEmoji(song.genero);
  }
  document.getElementById('contextMenu').classList.remove('hidden');
}

function closeContextMenu() {
  document.getElementById('contextMenu').classList.add('hidden');
}

function contextAction(action) {
  if (!contextSongId) return;
  const song = allSongs.find(s => s.id === contextSongId);
  if (!song) return;
  switch(action) {
    case 'like': toggleLike(null, contextSongId); break;
    case 'playlist': toggleAddToPlaylist(null, contextSongId); break;
    case 'queue': playSong(null, contextSongId, playlistContext); break;
    default: toast('Función próximamente');
  }
  closeContextMenu();
}

/* ═══════════════════ MÁS COMO [ARTISTA] ══════════════════ */
function updateMoreLikeSection(song) {
  const section = document.getElementById('moreLikeSection');
  const title = document.getElementById('moreLikeTitle');
  const container = document.getElementById('moreLikeCards');
  if (!section || !song) return;
  title.textContent = 'Más como ' + song.artista;
  const similar = allSongs.filter(s => s.artista === song.artista && s.id !== song.id).slice(0, 5);
  if (similar.length > 0) {
    container.innerHTML = similar.map(s => `
      <div style="text-align:center;cursor:pointer;min-width:80px;" onclick="playSong(null, ${s.id})">
        <img src="${s.url_imagen || ''}" style="width:60px;height:60px;border-radius:50%;object-fit:cover;margin-bottom:4px;" onerror="this.style.display='none'">
        <div style="font-size:12px;font-weight:600;">${s.artista}</div>
        <div style="font-size:10px;color:var(--text2);">Artista</div>
      </div>
    `).join('');
    section.style.display = 'block';
  } else {
    section.style.display = 'none';
  }
}

/* ═══════════════════ PLAYLIST FILTROS ══════════════════ */
function filterPlaylist(tab) {
  document.querySelectorAll('#page-playlist .gpill').forEach(b => b.classList.remove('active'));
  const activeTab = document.querySelector(`#page-playlist .gpill[onclick="filterPlaylist('${tab}')"]`);
  if (activeTab) activeTab.classList.add('active');
  const artistsView = document.getElementById('playlistArtistsView');
  const songsView = document.getElementById('playlistSongsView');
  if (tab === 'artistas') {
    artistsView.classList.remove('hidden');
    songsView.classList.add('hidden');
    renderPlaylistArtists();
  } else {
    artistsView.classList.add('hidden');
    songsView.classList.remove('hidden');
    renderPlaylist();
  }
}

function renderPlaylistArtists() {
  const artists = [...new Set(userPlaylist.map(id => allSongs.find(s => s.id === id)?.artista).filter(Boolean))];
  const list = document.getElementById('playlistArtistsList');
  if (!list) return;
  list.innerHTML = artists.map(artist => `
    <div class="artist-row">
      <div class="artist-avatar">${artist[0]}</div>
      <div>
        <div class="artist-name">${artist}</div>
        <div class="artist-label">Artista</div>
      </div>
    </div>
  `).join('');
}

/* ═══════════════════ PANEL DERECHO Y BARRA MÓVIL ══════════════════ */
function updateRightPanel(song) {
  const rightDisc = document.getElementById('rightDisc');
  const rightCover = document.getElementById('rightDiscCover');
  if (rightCover) updateDiscCover(rightCover, song);
  const rightTitle = document.getElementById('rightTitle');
  const rightArtist = document.getElementById('rightArtist');
  if (rightTitle) rightTitle.textContent = song.titulo;
  if (rightArtist) rightArtist.textContent = song.artista;
  const audio = document.getElementById('audioEl');
  if (rightDisc) {
    if (audio && !audio.paused) rightDisc.classList.add('spinning');
    else rightDisc.classList.remove('spinning');
  }
  updateRightQueue();
}

function updateRightQueue() {
  const list = document.getElementById('rightQueueList');
  if (!list) return;
  const contextSongs = getContextSongs();
  const upcoming = contextSongs.filter(s => s.id !== nowPlayingId).slice(0, 5);
  list.innerHTML = upcoming.map(s => `
    <li onclick="playSong(null, ${s.id}, '${playlistContext}')">
      <img src="${s.url_imagen || ''}" onerror="this.style.display='none'">
      ${esc(s.titulo)}
    </li>
  `).join('');
}

/* ═══════════════════ NAVEGACIÓN Y PANEL IA ══════════════════ */
function showPage(name){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const pg=$('page-'+name), nv=$('nav-'+name);
  if(pg) pg.classList.add('active');
  if(nv) nv.classList.add('active');
  if(window.innerWidth<=768) $('sidebar').classList.remove('open');

  // Actualizar barra móvil
  document.querySelectorAll('.mobile-nav-item').forEach(item => item.classList.remove('active'));
  const mobileActive = document.querySelector(`.mobile-nav-item[onclick="showPage('${name}')"]`);
  if (mobileActive) mobileActive.classList.add('active');

  if (name === 'weekly') renderWeekly();
  else if (name === 'profile') renderProfile();
  else if (name === 'analysis') renderAnalysis();
  else if (name === 'chat') {
    if (!chatSubscription) initChat();
    loadChatMessages();
  }
  else if (name === 'playlist') {
    renderPlaylist();
  }
  else if (name === 'search') {
    // Limpiar búsqueda y mostrar catálogo completo
    document.getElementById('searchInputBig').value = '';
    searchQuery = '';
    renderCatalog();
  }
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
    const genreChart = data.genre_chart || {};
    const sorted = Object.entries(genreChart).sort((a,b) => b[1] - a[1]);
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
  } catch(e) { allSongs = []; }

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

  await bootApp();
});

document.addEventListener('keydown', e => {
  if (e.key === ' ' && e.target.tagName !== 'INPUT') { e.preventDefault(); togglePlayPause(); }
});

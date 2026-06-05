/* ════════════════════════════════════════════════════
   SoundMind — script.js (v20.1 CORREGIDO)
   - Función renderPlaylist() añadida
   - función crearNuevaPlaylist() añadida
   - IDs correctos: stat-canciones, stat-likes, stat-favoritos
   - Migración a Supabase completa
   - Todas las funciones previas intactas
════════════════════════════════════════════════════ */

const API_BASE = 'https://streamflix-music.onrender.com';   // ← Cambia por tu URL real
const SUPABASE_URL = 'https://jhlktvdylbiieeuwykgj.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpobGt0dmR5bGJpaWVldXd5a2dqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMzIwNjMsImV4cCI6MjA5NTkwODA2M30.jie5MZF36VXhsfEZggCCWJ3M5HQVShGmyss6f-nLa3s';
var supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* ── State ── */
let currentUser  = null;
let allSongs     = [];
let myInter      = [];          // interacciones del usuario
let interaccionesMap = {};      // acceso rápido por cancion_id
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

/* Variables extra */
let displayedMessageIds = new Set();
let pendingTempMessages = new Map();
let sleepTimer = null;
let queue = [];
let userPlaylist = [];               // IDs de canciones en la playlist local (ahora en Supabase)
let paginaAnterior = 'page-home';    // para la página álbum

/* Variables para el scroll horizontal del ranking */
let rankingScrollEnabled = false;
let rankingArrowsAdded = false;

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
  return true;
}

/* ═══════════════════ BOOT ══════════════════ */
async function bootApp(){
  if (!checkSession()) return;
  $('app').classList.remove('hidden');
  $('playerBar').classList.remove('hidden');

  const initials=(currentUser.nombre||currentUser.username).slice(0,2).toUpperCase();
  txt('userAvatar',initials);
  txt('heroName',currentUser.nombre||currentUser.username);

  try {
    // Cargar canciones desde Supabase
    const { data: songsData } = await supabase.from('canciones').select('*').order('id', { ascending: true });
    allSongs = songsData || [];

    // Cargar interacciones del usuario
    const { data: interData } = await supabase.from('interacciones')
      .select('cancion_id, es_like, es_favorito')
      .eq('usuario_id', currentUser.id);
    myInter = interData || [];
    interaccionesMap = {};
    myInter.forEach(i => interaccionesMap[i.cancion_id] = i);

    // Cargar playlist del usuario desde Supabase
    await loadUserPlaylist();
  } catch (err) {
    console.error('Error cargando datos desde Supabase:', err);
    toast('⚠️ Error de conexión. Algunas funciones pueden no estar disponibles.');
    allSongs = [];
    myInter = [];
    interaccionesMap = {};
  }

  buildGenrePills();
  renderAll();
  renderWeekly();
  showPage('home');
  initVoiceSearch();
  initChat();
  initRealtimeRanking();   // ← añadir esta línea

  // Inicializar nuevas secciones estáticas
    try {
    renderizarCancionesMood();
    renderizarExploraGeneros();
    renderizarTusMixes();
    await renderizarRankingGlobal();
  } catch(e) {
    console.error('Error al inicializar secciones estáticas:', e);
  }

  // Asegurar que el scroll horizontal del ranking funcione también si el ranking se cargó exitosamente
  enableRankingScroll();

  await actualizarContadoresHeader();
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

  // Limpiar suscripciones en tiempo real
  if (chatSubscription) {
    chatSubscription.unsubscribe();
    chatSubscription = null;
  }
  if (rankingSubscription) {
    rankingSubscription.unsubscribe();
    rankingSubscription = null;
  }

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
  // renderHomePopular();   // Eliminado (sección "Más populares" ya no existe)
  renderHomeRec();
  renderCatalog();
  renderPlaylist();
}

async function updateHeroStats(){
  try {
    const { count: totalCanciones } = await supabase.from('canciones').select('*', { count: 'exact', head: true });
    const { count: totalLikes } = await supabase.from('interacciones').select('*', { count: 'exact', head: true }).eq('usuario_id', currentUser.id).eq('es_like', true);
    const { count: totalFavoritos } = await supabase.from('interacciones').select('*', { count: 'exact', head: true }).eq('usuario_id', currentUser.id).eq('es_favorito', true);
    txt('stat-canciones', totalCanciones || 0);
    txt('stat-likes', totalLikes || 0);
    txt('stat-favoritos', totalFavoritos || 0);
  } catch(e) {
    txt('stat-canciones', allSongs.length);
    txt('stat-likes', myInter.filter(i=>i.es_like).length);
    txt('stat-favoritos', myInter.filter(i=>i.es_favorito).length);
  }
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
  const inter = interaccionesMap[s.id] || {};
  const liked = inter.es_like;
  const faved = inter.es_favorito;
  const playing = nowPlayingId === s.id;
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

/* ── Populars (API) ── (ya no se usa, pero se mantiene por si acaso) */
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

/* ── Playlist (Supabase) ── */
async function loadUserPlaylist() {
  if (!currentUser) return;
  try {
    const { data } = await supabase.from('playlists').select('id').eq('usuario_id', currentUser.id);
    if (data && data.length > 0) {
      const playlistId = data[0].id;
      const { data: canciones } = await supabase.from('playlist_canciones').select('cancion_id').eq('playlist_id', playlistId);
      userPlaylist = canciones ? canciones.map(c => c.cancion_id) : [];
    } else {
      userPlaylist = [];
    }
  } catch(e) { userPlaylist = []; }
}

async function toggleAddToPlaylist(e, songId) {
  e.stopPropagation();
  if (!currentUser) return;
  let { data: playlists } = await supabase.from('playlists').select('id,nombre').eq('usuario_id', currentUser.id).limit(1);
  let playlistId;
  if (!playlists || playlists.length === 0) {
    const { data: newPlaylist } = await supabase.from('playlists').insert({ usuario_id: currentUser.id, nombre: 'Mi Playlist' }).select().single();
    playlistId = newPlaylist.id;
  } else {
    playlistId = playlists[0].id;
  }

  const index = userPlaylist.indexOf(songId);
  if (index >= 0) {
    await supabase.from('playlist_canciones').delete().eq('playlist_id', playlistId).eq('cancion_id', songId);
    userPlaylist.splice(index, 1);
    toast('🗑️ Canción eliminada de tu Playlist');
  } else {
    const { count } = await supabase.from('playlist_canciones').select('*', { count: 'exact', head: true }).eq('playlist_id', playlistId);
    await supabase.from('playlist_canciones').upsert({
      playlist_id: playlistId,
      cancion_id: songId,
      posicion: count || 0
    }, { onConflict: 'playlist_id,cancion_id' });
    userPlaylist.push(songId);
    toast('➕ Canción añadida a tu Playlist');
  }
  renderAll();
  if (document.getElementById('page-playlist').classList.contains('active')) {
    renderPlaylist();
  }
}

// ── Función renderPlaylist (estaba faltando) ──
function renderPlaylist() {
  const songs = getPlaylistSongs();
  renderCards(songs, 'playlistCards', 'Tu playlist está vacía. Usa el botón ➕ en cualquier canción para añadirla.', 'playlist');
  updateBadges();
}

// ── Función crearNuevaPlaylist (para los botones del HTML) ──
async function crearNuevaPlaylist() {
  const nombre = prompt('Nombre de la nueva playlist:');
  if (!nombre) return;
  await supabase.from('playlists').insert({ usuario_id: currentUser.id, nombre: nombre.trim() });
  toast('Playlist creada');
  renderPlaylist();
}

/* ═══════════════════ INTERACTIONS (likes/favs con Supabase) ══════════════════ */
async function toggleLike(e, songId) {
  e.stopPropagation();
  const actual = interaccionesMap[songId] || { es_like: false, es_favorito: false };
  const nuevoLike = !actual.es_like;
  const { error } = await supabase.from('interacciones').upsert({
    usuario_id: currentUser.id,
    cancion_id: songId,
    es_like: nuevoLike,
    es_favorito: actual.es_favorito,
    fecha: new Date().toISOString()
  }, { onConflict: 'usuario_id,cancion_id' });
  if (!error) {
    interaccionesMap[songId] = { ...actual, es_like: nuevoLike };
    toast(nuevoLike ? '❤️ Like añadido' : 'Like eliminado');
    renderAll();
    actualizarContadoresHeader();
    renderizarRankingGlobal();
    checkAchievements();
  } else {
    toast('Error al actualizar like');
  }
}

async function toggleFav(e, songId) {
  e.stopPropagation();
  const actual = interaccionesMap[songId] || { es_like: false, es_favorito: false };
  const nuevoFav = !actual.es_favorito;
  const { error } = await supabase.from('interacciones').upsert({
    usuario_id: currentUser.id,
    cancion_id: songId,
    es_like: actual.es_like,
    es_favorito: nuevoFav,
    fecha: new Date().toISOString()
  }, { onConflict: 'usuario_id,cancion_id' });
  if (!error) {
    interaccionesMap[songId] = { ...actual, es_favorito: nuevoFav };
    toast(nuevoFav ? '⭐ Favorito añadido' : 'Favorito eliminado');
    renderAll();
    actualizarContadoresHeader();
    renderizarRankingGlobal();
    checkAchievements();
  } else {
    toast('Error al actualizar favorito');
  }
}

/* ═══════════════════ RANKING GLOBAL ══════════════════ */
async function calcularRankingGlobal() {
  const { data } = await supabase.from('interacciones')
    .select('cancion_id, es_like, es_favorito')
    .or('es_like.eq.true,es_favorito.eq.true');
  if (!data) return [];

  const scores = {};
  data.forEach(i => {
    if (!scores[i.cancion_id]) scores[i.cancion_id] = 0;
    if (i.es_like) scores[i.cancion_id] += 1.0;
    if (i.es_favorito) scores[i.cancion_id] += 0.5;
  });

  return Object.entries(scores)
    .map(([cancion_id, score]) => ({
      cancion: allSongs.find(s => s.id === parseInt(cancion_id)),
      score
    }))
    .filter(r => r.cancion)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

async function renderizarRankingGlobal() {
  const contenedor = document.getElementById('ranking-lo-mas-escuchado');
  if (!contenedor) return;

  try {
    const ranking = await calcularRankingGlobal();

    if (ranking.length === 0) {
      contenedor.innerHTML = `<div style="text-align:center;padding:32px;color:#a0aec0"><span style="font-size:40px">🎵</span><p>Aún no hay suficientes interacciones en la comunidad para mostrar populares.</p></div>`;
      return;
    }

    // Formato horizontal (tarjetas deslizables)
    contenedor.innerHTML = ranking.map((item, i) => {
      const c = item.cancion;
      return `
        <div style="min-width:140px;background:rgba(11,11,22,.8);border:1px solid var(--border);border-radius:12px;padding:10px;text-align:center;cursor:pointer;flex-shrink:0;transition:var(--transition-fast)"
             onclick="playSong(null, ${c.id})"
             onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'">
          <img src="${c.url_imagen || ''}" style="width:80px;height:80px;border-radius:8px;object-fit:cover;margin-bottom:6px">
          <div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.titulo}</div>
          <div style="font-size:11px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.artista}</div>
          <div style="color:#f59e0b;font-size:11px;margin-top:4px">★ ${item.score.toFixed(1)}</div>
          <button onclick="event.stopPropagation();playSong(null,${c.id})" style="margin-top:6px;background:rgba(124,58,237,0.2);border:none;color:#fff;border-radius:50%;width:28px;height:28px;cursor:pointer;font-size:12px">▶</button>
        </div>`;
    }).join('');
  } catch (error) {
    console.error('Error al cargar el ranking global:', error);
    contenedor.innerHTML = `<div style="text-align:center;padding:32px;color:#a0aec0"><span style="font-size:40px">⚠️</span><p>No se pudo cargar el ranking. Intenta recargar la página.</p></div>`;
  }

  // Habilitar la navegación con flechas (escritorio) y rueda de ratón
  enableRankingScroll();
}

/* ═══════ Scroll horizontal con flechas (PC) ═══════ */
function enableRankingScroll() {
  const container = document.getElementById('ranking-lo-mas-escuchado');
  if (!container || rankingScrollEnabled) return;

  // Scroll con la rueda del ratón
  container.addEventListener('wheel', (e) => {
    if (e.deltaY !== 0) {
      e.preventDefault();
      container.scrollLeft += e.deltaY;
    }
  }, { passive: false });

  rankingScrollEnabled = true;

  // Añadir flechas solo en escritorio (>768px)
  addRankingArrows();
  window.addEventListener('resize', handleRankingArrowsResize);
}

function addRankingArrows() {
  if (window.innerWidth <= 768) {
    removeRankingArrows();
    return;
  }

  const container = document.getElementById('ranking-lo-mas-escuchado');
  if (!container || rankingArrowsAdded) return;

  const section = container.closest('.section');
  if (!section) return;

  // Crear flecha izquierda
  const leftArrow = document.createElement('button');
  leftArrow.className = 'ranking-arrow ranking-arrow-left';
  leftArrow.innerHTML = '◀';
  leftArrow.setAttribute('aria-label', 'Desplazar a la izquierda');
  leftArrow.style.cssText = `
    position: absolute; top: 50%; left: 8px; transform: translateY(-50%);
    background: rgba(0,0,0,0.5); color: white; border: none; border-radius: 50%;
    width: 36px; height: 36px; display: none; align-items: center; justify-content: center;
    cursor: pointer; z-index: 5; font-size: 16px; transition: opacity 0.2s;
  `;
  leftArrow.addEventListener('click', (e) => {
    e.stopPropagation();
    container.scrollBy({ left: -250, behavior: 'smooth' });
  });

  // Flecha derecha
  const rightArrow = document.createElement('button');
  rightArrow.className = 'ranking-arrow ranking-arrow-right';
  rightArrow.innerHTML = '▶';
  rightArrow.setAttribute('aria-label', 'Desplazar a la derecha');
  rightArrow.style.cssText = `
    position: absolute; top: 50%; right: 8px; transform: translateY(-50%);
    background: rgba(0,0,0,0.5); color: white; border: none; border-radius: 50%;
    width: 36px; height: 36px; display: none; align-items: center; justify-content: center;
    cursor: pointer; z-index: 5; font-size: 16px; transition: opacity 0.2s;
  `;
  rightArrow.addEventListener('click', (e) => {
    e.stopPropagation();
    container.scrollBy({ left: 250, behavior: 'smooth' });
  });

  section.style.position = 'relative';
  section.appendChild(leftArrow);
  section.appendChild(rightArrow);

  // Actualizar visibilidad de las flechas al hacer scroll
  const updateArrows = () => {
    const canScrollLeft = container.scrollLeft > 0;
    const canScrollRight = container.scrollLeft + container.clientWidth < container.scrollWidth;

    leftArrow.style.display = canScrollLeft ? 'flex' : 'none';
    rightArrow.style.display = canScrollRight ? 'flex' : 'none';
  };

  container.addEventListener('scroll', updateArrows);
  // Llamada inicial
  updateArrows();

  rankingArrowsAdded = true;
}

function removeRankingArrows() {
  document.querySelectorAll('.ranking-arrow').forEach(el => el.remove());
  rankingArrowsAdded = false;
}

function handleRankingArrowsResize() {
  if (window.innerWidth <= 768) {
    removeRankingArrows();
  } else {
    if (!rankingArrowsAdded) {
      addRankingArrows();
    }
  }
}

/* ═══════════════════ MOODS, GÉNEROS, MIXES ══════════════════ */
const MOODS = [
  { id: 'tristes', nombre: 'Canciones tristes', emoji: '😢', color: 'linear-gradient(135deg, #1e3a5f, #3730a3)', generos: ['Balada', 'Alternativo'], keywords: ['sad','alone','goodbye','heartbreak','lost','pain','beautiful pain','let me down','love is gone','you broke'] },
  { id: 'estudiar', nombre: 'Para estudiar', emoji: '📚', color: 'linear-gradient(135deg, #0c4a6e, #1e40af)', generos: ['Electrónica'], keywords: ['faded','lost','dynasty','fearless','past lives','on my way','softcore'] },
  { id: 'ejercitar', nombre: 'Para ejercitarse', emoji: '💪', color: 'linear-gradient(135deg, #7f1d1d, #991b1b)', generos: ['Rock', 'Trap', 'Phonk'], keywords: ['rumbling','stronger','legends','thunder','alive','careless','monster','darkside','so tired'] },
  { id: 'anime', nombre: 'Anime OST', emoji: '⛩️', color: 'linear-gradient(135deg, #4c1d95, #6d28d9)', generos: ['Anime'], keywords: [] },
  { id: 'latino', nombre: 'Latino Hits', emoji: '🎺', color: 'linear-gradient(135deg, #064e3b, #065f46)', generos: ['Latino'], keywords: [] }
];

function obtenerCancionesPorMood(mood) {
  // Si la canción tiene el campo mood explícito, usamos ese
  return allSongs.filter(s => {
    if (s.mood) {
      return s.mood === mood.id;
    }
    // Si no, usamos la lógica original de géneros y palabras clave
    const enGenero = mood.generos.includes(s.genero);
    const enKeywords = mood.keywords.some(kw => s.titulo.toLowerCase().includes(kw) || s.artista.toLowerCase().includes(kw));
    return enGenero || enKeywords;
  });
}

function renderizarCancionesMood() {
  const contenedor = document.getElementById('seccion-canciones-mood');
  if (!contenedor) return;
  contenedor.innerHTML = `<h2 style="font-size:18px;font-weight:700;margin-bottom:4px">🎭 Canciones para tu estado de ánimo</h2><div id="mood-cards-row" style="display:flex;gap:14px;overflow-x:auto;padding-bottom:8px;scrollbar-width:none;-webkit-overflow-scrolling:touch"></div>`;
  const row = document.getElementById('mood-cards-row');
  MOODS.forEach(mood => {
    const canciones = obtenerCancionesPorMood(mood);
    const card = document.createElement('div');
    card.className = 'mood-card';
    card.style.background = mood.color;
    card.innerHTML = `<div><div style="font-size:18px">${mood.emoji}</div><div style="font-weight:700;font-size:15px;color:#fff;line-height:1.2;margin-top:4px">${mood.nombre}</div><div style="font-size:11px;color:rgba(255,255,255,0.7);margin-top:2px">${canciones.length} canciones</div></div>`;
    card.addEventListener('click', () => abrirPaginaAlbum('mood', mood.id));
    row.appendChild(card);
  });
}

const COLORES_GENERO = {
  'Anime': 'linear-gradient(135deg, #4c1d95, #7c3aed)', 'Balada': 'linear-gradient(135deg, #1e3a5f, #2563eb)', 'Electrónica': 'linear-gradient(135deg, #0c4a6e, #0891b2)',
  'J-Pop': 'linear-gradient(135deg, #4a1d96, #7e22ce)', 'Latino': 'linear-gradient(135deg, #14532d, #16a34a)', 'Phonk': 'linear-gradient(135deg, #18181b, #3f3f46)',
  'Pop': 'linear-gradient(135deg, #831843, #db2777)', 'Rock': 'linear-gradient(135deg, #431407, #c2410c)', 'Trap': 'linear-gradient(135deg, #1c1917, #57534e)',
  'Alternativo': 'linear-gradient(135deg, #1e1b4b, #4338ca)'
};

function renderizarExploraGeneros() {
  const contenedor = document.getElementById('seccion-explora-generos');
  if (!contenedor) return;
  const generosUnicos = [...new Set(allSongs.map(s => s.genero?.trim()).filter(Boolean))].sort();
  contenedor.innerHTML = `<h2 style="font-size:18px;font-weight:700;margin-bottom:4px">🌈 Explora tus géneros</h2><div id="genero-cards-row" style="display:flex;gap:12px;overflow-x:auto;padding-bottom:8px;scrollbar-width:none;-webkit-overflow-scrolling:touch"></div>`;
  const row = document.getElementById('genero-cards-row');
  generosUnicos.forEach(genero => {
    const card = document.createElement('div');
    card.className = 'genre-card';
    card.style.background = COLORES_GENERO[genero] || 'linear-gradient(135deg,#27272a,#52525b)';
    card.innerHTML = `<span>#${genero}</span>`;
    card.addEventListener('click', () => abrirPaginaAlbum('genero', genero.trim()));
    row.appendChild(card);
  });
}

function renderizarTusMixes() {
  const contenedor = document.getElementById('seccion-tus-mixes');
  if (!contenedor) return;
  const artistas = {};
  allSongs.forEach(s => {
    const nombreArtista = s.artista.split(/\s*ft\.\s*|\s*,\s*/)[0].trim();
    if (!artistas[nombreArtista]) artistas[nombreArtista] = [];
    artistas[nombreArtista].push(s);
  });
  const mixesDisponibles = Object.entries(artistas).filter(([_, canciones]) => canciones.length >= 2).sort((a, b) => b[1].length - a[1].length).slice(0, 6);
  if (mixesDisponibles.length === 0) return;
  contenedor.innerHTML = `<h2 style="font-size:18px;font-weight:700;margin-bottom:4px">🎲 Tus mixes más escuchados</h2><div id="mixes-row" style="display:flex;gap:14px;overflow-x:auto;padding-bottom:8px;scrollbar-width:none;-webkit-overflow-scrolling:touch"></div>`;
  const row = document.getElementById('mixes-row');
  mixesDisponibles.forEach(([artista, canciones]) => {
    const card = document.createElement('div');
    card.className = 'mix-card';
    card.style.background = 'linear-gradient(135deg,#3730a3,#7c3aed)';
    card.innerHTML = `<div style="position:relative;z-index:1"><div style="font-weight:700;font-size:14px;color:#fff;line-height:1.2">Mix de ${artista}</div><div style="font-size:11px;color:rgba(255,255,255,0.7);margin-top:2px">${canciones.length} canciones</div></div>`;
    card.addEventListener('click', () => abrirPaginaAlbum('artista', artista));
    row.appendChild(card);
  });
}

/* ═══════════════════ PÁGINA ÁLBUM ══════════════════ */
function abrirPaginaAlbum(tipo, valor) {
  paginaAnterior = document.querySelector('.page.active')?.id || 'page-home';
  let cancionesAlbum = [], tituloAlbum = '', subtituloAlbum = '';

  if (tipo === 'genero') {
    const generoNormalizado = valor.trim();
    cancionesAlbum = allSongs.filter(s => s.genero.trim() === generoNormalizado);
    tituloAlbum = generoNormalizado;
    subtituloAlbum = 'Género';
  } else if (tipo === 'mood') {
    const mood = MOODS.find(m => m.id === valor);
    if (mood) {
      cancionesAlbum = obtenerCancionesPorMood(mood);
      tituloAlbum = mood.nombre;
      subtituloAlbum = mood.emoji + ' Estado de ánimo';
    }
  } else if (tipo === 'artista') {
    cancionesAlbum = allSongs.filter(s => s.artista.split(/\s*ft\.\s*|\s*,\s*/)[0].trim() === valor.trim());
    tituloAlbum = 'Mix de ' + valor;
    subtituloAlbum = 'Mix del artista';
  }

  // Verificar si hay canciones
  if (cancionesAlbum.length === 0) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const pagina = document.getElementById('page-album');
    pagina.classList.add('active');
    pagina.innerHTML = `<div style="text-align:center;padding:40px;color:#a0aec0">
      <h2>${tituloAlbum || 'Álbum'}</h2>
      <p>No se encontraron canciones.</p>
      <button onclick="cerrarPaginaAlbum()" style="margin-top:20px;background:var(--accent2);color:#fff;border:none;border-radius:20px;padding:10px 24px;cursor:pointer">Volver</button>
    </div>`;
    return;
  }

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const pagina = document.getElementById('page-album');
  pagina.classList.add('active');
  pagina.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;padding:16px 16px 0">
      <button onclick="cerrarPaginaAlbum()" style="background:rgba(255,255,255,0.1);border:none;color:#fff;border-radius:50%;width:36px;height:36px;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center">←</button>
      <h2 style="font-size:18px;font-weight:700;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${tituloAlbum}</h2>
    </div>
    <div style="padding:24px 16px 0;text-align:center">
      <div style="width:200px;height:200px;background:${COLORES_GENERO[valor] || 'linear-gradient(135deg,#4c1d95,#7c3aed)'};border-radius:12px;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;font-size:60px">🎵</div>
      <div style="font-weight:700;font-size:22px">${tituloAlbum}</div>
      <div style="color:#a0aec0;font-size:13px;margin-top:4px">${cancionesAlbum.length} canciones</div>
      <div style="display:inline-flex;align-items:center;gap:6px;background:rgba(124,58,237,0.2);border-radius:20px;padding:4px 12px;margin-top:8px;font-size:12px">🎵 SoundMind</div>
      <div style="color:#a0aec0;font-size:11px;margin-top:6px">${subtituloAlbum} · Generado por IA</div>
    </div>
    <div style="display:flex;gap:12px;padding:20px 16px 0;justify-content:center">
      <button onclick="shuffleYReproducir(${JSON.stringify(cancionesAlbum.map(c=>c.id))})" style="flex:1;max-width:140px;background:rgba(255,255,255,0.1);border:none;color:#fff;border-radius:24px;padding:10px;cursor:pointer;font-size:14px">⇌ Aleatorio</button>
      <button onclick="reproducirDesde(${JSON.stringify(cancionesAlbum.map(c=>c.id))}, 0)" style="flex:1;max-width:140px;background:#7c3aed;border:none;color:#fff;border-radius:24px;padding:10px;cursor:pointer;font-weight:700;font-size:14px">▶ Reproducir todo</button>
    </div>
    <div style="padding:16px">${cancionesAlbum.map(c => `
      <div data-cancion-id="${c.id}" style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.06)">
        <img src="${c.url_imagen || ''}" style="width:50px;height:50px;border-radius:8px;object-fit:cover;flex-shrink:0">
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.titulo}</div>
          <div style="font-size:12px;color:#a0aec0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.artista}</div>
          <span style="font-size:10px;background:rgba(124,58,237,0.3);color:#c4b5fd;padding:2px 8px;border-radius:10px;margin-top:4px;display:inline-block">${c.genero}</span>
        </div>
        <button onclick="playSong(null, ${c.id})" style="background:rgba(124,58,237,0.2);border:none;color:#fff;border-radius:50%;width:32px;height:32px;cursor:pointer;font-size:14px">▶</button>
        <button onclick="openContextMenu(event, ${c.id})" style="background:none;border:none;color:#a0aec0;font-size:18px;cursor:pointer;padding:4px">⋮</button>
      </div>`).join('')}</div>`;
}

function cerrarPaginaAlbum() {
  document.getElementById('page-album').classList.remove('active');
  document.getElementById(paginaAnterior)?.classList.add('active');
}

function shuffleYReproducir(arrayIds) {
  if (!arrayIds || arrayIds.length === 0) return;
  const mezclado = [...arrayIds].sort(() => Math.random() - 0.5);
  reproducirDesde(mezclado, 0);
}

function reproducirDesde(arrayIds, indice) {
  if (!arrayIds || arrayIds.length === 0) return;
  playSong(null, arrayIds[indice]);
  supabase.from('cola_reproduccion').delete().eq('usuario_id', currentUser.id).then(() => {
    const resto = arrayIds.filter((_, i) => i !== indice).map((cid, pos) => ({ usuario_id: currentUser.id, cancion_id: cid, posicion: pos }));
    if (resto.length > 0) supabase.from('cola_reproduccion').upsert(resto).then(() => actualizarPanelSiguiente());
  });
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
  const opciones = document.querySelector('.context-options');
  opciones.innerHTML = `
    <button onclick="contextAction('share')">🔗 Compartir</button>
    <button onclick="contextAction('playlist')">➕ Añadir a Playlist</button>
    <button onclick="contextAction('hide')">✕ Ocultar en esta lista</button>
    <button onclick="contextAction('queue')">⬆️ Añadir a la cola</button>
    <button onclick="contextAction('gotoqueue')">☰ Ir a la cola</button>
    <button onclick="contextAction('album')">💿 Ir al álbum</button>
  `;
  document.getElementById('contextMenu').classList.remove('hidden');
}

function closeContextMenu() {
  document.getElementById('contextMenu').classList.add('hidden');
}

async function contextAction(action) {
  if (!contextSongId) return;
  const song = allSongs.find(s => s.id === contextSongId);
  if (!song) return;
  switch(action) {
    case 'share':
      const texto = `${song.titulo} - ${song.artista} | SoundMind`;
      if (navigator.share) await navigator.share({ title: song.titulo, text: texto, url: window.location.href });
      else { await navigator.clipboard.writeText(texto); toast('📋 Enlace copiado'); }
      break;
    case 'playlist': toggleAddToPlaylist(null, contextSongId); break;
    case 'hide': ocultarCancion(contextSongId); break;
    case 'queue': anadirACola(currentUser.id, contextSongId); break;
    case 'gotoqueue': closeContextMenu(); openQueueModal(); break;
    case 'album': abrirPaginaAlbum('genero', song.genero); break;
  }
  closeContextMenu();
}

function ocultarCancion(cancionId) {
  const fila = document.querySelector(`[data-cancion-id="${cancionId}"]`);
  if (fila) {
    fila.style.transition = 'opacity 0.3s, max-height 0.3s';
    fila.style.opacity = '0';
    fila.style.maxHeight = '0';
    setTimeout(() => fila.remove(), 300);
  }
  toast('Canción ocultada en esta sesión');
}

async function anadirACola(usuarioId, cancionId) {
  const { data: cola } = await supabase.from('cola_reproduccion').select('posicion').eq('usuario_id', usuarioId).order('posicion', { ascending: false }).limit(1);
  const ultimaPosicion = cola && cola.length > 0 ? cola[0].posicion + 1 : 0;
  const { error } = await supabase.from('cola_reproduccion').upsert({ usuario_id: usuarioId, cancion_id: cancionId, posicion: ultimaPosicion }, { onConflict: 'usuario_id,cancion_id' });
  if (!error) { toast('✓ Añadida a la cola'); actualizarPanelSiguiente(); }
  else toast('Ya está en la cola');
}

async function actualizarPanelSiguiente() {
  const { data: cola } = await supabase.from('cola_reproduccion').select(`posicion, canciones(id, titulo, artista, url_imagen, url_preview)`).eq('usuario_id', currentUser.id).order('posicion');
  const list = document.getElementById('rightQueueList');
  if (!list) return;
  const colaFiltrada = cola ? cola.filter(c => c.canciones) : [];
  list.innerHTML = colaFiltrada.map(c => `
    <li onclick="playSong(null, ${c.canciones.id})">
      <img src="${c.canciones.url_imagen || ''}" onerror="this.style.display='none'">
      ${esc(c.canciones.titulo)}
    </li>
  `).join('');
}

/* ═══════════════════ HISTORIAL ══════════════════ */
async function registrarEnHistorial(usuarioId, cancionId) {
  await supabase.from('historial_reproduccion').insert({ usuario_id: usuarioId, cancion_id: cancionId });
}

/* ═══════════════════ CONTADORES HEADER ══════════════════ */
async function actualizarContadoresHeader() {
  if (!currentUser) return;
  try {
    const { count: totalCanciones } = await supabase.from('canciones').select('*', { count: 'exact', head: true });
    const { count: totalLikes } = await supabase.from('interacciones').select('*', { count: 'exact', head: true }).eq('usuario_id', currentUser.id).eq('es_like', true);
    const { count: totalFavoritos } = await supabase.from('interacciones').select('*', { count: 'exact', head: true }).eq('usuario_id', currentUser.id).eq('es_favorito', true);
    txt('stat-canciones', totalCanciones || 0);
    txt('stat-likes', totalLikes || 0);
    txt('stat-favoritos', totalFavoritos || 0);
  } catch(e) {
    txt('stat-canciones', allSongs.length);
    txt('stat-likes', myInter.filter(i=>i.es_like).length);
    txt('stat-favoritos', myInter.filter(i=>i.es_favorito).length);
  }
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
function getPlaylistSongs() {
  return allSongs.filter(s => userPlaylist.includes(s.id));
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

  updateRightPanel(song);
  updateMoreLikeSection(song);
  registrarEnHistorial(currentUser.id, songId);

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
      if (audio.currentTime > 0 || audio.duration > 0) {} else {
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

/* ═══════════════════ CHAT EN TIEMPO REAL ══════════════════ */
let chatSubscription = null;
let rankingSubscription = null;   // ← nueva

function initChat() {
  loadChatMessages();

  if (chatSubscription) return;   // evitar doble suscripción

  console.log('🔔 Iniciando suscripción de chat en tiempo real...');
  chatSubscription = supabase
    .channel('public:messages')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'mensajes' },
      payload => {
        const newMsg = payload.new;
        console.log('📩 Nuevo mensaje recibido:', newMsg);
        
        // Buscar si hay un mensaje temporal que coincida (mismo usuario y texto)
        for (const [tempId, tempData] of pendingTempMessages.entries()) {
          if (tempData.username === newMsg.username && tempData.texto === newMsg.mensaje) {
            // Reemplazar el elemento temporal con el real
            const tempElement = tempData.element;
            if (tempElement) {
              tempElement.setAttribute('data-msg-id', newMsg.id);
              const isMine = currentUser && newMsg.user_id === currentUser.id;
              if (isMine) {
                tempElement.innerHTML = esc(newMsg.mensaje);
              } else {
                tempElement.innerHTML = `<div class="msg-user">${esc(newMsg.username)}</div>${esc(newMsg.mensaje)}`;
                const hue = hashCode(newMsg.user_id || newMsg.username) % 360;
                tempElement.style.backgroundColor = `hsla(${hue}, 60%, 25%, 0.6)`;
              }
            }
            pendingTempMessages.delete(tempId);
            displayedMessageIds.add(newMsg.id);
            return; // ya reemplazado
          }
        }

        // Si no era un mensaje temporal nuestro, simplemente añadirlo
        addMessageToUI(newMsg);
        const container = document.getElementById('chatMessagesPanel');
        if (container) container.scrollTop = container.scrollHeight;
      }
    )
    .subscribe((status) => {
      console.log('📡 Estado de suscripción:', status);
    });
}

function initRealtimeRanking() {
  if (rankingSubscription) return; // evitar duplicados

  console.log('🔄 Iniciando suscripción de ranking en tiempo real...');
  rankingSubscription = supabase
    .channel('public:interacciones')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'interacciones' },
      () => {
        // Solo actualizamos si existe el contenedor del ranking (puede estar en otra página pero igual lo pintamos)
        renderizarRankingGlobal();
      }
    )
    .subscribe((status) => {
      console.log('📡 Estado suscripción ranking:', status);
    });
}

function loadChatMessages() {
  fetch(`${API_BASE}/api/messages`)
    .then(r => r.json())
    .then(data => {
      const container = document.getElementById('chatMessagesPanel');
      if (container) {
        container.innerHTML = '';
        displayedMessageIds.clear();   // Limpiar IDs para que se muestre el historial completo
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

  // Evitar duplicados usando el ID real (los temporales no se guardan en el set)
  if (typeof msg.id === 'number' || (typeof msg.id === 'string' && !msg.id.startsWith('temp_'))) {
    if (displayedMessageIds.has(msg.id)) return;
    displayedMessageIds.add(msg.id);
  }

  const div = document.createElement('div');
  const isMine = currentUser && msg.user_id === currentUser.id;
  div.className = 'msg-bubble' + (isMine ? ' my-msg' : '');
  div.setAttribute('data-msg-id', msg.id);

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

  // Mostrar mensaje temporal inmediatamente
  const tempId = 'temp_' + Date.now() + '_' + Math.random();
  const tempMsg = {
    id: tempId,
    user_id: currentUser.id,
    username: currentUser.nombre || currentUser.username,
    mensaje: mensaje,
    created_at: new Date().toISOString()
  };
  
  // Añadir al DOM directamente
  addMessageToUI(tempMsg);
  
  // Guardar referencia para después reemplazar cuando llegue el real
  const tempElement = document.querySelector(`[data-msg-id="${tempId}"]`);
  if (tempElement) {
    pendingTempMessages.set(tempId, {
      element: tempElement,
      username: tempMsg.username,
      texto: mensaje
    });
  }

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
    // Eliminar el mensaje temporal en caso de error
    if (tempElement) tempElement.remove();
    pendingTempMessages.delete(tempId);
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
    document.getElementById('searchInputBig').value = '';
    searchQuery = '';
    renderCatalog();
  }
  else if (name === 'recomendaciones') {
    renderHomeRec();
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
  const { data } = await supabase.from('canciones').select('*').order('id', { ascending: true });
  allSongs = data || [];

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

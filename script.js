/* ════════════════════════════════════════════════════
   SoundMind — script.js (v7 final con nuevas funciones)
   - Imágenes, voz, likes/favs, IA
   - Discover Weekly, perfil, logros, sleep timer, efectos, cola
════════════════════════════════════════════════════ */

const SUPA_URL = 'https://jhlktvdylbiieeuwykgj.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpobGt0dmR5bGJpaWVldXd5a2dqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMzIwNjMsImV4cCI6MjA5NTkwODA2M30.jie5MZF36VXhsfEZggCCWJ3M5HQVShGmyss6f-nLa3s';
const db = supabase.createClient(SUPA_URL, SUPA_KEY);

/* ── State ── */
let currentUser  = null;
let allSongs     = [];
let myInter      = [];
let allInter     = [];
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

// ── Nuevas variables globales ──
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
  'Latino':'💃','Alternativo':'🌊','Trap':'🎧','Balada':'🎻','default':'🎵'
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
    const [songsRes,myRes,allRes]=await Promise.all([
      db.from('canciones').select('*').order('popularidad',{ascending:false}),
      db.from('interacciones').select('*').eq('usuario_id',currentUser.id),
      db.from('interacciones').select('*')
    ]);
    allSongs=songsRes.data||[];
    myInter =myRes.data ||[];
    allInter=allRes.data||[];
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

/* ═══════════════════ VOICE SEARCH (fuzzy) ══════════════════ */
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

/* ── Song Card (con imagen) ── */
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

/* ── Populars (interacciones reales) ── */
function computePopularSongs(){
  const interactionCount = {};
  allInter.forEach(inter => {
    if (inter.es_like || inter.es_favorito) {
      interactionCount[inter.cancion_id] = (interactionCount[inter.cancion_id] || 0) + 1;
    }
  });
  return allSongs
    .filter(s => interactionCount[s.id])
    .sort((a, b) => (interactionCount[b.id] || 0) - (interactionCount[a.id] || 0));
}

function renderHomePopular() {
  const popular = computePopularSongs();
  if (popular.length === 0) {
    renderCards([], 'homePopCards', 'Aún no hay suficientes interacciones en la comunidad para mostrar populares.');
  } else {
    renderCards(popular.slice(0, 10), 'homePopCards');
  }
}

/* ── Home Rec (IA) ── */
function renderHomeRec(){
  const collab=aiCollaborative();
  const model=buildModel();
  const myIds=new Set(myInter.map(i=>i.cancion_id));
  const tree=model?allSongs.filter(s=>!myIds.has(s.id)&&predictTree(s,model)):[];
  const seen=new Set(); const rec=[];
  for(const s of [...collab,...tree,...allSongs]){
    if(!seen.has(s.id)&&!myIds.has(s.id)){ seen.add(s.id); rec.push(s) }
    if(rec.length>=10) break;
  }
  renderCards(rec,'homeRecCards','Da likes a canciones para recibir recomendaciones personalizadas.', 'global');
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

/* ═══════════════════ AI ALGORITHMS ══════════════════ */
function aiCollaborative() {
  const myWeights = {};
  myInter.forEach(inter => {
    if (inter.es_like) myWeights[inter.cancion_id] = (myWeights[inter.cancion_id] || 0) + 1;
    if (inter.es_favorito) myWeights[inter.cancion_id] = (myWeights[inter.cancion_id] || 0) + 0.5;
  });
  const myLikedSongs = Object.keys(myWeights);
  if (myLikedSongs.length === 0) return [];

  const others = {};
  allInter.forEach(inter => {
    if (inter.usuario_id === currentUser.id) return;
    if (!inter.es_like && !inter.es_favorito) return;
    if (!others[inter.usuario_id]) others[inter.usuario_id] = {};
    const weight = inter.es_like ? 1 : 0.5;
    others[inter.usuario_id][inter.cancion_id] = (others[inter.usuario_id][inter.cancion_id] || 0) + weight;
  });

  const sims = [];
  for (const [uid, neighborWeights] of Object.entries(others)) {
    let intersection = 0;
    let normU = 0, normV = 0;
    for (const songId of myLikedSongs) {
      const wu = myWeights[songId] || 0;
      const wv = neighborWeights[songId] || 0;
      intersection += wu * wv;
    }
    for (const w of Object.values(myWeights)) normU += w * w;
    for (const w of Object.values(neighborWeights)) normV += w * w;
    const sim = intersection / (Math.sqrt(normU) * Math.sqrt(normV) || 1);
    if (sim > 0) sims.push({ uid, sim, neighborWeights });
  }
  sims.sort((a, b) => b.sim - a.sim);

  const candidates = {};
  sims.slice(0, 3).forEach(n => {
    for (const [songId, weight] of Object.entries(n.neighborWeights)) {
      if (myWeights[songId]) continue;
      candidates[songId] = (candidates[songId] || 0) + (n.sim * weight);
    }
  });
  return Object.entries(candidates)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => allSongs.find(s => s.id == id))
    .filter(Boolean);
}

function buildModel(){
  const datos=[];
  for(const inter of allInter){
    const song=allSongs.find(s=>s.id===inter.cancion_id);
    if(!song) continue;
    datos.push({energia:song.energia,bailabilidad:song.bailabilidad,popularidad:song.popularidad,genero:song.genero,like:(inter.es_like||inter.es_favorito)?1:0});
  }
  if(datos.length<3) return null;
  const byGenre={};
  for(const d of datos){
    if(!byGenre[d.genero]) byGenre[d.genero]={likes:0,total:0};
    byGenre[d.genero].total++;
    if(d.like) byGenre[d.genero].likes++;
  }
  const avg=arr=>arr.length?arr.reduce((a,b)=>a+b,0)/arr.length:0;
  return{datos,byGenre,
    avgEn :avg(datos.map(d=>d.energia)),
    avgBai:avg(datos.map(d=>d.bailabilidad)),
    avgPop:avg(datos.map(d=>d.popularidad)),
    accuracy:Math.round((Math.max(datos.filter(d=>d.like).length,datos.length-datos.filter(d=>d.like).length)/datos.length)*100)
  };
}
function predictTree(song,model){
  if(!model) return false;
  const gd=model.byGenre[song.genero];
  const rate=gd?gd.likes/gd.total:0.5;
  let score=0;
  if(rate>0.55) score+=3; else if(rate>0.4) score+=1;
  if(song.energia>=model.avgEn-0.05)       score+=1;
  if(song.bailabilidad>=model.avgBai-0.05) score+=1;
  if(song.popularidad>=model.avgPop)       score+=1;
  return score>=4;
}

function recursivePlaylist(seedId,depth,visited=new Set()){
  if(depth===0||!seedId) return [];
  const seed=allSongs.find(s=>s.id===seedId);
  if(!seed||visited.has(seedId)) return [];
  visited.add(seedId);
  const next=allSongs
    .filter(s=>!visited.has(s.id))
    .map(s=>({s,score:(s.genero===seed.genero?3:0)+(1-Math.abs(s.energia-seed.energia))*2+(1-Math.abs(s.bailabilidad-seed.bailabilidad))*2+(1-Math.abs(s.popularidad-seed.popularidad)/100)}))
    .sort((a,b)=>b.score-a.score)[0];
  if(!next) return [];
  return [next.s,...recursivePlaylist(next.s.id,depth-1,visited)];
}

/* ═══════════════════ INTERACTIONS (Likes/Favs) ══════════════════ */
async function toggleLike(e,songId){
  e.stopPropagation();
  const ex=myInter.find(i=>i.cancion_id===songId);
  if(ex){
    const nv=!ex.es_like;
    const {error} = await db.from('interacciones').update({es_like:nv}).eq('id',ex.id);
    if (error) { toast('Error al actualizar like'); return; }
    ex.es_like=nv;
    toast(nv?'❤️ Like añadido':'Like eliminado');
  } else {
    const {data,error} = await db.from('interacciones').insert({usuario_id:currentUser.id,cancion_id:songId,es_like:true,es_favorito:false}).select().single();
    if (error) { toast('Error al dar like'); return; }
    if(data) myInter.push(data);
    toast('❤️ Like añadido');
  }
  await refreshAllInter();
  await saveRecommendations();
  renderAll();
  checkAchievements();
}

async function toggleFav(e,songId){
  e.stopPropagation();
  const ex=myInter.find(i=>i.cancion_id===songId);
  if(ex){
    const nv=!ex.es_favorito;
    const {error} = await db.from('interacciones').update({es_favorito:nv}).eq('id',ex.id);
    if (error) { toast('Error al actualizar favorito'); return; }
    ex.es_favorito=nv;
    toast(nv?'⭐ Favorito añadido':'Favorito eliminado');
  } else {
    const {data,error} = await db.from('interacciones').insert({usuario_id:currentUser.id,cancion_id:songId,es_like:false,es_favorito:true}).select().single();
    if (error) { toast('Error al dar favorito'); return; }
    if(data) myInter.push(data);
    toast('⭐ Favorito añadido');
  }
  await saveRecommendations();
  renderAll();
  checkAchievements();
}

async function refreshAllInter(){
  const{data}=await db.from('interacciones').select('*');
  allInter=data||[];
}

async function saveRecommendations(){
  try{
    const collab=aiCollaborative();
    const model=buildModel();
    const myIds=new Set(myInter.map(i=>i.cancion_id));
    const tree=model?allSongs.filter(s=>!myIds.has(s.id)&&predictTree(s,model)):[];
    await db.from('usuarios').update({
      recomendacion1:collab[0]?.titulo||null,
      recomendacion2:tree[0]?.titulo||null
    }).eq('id',currentUser.id);
  }catch(_){}
}

/* ═══════════════════ PLAYER (con imágenes, efectos y actualización de cola) ══════════════════ */
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

/* Saltos de 15s */
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

/* Volumen */
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

    const next=recursivePlaylist(nowPlayingId,1,new Set([nowPlayingId]));
    if(next.length>0) playSong(null,next[0].id, playlistContext);
    else playNextInContext();
  }
}

/* ═══════════════════ NUEVAS FUNCIONES ══════════════════ */

// ── Discover Weekly ──
function getWeeklyData() {
  try { return JSON.parse(localStorage.getItem('weeklyData')) || null; } catch { return null; }
}
function saveWeeklyData(data) {
  localStorage.setItem('weeklyData', JSON.stringify(data));
}

async function generateWeekly() {
  const likedSongs = myInter.filter(i => i.es_like || i.es_favorito);
  if (likedSongs.length === 0) return [];
  const best = likedSongs.sort((a,b) => (b.es_like?1:0)+(b.es_favorito?0.5:0) - ((a.es_like?1:0)+(a.es_favorito?0.5:0)))[0];
  const seedSong = allSongs.find(s => s.id === best.cancion_id);
  if (!seedSong) return [];
  return recursivePlaylist(seedSong.id, 12);
}

function renderWeekly() {
  const weeklyDiv = $('weeklyCards');
  if (!weeklyDiv) return;
  const data = getWeeklyData();
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  monday.setHours(0,0,0,0);

  if (!data || new Date(data.weekStart) < monday) {
    generateWeekly().then(songs => {
      if (songs.length > 0) {
        saveWeeklyData({ weekStart: monday.toISOString(), songs: songs.map(s => s.id) });
        renderCards(songs, 'weeklyCards', 'Aún no hay suficientes datos.');
      } else {
        weeklyDiv.innerHTML = '<div class="empty-state"><p>Dale like a más canciones para activar Discover Weekly.</p></div>';
      }
    });
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

// ── Sleep Timer ──
function toggleSleepMenu() {
  const menu = $('sleepMenu');
  if (menu) menu.classList.toggle('hidden');
}
function setSleepTimer(minutes) {
  clearSleepTimer();
  const countdownEl = $('sleepCountdown');
  const expCountdownEl = $('expSleepCountdown');
  let remaining = minutes * 60;
  const updateCountdown = () => {
    const min = Math.floor(remaining / 60);
    const sec = remaining % 60;
    const text = `${min}:${sec < 10 ? '0' : ''}${sec}`;
    if (countdownEl) { countdownEl.textContent = text; countdownEl.classList.remove('hidden'); }
    if (expCountdownEl) { expCountdownEl.textContent = text; expCountdownEl.classList.remove('hidden'); }
  };
  updateCountdown();
  $('sleepMenu')?.classList.add('hidden');

  sleepTimer = setInterval(() => {
    remaining--;
    updateCountdown();
    if (remaining <= 0) {
      clearSleepTimer();
      togglePlayPause();
      if (countdownEl) countdownEl.classList.add('hidden');
      if (expCountdownEl) expCountdownEl.classList.add('hidden');
      toast('⏰ Temporizador finalizado');
    }
  }, 1000);
}
function clearSleepTimer() {
  if (sleepTimer) {
    clearInterval(sleepTimer);
    sleepTimer = null;
  }
  $('sleepCountdown')?.classList.add('hidden');
  $('expSleepCountdown')?.classList.add('hidden');
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

// ── Cola de reproducción ──
function updateQueue() {
  if (playlistContext === 'favorites') {
    queue = getFavoriteSongs().filter(s => s.id !== nowPlayingId);
  } else if (playlistContext === 'likes') {
    queue = getLikedSongs().filter(s => s.id !== nowPlayingId);
  } else {
    if (nowPlayingId) {
      queue = recursivePlaylist(nowPlayingId, 10, new Set([nowPlayingId]));
    } else {
      queue = allSongs.slice(0, 20);
    }
  }
  renderQueueUI();
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

/* ═══════════════════ NAVIGATION & PANEL IA ══════════════════ */
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

/* ── Panel IA (sin cambios) ── */
function renderAnalysis(){
  updateAnalysisMetrics();
  renderGenreBarChart();
  renderTreeRules();
  renderCrossValidation();
}
// ... (resto de funciones del panel IA igual) ...

/* ═══════════════════ INIT ══════════════════ */
window.addEventListener('load', async ()=>{
  if (!loadSession()) { window.location.href = 'explore.html'; return; }
  const { data } = await db.from('canciones').select('*').order('popularidad', { ascending: false });
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

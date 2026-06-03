/* ════════════════════════════════════════════════════
   SoundMind — script.js (v4 final)
   - Sesión separada (redirige a login.html).
   - Populares basados en interacciones reales.
   - Recomendaciones con IA en segundo plano.
   - Contexto de reproducción (favorites, likes, global).
   - Panel IA con validación cruzada, métricas, casos de éxito.
   - Diseño moderno, adaptable.
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

/* ════════════════════════════════════════════════════
   SESSION
════════════════════════════════════════════════════ */
const SESSION_KEY = 'soundmind_user';

function saveSession(user){ localStorage.setItem(SESSION_KEY, JSON.stringify(user)) }
function loadSession(){ try{ return JSON.parse(localStorage.getItem(SESSION_KEY)||'null') }catch(_){ return null } }
function clearSession(){ localStorage.removeItem(SESSION_KEY) }

function checkSession(){
  const saved = loadSession();
  if (!saved) { window.location.href = 'login.html'; return false; }
  currentUser = saved;
  return true;
}

/* ════════════════════════════════════════════════════
   BOOT
════════════════════════════════════════════════════ */
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
  showPage('home');
  initVoiceSearch();
}

/* ════════════════════════════════════════════════════
   LOGOUT
════════════════════════════════════════════════════ */
async function doLogout(){
  currentUser=null; myInter=[]; allInter=[]; nowPlayingId=null;
  clearSession();
  stopVisRaf();
  const audio=$('audioEl');
  if(audio){ audio.pause(); audio.removeAttribute('src') }
  $('plDisc')?.classList.remove('spinning');
  updatePlayPauseBtn(false);
  window.location.href = 'login.html';
}

/* ════════════════════════════════════════════════════
   VOICE SEARCH
════════════════════════════════════════════════════ */
function initVoiceSearch(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){ const vb=$('voiceBtn'); if(vb) vb.style.opacity='.35'; return }
  recognition=new SR();
  recognition.lang='es-ES';
  recognition.continuous=false;
  recognition.interimResults=true;

  recognition.onstart=()=>{
    isListening=true;
    $('voiceBtn').classList.add('listening');
    $('voiceOverlay').classList.add('show');
    txt('voiceTranscript','Escuchando…');
  };
  recognition.onend=()=>{
    isListening=false;
    $('voiceBtn').classList.remove('listening');
    setTimeout(()=>$('voiceOverlay').classList.remove('show'),500);
  };
  recognition.onerror=(e)=>{
    isListening=false;
    $('voiceBtn').classList.remove('listening');
    $('voiceOverlay').classList.remove('show');
    toast('⚠️ Micrófono: '+e.error);
  };
  recognition.onresult=(e)=>{
    const tr=Array.from(e.results).map(r=>r[0].transcript).join('');
    txt('voiceTranscript','"'+tr+'"');
    if(e.results[0].isFinal){
      searchQuery=tr.toLowerCase();
      const si=$('searchInput'); if(si) si.value=tr;
      renderAll();
      toast('🎤 Buscando: '+tr);
    }
  };
}

function toggleVoice(){
  if(!recognition){ toast('⚠️ Voz no disponible en este navegador'); return }
  if(isListening) recognition.stop();
  else recognition.start();
}

/* ════════════════════════════════════════════════════
   RENDER ALL
════════════════════════════════════════════════════ */
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

/* ── Song Card (con contexto) ── */
function songCard(s, context = 'global'){
  const inter  =myInter.find(i=>i.cancion_id===s.id);
  const liked  =inter&&inter.es_like;
  const faved  =inter&&inter.es_favorito;
  const playing=nowPlayingId===s.id;
  const ctxParam = context === 'global' ? '' : `, '${context}'`;
  return `<div class="song-card${liked?' liked':''}${faved?' faved':''}${playing?' playing':''}" data-id="${s.id}">
    <div class="card-cover">
      <div class="card-cover-inner" style="background:${genreGradient(s.genero)}">${genreEmoji(s.genero)}</div>
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
      <div class="card-actions">
        <button class="cta${liked?' liked-btn':''}" onclick="toggleLike(event,${s.id})">${liked?'❤️':'🤍'}</button>
        <button class="cta${faved?' faved-btn':''}" onclick="toggleFav(event,${s.id})">${faved?'⭐':'☆'}</button>
        <button class="cta play-btn" onclick="playSong(event,${s.id}${ctxParam})">▶ Play</button>
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

/* ── Populars basados en interacciones ── */
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

/* ════════════════════════════════════════════════════
   AI ALGORITHMS
════════════════════════════════════════════════════ */
function aiCollaborative(){
  const myLiked=new Set(myInter.filter(i=>i.es_like||i.es_favorito).map(i=>i.cancion_id));
  if(myLiked.size===0) return [];
  const others={};
  for(const inter of allInter){
    if(inter.usuario_id===currentUser.id) continue;
    if(!(inter.es_like||inter.es_favorito)) continue;
    if(!others[inter.usuario_id]) others[inter.usuario_id]=new Set();
    others[inter.usuario_id].add(inter.cancion_id);
  }
  const sims=[];
  for(const[uid,likedSet] of Object.entries(others)){
    let comunes=0;
    for(const id of myLiked) if(likedSet.has(id)) comunes++;
    const sim=comunes/Math.min(myLiked.size,likedSet.size);
    if(sim>0) sims.push({uid,sim,likedSet});
  }
  sims.sort((a,b)=>b.sim-a.sim);
  const candidates=new Set();
  for(const v of sims.slice(0,3)) for(const id of v.likedSet) if(!myLiked.has(id)) candidates.add(id);
  return allSongs.filter(s=>candidates.has(s.id));
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

/* ════════════════════════════════════════════════════
   INTERACTIONS
════════════════════════════════════════════════════ */
async function toggleLike(e,songId){
  e.stopPropagation();
  const ex=myInter.find(i=>i.cancion_id===songId);
  if(ex){
    const nv=!ex.es_like;
    await db.from('interacciones').update({es_like:nv}).eq('id',ex.id);
    ex.es_like=nv;
    toast(nv?'❤️ Like añadido':'Like eliminado');
  } else {
    const{data}=await db.from('interacciones').insert({usuario_id:currentUser.id,cancion_id:songId,es_like:true,es_favorito:false}).select().single();
    if(data) myInter.push(data);
    toast('❤️ Like añadido');
  }
  await refreshAllInter();
  await saveRecommendations();
  renderAll();
}

async function toggleFav(e,songId){
  e.stopPropagation();
  const ex=myInter.find(i=>i.cancion_id===songId);
  if(ex){
    const nv=!ex.es_favorito;
    await db.from('interacciones').update({es_favorito:nv}).eq('id',ex.id);
    ex.es_favorito=nv;
    toast(nv?'⭐ Favorito añadido':'Favorito eliminado');
  } else {
    const{data}=await db.from('interacciones').insert({usuario_id:currentUser.id,cancion_id:songId,es_like:false,es_favorito:true}).select().single();
    if(data) myInter.push(data);
    toast('⭐ Favorito añadido');
  }
  await saveRecommendations();
  renderAll();
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

/* ════════════════════════════════════════════════════
   PLAYER — contexto de reproducción
════════════════════════════════════════════════════ */

function setPlaylistContext(context){
  playlistContext = context;
}

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

  const dc = $('plDiscCover');
  dc.style.background = genreGradient(song.genero);
  dc.innerHTML = genreEmoji(song.genero);
  dc.className = 'pl-disc-cover';

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
    audio.play().then(()=>{ $('plDisc').classList.add('spinning'); updatePlayPauseBtn(true) });
  } else {
    audio.pause();
    $('plDisc').classList.remove('spinning');
    updatePlayPauseBtn(false);
  }
}

function updatePlayPauseBtn(playing){
  const btn=$('playPauseBtn');
  if(btn) btn.textContent=playing?'⏸':'▶';
}

/* ── Visualizer ── */
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

/* ── Progress ── */
function updateProgress(){
  const audio=$('audioEl');
  if(!audio.duration) return;
  const pct=(audio.currentTime/audio.duration)*100;
  const fill=$('progressFill'); if(fill) fill.style.width=pct+'%';
  const ct=$('currentTime'),tt=$('totalTime');
  if(ct) ct.textContent=fmtTime(audio.currentTime);
  if(tt) tt.textContent=fmtTime(audio.duration);
}

function seekProgress(e){
  const audio=$('audioEl'); if(!audio.duration) return;
  const bar=$('progressBar');
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
  const icon=$('volIcon');
  if(icon) icon.textContent=val==0?'🔇':val<0.5?'🔉':'🔊';
}

function onAudioEnded(){
  $('plDisc').classList.remove('spinning');
  updatePlayPauseBtn(false);
  if(nowPlayingId){
    const next=recursivePlaylist(nowPlayingId,1,new Set([nowPlayingId]));
    if(next.length>0) playSong(null,next[0].id, playlistContext);
    else playNextInContext();
  }
}

/* ════════════════════════════════════════════════════
   NAVIGATION & PANEL IA
════════════════════════════════════════════════════ */
function showPage(name){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const pg=$('page-'+name), nv=$('nav-'+name);
  if(pg) pg.classList.add('active');
  if(nv) nv.classList.add('active');
  if(window.innerWidth<=900) $('sidebar').classList.remove('open');

  if(name === 'analysis') renderAnalysis();
}

function toggleSidebar(){ $('sidebar').classList.toggle('open') }

function renderAnalysis(){
  updateAnalysisMetrics();
  renderGenreBarChart();
  renderTreeRules();
  renderCrossValidation();
}

async function updateAnalysisMetrics(){
  try { const { count } = await db.from('usuarios').select('*', { count: 'exact', head: true }); txt('mUsers', count||0); } catch(e) { txt('mUsers', '—'); }
  txt('mSongs', allSongs.length);
  txt('mInter', allInter.length);
  const totalLikes = allInter.filter(i => i.es_like || i.es_favorito).length;
  txt('mLikes', totalLikes);
  const model = buildModel();
  txt('mAcc', model ? model.accuracy + '%' : '—');
  try { const { count } = await db.from('usuarios').select('*', { count: 'exact', head: true }); txt('mAvg', (totalLikes / (count||1)).toFixed(1)); } catch(e) { txt('mAvg', '—'); }
}

function renderGenreBarChart(){
  const myLikedSongs = myInter.filter(i => i.es_like || i.es_favorito);
  const genreCount = {};
  myLikedSongs.forEach(inter => {
    const song = allSongs.find(s => s.id === inter.cancion_id);
    if (song) genreCount[s.genero] = (genreCount[s.genero] || 0) + 1;
  });
  const sorted = Object.entries(genreCount).sort((a,b) => b[1] - a[1]);
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
}

function renderTreeRules(){
  const model = buildModel();
  if (!model) { $('treeViz').textContent = 'No hay suficientes datos para entrenar el árbol.'; return; }
  let text = '';
  for (const [genre, stats] of Object.entries(model.byGenre)) {
    const rate = (stats.likes / stats.total * 100).toFixed(0);
    text += `Si género = "${genre}" → tasa de likes = ${rate}%\n`;
  }
  text += `\nPromedios de atributos en likes:\n  energía ≥ ${model.avgEn.toFixed(2)}\n  bailabilidad ≥ ${model.avgBai.toFixed(2)}\n  popularidad ≥ ${model.avgPop.toFixed(2)}\n\nRegla final: Score ≥ 4 → Recomendar.`;
  $('treeViz').textContent = text;
}

async function renderCrossValidation(){
  const tbody = $('cvBody');
  tbody.innerHTML = '<tr><td colspan="5">Calculando…</td></tr>';
  const data = [];
  for (const inter of allInter) {
    const song = allSongs.find(s => s.id === inter.cancion_id);
    if (!song) continue;
    data.push({ energia: song.energia, bailabilidad: song.bailabilidad, popularidad: song.popularidad, genero: song.genero, like: (inter.es_like || inter.es_favorito) ? 1 : 0 });
  }
  if (data.length < 5) { tbody.innerHTML = '<tr><td colspan="5">Se necesitan al menos 5 interacciones.</td></tr>'; return; }
  const shuffled = data.sort(() => Math.random() - 0.5);
  const foldSize = Math.floor(shuffled.length / 5);
  let rows = '', totalAcc = 0;
  for (let k = 0; k < 5; k++) {
    const test = shuffled.slice(k * foldSize, (k + 1) * foldSize);
    const train = shuffled.filter((_, i) => i < k * foldSize || i >= (k + 1) * foldSize);
    const byGenre = {}; let sumEn = 0, sumBai = 0, sumPop = 0, likesCount = 0;
    train.forEach(d => {
      if (!byGenre[d.genero]) byGenre[d.genero] = { likes: 0, total: 0 };
      byGenre[d.genero].total++;
      if (d.like) { byGenre[d.genero].likes++; sumEn += d.energia; sumBai += d.bailabilidad; sumPop += d.popularidad; likesCount++; }
    });
    const avgEn = likesCount ? sumEn / likesCount : 0.5;
    const avgBai = likesCount ? sumBai / likesCount : 0.5;
    const avgPop = likesCount ? sumPop / likesCount : 50;
    let correct = 0, detectedLikes = 0;
    test.forEach(d => {
      const gd = byGenre[d.genero] || { likes: 0, total: 1 };
      const rate = gd.total ? gd.likes / gd.total : 0.5;
      let score = 0;
      if (rate > 0.55) score += 3; else if (rate > 0.4) score += 1;
      if (d.energia >= avgEn - 0.05) score += 1;
      if (d.bailabilidad >= avgBai - 0.05) score += 1;
      if (d.popularidad >= avgPop) score += 1;
      const pred = score >= 4 ? 1 : 0;
      if (pred === d.like) correct++;
      if (pred === 1 && d.like === 1) detectedLikes++;
    });
    const acc = Math.round((correct / test.length) * 100);
    totalAcc += acc;
    rows += `<tr><td>${k+1}</td><td>${train.length}</td><td>${test.length}</td><td class="${acc>=70?'good':acc>=50?'mid':''}">${acc}%</td><td>${detectedLikes}</td></tr>`;
  }
  const avgAcc = Math.round(totalAcc / 5);
  rows += `<tr><td colspan="3"><strong>Promedio</strong></td><td class="good"><strong>${avgAcc}%</strong></td><td></td></tr>`;
  tbody.innerHTML = rows;
}

/* ════════════════════════════════════════════════════
   INIT
════════════════════════════════════════════════════ */
window.addEventListener('load', async ()=>{
  if (!loadSession()) { window.location.href = 'login.html'; return; }

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
      if (sourceLinked) startVisRaf(); else startIdleVisualizer();
    });
    audio.addEventListener('pause', () => {
      $('plDisc')?.classList.remove('spinning');
      updatePlayPauseBtn(false);
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

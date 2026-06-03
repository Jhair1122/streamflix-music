/* ════════════════════════════════════════════════════
   SoundMind — script.js  (v2 — fixes: audio ctx,
   session persistence, nav simplificado)
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
/* Web Audio — se crea una sola vez y se reutiliza */
let audioCtx     = null;
let analyser     = null;
let sourceNode   = null;   // se crea UNA sola vez
let sourceLinked = false;  // flag: ya conectamos el <audio> al ctx
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
   SESSION PERSISTENCE  (localStorage)
════════════════════════════════════════════════════ */
const SESSION_KEY = 'soundmind_user';

function saveSession(user){
  try{ localStorage.setItem(SESSION_KEY, JSON.stringify(user)) }catch(_){}
}
function loadSession(){
  try{ return JSON.parse(localStorage.getItem(SESSION_KEY)||'null') }catch(_){ return null }
}
function clearSession(){
  try{ localStorage.removeItem(SESSION_KEY) }catch(_){}
}

/* ════════════════════════════════════════════════════
   AUTH
════════════════════════════════════════════════════ */
function switchTab(tab){
  $('tabLogin').classList.toggle('active',tab==='login');
  $('tabReg').classList.toggle('active',tab==='register');
  $('formLogin').classList.toggle('hidden',tab!=='login');
  $('formReg').classList.toggle('hidden',tab!=='register');
  txt('authMsg','');
}

async function doLogin(){
  const username=$('loginUser').value.trim();
  const password=$('loginPass').value.trim();
  if(!username||!password){ txt('authMsg','Completa todos los campos'); return }
  txt('authMsg','Verificando…');
  const {data,error}=await db.from('usuarios').select('*').eq('username',username).eq('password',password).maybeSingle();
  if(!data){ txt('authMsg',error?'Error de conexión':'Usuario o contraseña incorrectos'); return }
  currentUser=data;
  saveSession(data);
  await bootApp();
}

async function doRegister(){
  const nombre=$('regName').value.trim();
  const username=$('regUser').value.trim();
  const password=$('regPass').value.trim();
  if(!nombre||!username||!password){ txt('authMsg','Completa todos los campos'); return }
  if(username.length<3){ txt('authMsg','El usuario debe tener al menos 3 caracteres'); return }
  if(password.length<6){ txt('authMsg','La contraseña debe tener al menos 6 caracteres'); return }
  txt('authMsg','Creando cuenta…');
  const {data:ex}=await db.from('usuarios').select('id').eq('username',username).maybeSingle();
  if(ex){ txt('authMsg','Ese usuario ya existe, elige otro'); return }
  const {data,error}=await db.from('usuarios').insert({username,password,nombre}).select().single();
  if(!data){ txt('authMsg','Error: '+(error?.message||'desconocido')); return }
  currentUser=data;
  saveSession(data);
  await bootApp();
}

async function doLogout(){
  currentUser=null; myInter=[]; allInter=[]; nowPlayingId=null;
  clearSession();
  stopVisRaf();
  const audio=$('audioEl');
  if(audio){ audio.pause(); audio.removeAttribute('src') }
  $('plDisc')?.classList.remove('spinning');
  updatePlayPauseBtn(false);
  $('app').classList.add('hidden');
  $('authScreen').classList.remove('hidden');
  $('playerBar').classList.add('hidden');
  ['loginUser','loginPass','regName','regUser','regPass'].forEach(id=>{ const e=$(id); if(e) e.value='' });
  txt('authMsg','');
  txt('plTitle','Sin reproducción'); txt('plArtist','');
  const dc=$('plDiscCover'); if(dc){ dc.innerHTML='🎵'; dc.style.background='var(--bg3)'; dc.className='pl-disc-cover' }
  startIdleVisualizer();
}

/* ════════════════════════════════════════════════════
   BOOT
════════════════════════════════════════════════════ */
async function bootApp(){
  $('authScreen').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('playerBar').classList.remove('hidden');

  const initials=(currentUser.nombre||currentUser.username).slice(0,2).toUpperCase();
  txt('userAvatar',initials);
  txt('userName',currentUser.nombre||currentUser.username);
  txt('heroName',currentUser.nombre||currentUser.username);

  // ── Carga robusta: si falla, no expulsa al usuario ──
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
    // Mantenemos los arrays existentes (allSongs se precargó en el load)
    myInter = [];
    allInter = [];
  }

  buildGenrePills();
  renderAll();
  showPage('home');
  initVoiceSearch();
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
      renderCatalog();
      showPage('catalog');
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

/* ── Song Card ── */
function songCard(s){
  const inter  =myInter.find(i=>i.cancion_id===s.id);
  const liked  =inter&&inter.es_like;
  const faved  =inter&&inter.es_favorito;
  const playing=nowPlayingId===s.id;
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
        <button class="cta play-btn" onclick="playSong(event,${s.id})">▶ Play</button>
      </div>
    </div>
  </div>`;
}

function renderCards(songs,containerId,emptyMsg='No hay canciones aquí aún.'){
  const el=$(containerId); if(!el) return;
  if(!songs||!songs.length){
    el.innerHTML=`<div class="empty-state"><div class="empty-icon">🎵</div><p>${emptyMsg}</p></div>`;
    return;
  }
  el.innerHTML=songs.map(songCard).join('');
}

/* ── Home ── */
function renderHomePopular(){ renderCards(allSongs.slice(0,10),'homePopCards') }

function renderHomeRec(){
  /* Mezcla inteligente: colaborativo + árbol, sin duplicados, sin los ya-likeados */
  const collab=aiCollaborative();
  const model=buildModel();
  const myIds=new Set(myInter.map(i=>i.cancion_id));
  const tree=model?allSongs.filter(s=>!myIds.has(s.id)&&predictTree(s,model)):[];

  /* Unir priorizando colaborativo, luego árbol, luego popularidad */
  const seen=new Set(); const rec=[];
  for(const s of [...collab,...tree,...allSongs]){
    if(!seen.has(s.id)&&!myIds.has(s.id)){ seen.add(s.id); rec.push(s) }
    if(rec.length>=10) break;
  }
  renderCards(rec,'homeRecCards','Da likes a canciones para recibir recomendaciones personalizadas.');
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
  const songs=allSongs.filter(s=>
    (!activeGenre||s.genero===activeGenre)&&
    (!searchQuery||(s.titulo.toLowerCase().includes(searchQuery)||s.artista.toLowerCase().includes(searchQuery)))
  );
  txt('catalogCount',songs.length+' canciones');
  renderCards(songs,'catalogCards');
}

/* ── Library ── */
function renderFavorites(){
  const ids=new Set(myInter.filter(i=>i.es_favorito).map(i=>i.cancion_id));
  renderCards(allSongs.filter(s=>ids.has(s.id)),'favCards','Aún no tienes favoritos. Haz clic en ☆ en cualquier canción.');
}
function renderLikes(){
  const ids=new Set(myInter.filter(i=>i.es_like).map(i=>i.cancion_id));
  renderCards(allSongs.filter(s=>ids.has(s.id)),'likeCards','Aún no tienes likes. Haz clic en 🤍 en cualquier canción.');
}

/* ════════════════════════════════════════════════════
   AI ALGORITHMS  (corren en el fondo, sin páginas propias)
════════════════════════════════════════════════════ */

/* KNN Collaborative Filtering */
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

/* Decision Tree J48 */
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

/* Recursive Playlist */
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
   PLAYER — Disco + Visualizer
   FIX: createMediaElementSource se llama UNA sola vez.
   Cambiar src no requiere reconectar el grafo de audio.
════════════════════════════════════════════════════ */
async function playSong(e,songId){
  if(e) e.stopPropagation();
  const song=allSongs.find(s=>s.id===songId);
  if(!song) return;
  nowPlayingId=songId;

  txt('plTitle',song.titulo);
  txt('plArtist',song.artista);

  const dc=$('plDiscCover');
  dc.style.background=genreGradient(song.genero);
  dc.innerHTML=genreEmoji(song.genero);
  dc.className='pl-disc-cover';

  const audio=$('audioEl');
  if(song.url_preview){
    /* Cambiar src y reproducir — NO recrear el nodo de audio */
    audio.src=song.url_preview;
    audio.load();  // importante: resetea el buffer interno

    // 👇 NUEVO: reanudar AudioContext si está suspendido (política de autoplay)
    if (audioCtx && audioCtx.state === 'suspended') {
      try { await audioCtx.resume(); } catch(e) {}
    }
    // 👆 FIN NUEVO

    audio.play().then(()=>{
      $('plDisc').classList.add('spinning');
      updatePlayPauseBtn(true);
      /* Conectar al contexto solo la primera vez */
      ensureAudioContext(audio);
      toast('▶ '+song.titulo);
    }).catch(err=>{
      console.warn('play error:',err);
      toast('⚠️ No se pudo reproducir');
    });
  } else {
    audio.pause();
    audio.removeAttribute('src');
    $('plDisc').classList.remove('spinning');
    updatePlayPauseBtn(false);
    toast('⚠️ Sin archivo de audio para esta canción');
  }

  /* Refrescar solo las tarjetas para actualizar badge "Reproduciendo" */
  refreshCardHighlight();
}

/* Crea el grafo Web Audio UNA sola vez y lo deja conectado permanentemente.
   Cambiar audio.src no desconecta el grafo. */
function ensureAudioContext(audioEl){
  if(sourceLinked) return;  // ya está conectado, nada que hacer
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

/* Actualiza solo el highlight de tarjetas sin redibujar todo */
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
    /* Reanudar el contexto si fue suspendido (política de autoplay) */
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

/* Prev / Next */
function getPrevSong(){
  if(!nowPlayingId||!allSongs.length) return null;
  const idx=allSongs.findIndex(s=>s.id===nowPlayingId);
  return idx>0?allSongs[idx-1].id:allSongs[allSongs.length-1].id;
}
function getNextSong(){
  if(!nowPlayingId||!allSongs.length) return null;
  const idx=allSongs.findIndex(s=>s.id===nowPlayingId);
  return idx<allSongs.length-1?allSongs[idx+1].id:allSongs[0].id;
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
  /* Auto-play: siguiente por algoritmo recursivo */
  if(nowPlayingId){
    const next=recursivePlaylist(nowPlayingId,1,new Set([nowPlayingId]));
    if(next.length>0) playSong(null,next[0].id);
    else {
      const nextId=getNextSong();
      if(nextId) playSong(null,nextId);
    }
  }
}

/* ════════════════════════════════════════════════════
   NAVIGATION
════════════════════════════════════════════════════ */
function showPage(name){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const pg=$('page-'+name),nv=$('nav-'+name);
  if(pg) pg.classList.add('active');
  if(nv) nv.classList.add('active');
  if(window.innerWidth<=900) $('sidebar').classList.remove('open');
}

function toggleSidebar(){ $('sidebar').classList.toggle('open') }

/* ════════════════════════════════════════════════════
   INIT
════════════════════════════════════════════════════ */
window.addEventListener('load', async ()=>{
  /* 1. Precargar canciones (necesario para las helpers prev/next incluso antes del login) */
  const{data}=await db.from('canciones').select('*').order('popularidad',{ascending:false});
  allSongs=data||[];

  /* 2. Visualizer idle bars */
  const vizEl=$('audioVisualizer');
  if(vizEl){
    vizEl.innerHTML=Array.from({length:14},(_,i)=>
      `<div class="vis-bar idle" style="--d:${i*0.06}s"></div>`).join('');
  }

  /* 3. Audio events */
  const audio=$('audioEl');
  if(audio){
    audio.addEventListener('timeupdate',updateProgress);
    audio.addEventListener('ended',onAudioEnded);
    audio.addEventListener('play',()=>{
      if(audioCtx&&audioCtx.state==='suspended') audioCtx.resume();
      $('plDisc')?.classList.add('spinning');
      updatePlayPauseBtn(true);
      if(sourceLinked) startVisRaf(); else startIdleVisualizer();
    });
    audio.addEventListener('pause',()=>{
      $('plDisc')?.classList.remove('spinning');
      updatePlayPauseBtn(false);
      startIdleVisualizer();
    });
  }

  /* 4. Volume default */
  const volRange=$('volumeRange');
  if(volRange){ volRange.value=0.8; setVolume(0.8) }

  /* 5. Restaurar sesión — si hay usuario guardado, hacer boot directo */
  const saved=loadSession();
  if(saved){
    currentUser=saved;
    await bootApp();
  }
  /* Si no hay sesión, la pantalla de auth ya está visible por defecto */
});

/* Teclado */
document.addEventListener('keydown',e=>{
  if(e.key==='Enter'){
    if($('authScreen')&&!$('authScreen').classList.contains('hidden')){
      if(!$('formLogin').classList.contains('hidden')) doLogin();
      else doRegister();
    }
  }
  if(e.key===' '&&e.target.tagName!=='INPUT'){ e.preventDefault(); togglePlayPause() }
});

// ────────────────────────────────────────────────
// CONFIG SUPABASE (igual)
// ────────────────────────────────────────────────
const SUPA_URL = 'https://jhlktvdylbiieeuwykgj.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpobGt0dmR5bGJpaWVldXd5a2dqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMzIwNjMsImV4cCI6MjA5NTkwODA2M30.jie5MZF36VXhsfEZggCCWJ3M5HQVShGmyss6f-nLa3s';
const db = supabase.createClient(SUPA_URL, SUPA_KEY);

// ────────────────────────────────────────────────
// STATE (igual)
// ────────────────────────────────────────────────
let currentUser  = null;
let allSongs     = [];
let myInter      = [];
let allInter     = [];
let nowPlayingId = null;
let activeGenre  = null;
let searchQuery  = '';

let audioObj = null;
let isPlaying = false;
let audioErrorCount = 0;
let isLoading = false;  // NUEVO: evita múltiples llamadas a playSong mientras se carga

// ────────────────────────────────────────────────
// UTILS (igual)
// ────────────────────────────────────────────────
const $ = id => document.getElementById(id);
function esc(s){ return (s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])) }
function txt(id,v){ const e=$(id); if(e) e.textContent=v }
function html(id,v){ const e=$(id); if(e) e.innerHTML=v }

function toast(msg, color=''){
  const t=$('toast');
  t.textContent=msg;
  t.style.borderColor = color || 'rgba(167,139,250,0.25)';
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2400);
}

// Genre emoji map (igual)
const GENRE_EMOJI = {
  'Pop':'🎤','Electrónica':'🎛️','Anime':'⛩️','Rock':'🎸',
  'Latino':'💃','Alternativo':'🌊','Trap':'🎧','Balada':'🎻',
  'default':'🎵'
};
function genreEmoji(g){ return GENRE_EMOJI[g]||GENRE_EMOJI.default }

// Gradientes (igual)
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
function genreGradient(g){ const c=GENRE_COLORS[g]||GENRE_COLORS.default; return `linear-gradient(135deg,${c[0]},${c[1]})` }

// Persistencia (igual)
function saveUserToLocalStorage(user){ localStorage.setItem('soundmind_user', JSON.stringify(user)); }
function clearUserLocalStorage(){ localStorage.removeItem('soundmind_user'); }
function getUserFromLocalStorage(){ const raw = localStorage.getItem('soundmind_user'); return raw ? JSON.parse(raw) : null; }

// ────────────────────────────────────────────────
// AUTH (igual)
// ────────────────────────────────────────────────
function switchTab(tab){
  $('tabLogin').classList.toggle('active',tab==='login');
  $('tabReg').classList.toggle('active',tab==='register');
  $('formLogin').classList.toggle('hidden',tab!=='login');
  $('formReg').classList.toggle('hidden',tab!=='register');
  txt('authMsg','');
}

async function doLogin(){
  const username = $('loginUser').value.trim();
  const password = $('loginPass').value.trim();
  if(!username||!password){ txt('authMsg','Completa todos los campos'); return }
  txt('authMsg','Verificando…');
  const {data,error} = await db.from('usuarios').select('*').eq('username',username).eq('password',password).maybeSingle();
  if(!data){ txt('authMsg', error ? 'Error de conexión' : 'Usuario o contraseña incorrectos'); return }
  currentUser=data;
  saveUserToLocalStorage(currentUser);
  await bootApp();
}

async function doRegister(){
  const nombre   = $('regName').value.trim();
  const username = $('regUser').value.trim();
  const password = $('regPass').value.trim();
  if(!nombre||!username||!password){ txt('authMsg','Completa todos los campos'); return }
  if(username.length<3){ txt('authMsg','El usuario debe tener al menos 3 caracteres'); return }
  if(password.length<6){ txt('authMsg','La contraseña debe tener al menos 6 caracteres'); return }
  txt('authMsg','Creando cuenta…');
  const {data:ex} = await db.from('usuarios').select('id').eq('username',username).maybeSingle();
  if(ex){ txt('authMsg','Ese usuario ya existe, elige otro'); return }
  const {data,error} = await db.from('usuarios').insert({username,password,nombre}).select().single();
  if(!data){ txt('authMsg','Error: '+(error?.message||'desconocido')); return }
  currentUser=data;
  saveUserToLocalStorage(currentUser);
  await bootApp();
}

async function doLogout(){
  clearUserLocalStorage();
  resetPlayer();
  currentUser=null; myInter=[]; allInter=[]; nowPlayingId=null;
  // Mostrar pantalla de login y ocultar app
  $('authScreen').style.display = 'flex';
  $('app').style.display = 'none';
  $('playerBar').classList.add('hidden');
  $('loginUser').value=''; $('loginPass').value=''; $('regName').value=''; $('regUser').value=''; $('regPass').value='';
  txt('authMsg','');
}

// ────────────────────────────────────────────────
// REPRODUCTOR: CORREGIDO (sin errores al cambiar de canción)
// ────────────────────────────────────────────────
function resetPlayer() {
  if(audioObj){
    audioObj.pause();
    audioObj.src = '';
    // Remover todos los event listeners (no podemos removerlos individualmente sin referencia, así que clonamos)
    const old = audioObj;
    audioObj = null;
    // Reemplazar el elemento por uno nuevo para eliminar todos los listeners de forma segura
    if(old.parentNode) old.parentNode.replaceChild(old.cloneNode(), old);
  }
  isPlaying = false;
  audioErrorCount = 0;
  nowPlayingId = null;
  isLoading = false;
  $('playPauseBtn').innerHTML = '▶️';
  $('waveAnim').style.display = 'none';
  $('loadingSpinner').style.display = 'none';
  $('progressFill').style.width = '0%';
  $('currentTime').innerText = '0:00';
  $('duration').innerText = '0:00';
  txt('plTitle', 'Sin reproducción');
  txt('plArtist', '');
}

function formatTime(sec){
  if(isNaN(sec)) return '0:00';
  const m = Math.floor(sec/60);
  const s = Math.floor(sec%60);
  return `${m}:${s<10?'0'+s:s}`;
}

function playSong(e, songId){
  if(e) e.stopPropagation();
  if(isLoading) {
    toast('Espera a que cargue la canción actual');
    return;
  }
  const song = allSongs.find(s=>s.id===songId);
  if(!song) return;
  if(!song.url_preview){
    toast('⚠️ No hay archivo de audio para esta canción');
    return;
  }

  // Limpiar reproductor anterior
  resetPlayer();
  isLoading = true;
  nowPlayingId = songId;

  // UI
  txt('plTitle', song.titulo);
  txt('plArtist', song.artista);
  const coverDiv = $('plCover');
  coverDiv.innerHTML = `<span style="font-size:28px">${genreEmoji(song.genero)}</span>`;
  coverDiv.style.background = genreGradient(song.genero);
  $('loadingSpinner').style.display = 'inline-block';
  $('waveAnim').style.display = 'none';
  $('playPauseBtn').innerHTML = '⏸️';

  // Crear nuevo audio
  const audio = new Audio(song.url_preview);
  audioObj = audio;
  audioErrorCount = 0;

  // Función para manejar cuando el audio está listo
  const onCanPlay = () => {
    $('loadingSpinner').style.display = 'none';
    $('waveAnim').style.display = 'flex';
    audio.play().catch(err => {
      console.warn('play() error:', err);
      toast('No se pudo reproducir el audio');
      resetPlayer();
    });
    isPlaying = true;
    isLoading = false;
    toast(`▶ Reproduciendo: ${song.titulo}`);
  };

  const onTimeUpdate = () => {
    if(audio.duration){
      const percent = (audio.currentTime / audio.duration) * 100;
      $('progressFill').style.width = percent + '%';
      $('currentTime').innerText = formatTime(audio.currentTime);
    }
  };

  const onLoadedMetadata = () => {
    $('duration').innerText = formatTime(audio.duration);
  };

  const onEnded = () => {
    const otherSongs = allSongs.filter(s => s.id !== nowPlayingId && s.url_preview);
    if(otherSongs.length){
      const randomIdx = Math.floor(Math.random() * otherSongs.length);
      playSong(null, otherSongs[randomIdx].id);
    } else {
      resetPlayer();
    }
  };

  const onError = (err) => {
    console.error('Audio error:', err);
    $('loadingSpinner').style.display = 'none';
    toast('Error al cargar el audio.');
    if(audioErrorCount < 2){
      audioErrorCount++;
      const otherSongs = allSongs.filter(s => s.id !== nowPlayingId && s.url_preview);
      if(otherSongs.length){
        const randomIdx = Math.floor(Math.random() * otherSongs.length);
        playSong(null, otherSongs[randomIdx].id);
      } else {
        resetPlayer();
      }
    } else {
      resetPlayer();
    }
  };

  audio.addEventListener('canplaythrough', onCanPlay);
  audio.addEventListener('timeupdate', onTimeUpdate);
  audio.addEventListener('loadedmetadata', onLoadedMetadata);
  audio.addEventListener('ended', onEnded);
  audio.addEventListener('error', onError);

  // Guardar referencias para poder eliminar después (opcional, resetPlayer las reemplazará)
  renderAll();
}

function togglePlayPause(){
  if(!audioObj) return;
  if(isPlaying){
    audioObj.pause();
    $('playPauseBtn').innerHTML = '▶️';
    $('waveAnim').style.display = 'none';
    isPlaying = false;
  } else {
    audioObj.play().catch(e=>toast('Error al reanudar'));
    $('playPauseBtn').innerHTML = '⏸️';
    $('waveAnim').style.display = 'flex';
    isPlaying = true;
  }
}

function nextTrack(){
  if(isLoading) {
    toast('Espera que termine de cargar');
    return;
  }
  if(!allSongs.length) return;
  let nextSong = null;
  if(nowPlayingId){
    const other = allSongs.filter(s => s.id !== nowPlayingId && s.url_preview);
    if(other.length) nextSong = other[Math.floor(Math.random() * other.length)];
  }
  if(!nextSong) nextSong = allSongs.find(s => s.url_preview);
  if(nextSong) playSong(null, nextSong.id);
}

// ────────────────────────────────────────────────
// BOOT (carga datos y renderiza)
// ────────────────────────────────────────────────
async function bootApp(){
  // Asegurar visibilidad sin parpadeo
  $('authScreen').style.display = 'none';
  $('app').style.display = 'flex';
  $('playerBar').classList.remove('hidden');

  const initials = (currentUser.nombre||currentUser.username).slice(0,2).toUpperCase();
  txt('userAvatar', initials);
  txt('userName', currentUser.nombre||currentUser.username);
  txt('heroName', currentUser.nombre||currentUser.username);

  const [songsRes, myRes, allRes] = await Promise.all([
    db.from('canciones').select('*').order('popularidad',{ascending:false}),
    db.from('interacciones').select('*').eq('usuario_id',currentUser.id),
    db.from('interacciones').select('*')
  ]);
  allSongs = songsRes.data || [];
  myInter  = myRes.data  || [];
  allInter = allRes.data || [];

  buildGenrePills();
  renderAll();
  showPage('home');
}

// ────────────────────────────────────────────────
// RENDER ALL (igual)
// ────────────────────────────────────────────────
function renderAll(){
  updateHeroStats();
  updateBadges();
  renderHomePopular();
  renderHomeRec();
  renderCatalog();
  renderSimilar();
  renderTree();
  renderRecursive();
  renderFavorites();
  renderLikes();
  renderAnalysis();
}

function updateHeroStats(){
  txt('hsSongs', allSongs.length);
  txt('hsLikes', myInter.filter(i=>i.es_like).length);
  txt('hsFavs',  myInter.filter(i=>i.es_favorito).length);
}

function updateBadges(){
  const likes = myInter.filter(i=>i.es_like).length;
  const favs  = myInter.filter(i=>i.es_favorito).length;
  const bl=$('badge-like'), bf=$('badge-fav');
  if(likes>0){ bl.textContent=likes; bl.classList.remove('hidden') } else bl.classList.add('hidden');
  if(favs>0) { bf.textContent=favs;  bf.classList.remove('hidden') } else bf.classList.add('hidden');
}

// SONG CARD (igual)
function songCard(s){
  const inter   = myInter.find(i=>i.cancion_id===s.id);
  const liked   = inter&&inter.es_like;
  const faved   = inter&&inter.es_favorito;
  const playing = nowPlayingId===s.id;
  const em      = genreEmoji(s.genero);
  const grad    = genreGradient(s.genero);

  return `<div class="song-card ${liked?'liked':''} ${faved?'faved':''} ${playing?'playing':''}" data-id="${s.id}">
    <div class="card-cover">
      <div class="card-cover-inner" style="background:${grad}">${em}</div>
      ${playing?`<div class="now-playing-badge">En reproducción</div>`:''}
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
        <button class="cta ${liked?'liked-btn':''}" onclick="toggleLike(event,${s.id})">${liked?'❤️':'🤍'}</button>
        <button class="cta ${faved?'faved-btn':''}" onclick="toggleFav(event,${s.id})">${faved?'⭐':'☆'}</button>
        <button class="cta play-btn" onclick="playSong(event,${s.id})">▶ Play</button>
      </div>
    </div>
  </div>`;
}

function renderCards(songs, containerId, emptyMsg='No hay canciones aquí aún.'){
  const el=$(containerId); if(!el) return;
  if(!songs||!songs.length){
    el.innerHTML=`<div class="empty-state"><div class="empty-icon">🎵</div><p>${emptyMsg}</p></div>`;
    return;
  }
  el.innerHTML=songs.map(songCard).join('');
}

// HOME (igual)
function renderHomePopular(){ renderCards(allSongs.slice(0,12),'homePopCards') }
function renderHomeRec(){
  const rec = aiCollaborative().slice(0,8);
  renderCards(rec,'homeRecCards','Da likes a canciones para recibir recomendaciones personalizadas.');
}

// CATALOG (igual)
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
  let songs=allSongs.filter(s=>
    (!activeGenre||s.genero===activeGenre)&&
    (!searchQuery||(s.titulo.toLowerCase().includes(searchQuery)||s.artista.toLowerCase().includes(searchQuery)))
  );
  txt('catalogCount',songs.length+' canciones');
  renderCards(songs,'catalogCards');
}

// AI 1: COLLABORATIVE FILTERING (igual)
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
    if(sim>0) sims.push({uid,sim,likedSet,comunes});
  }
  sims.sort((a,b)=>b.sim-a.sim);
  const candidates=new Set();
  for(const v of sims.slice(0,3)) for(const id of v.likedSet) if(!myLiked.has(id)) candidates.add(id);
  return allSongs.filter(s=>candidates.has(s.id));
}

function renderSimilar(){
  const myLiked=new Set(myInter.filter(i=>i.es_like||i.es_favorito).map(i=>i.cancion_id));
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
    const sim=comunes/Math.max(1,Math.min(myLiked.size,likedSet.size));
    if(sim>0) sims.push({uid,sim,comunes,total:likedSet.size});
  }
  sims.sort((a,b)=>b.sim-a.sim);

  const nr=$('neighborsRow');
  if(nr){
    if(sims.length>0){
      nr.innerHTML=sims.slice(0,3).map((v,i)=>`
        <div class="neighbor-card">
          <div class="neighbor-num">Vecino ${i+1}</div>
          <div class="neighbor-val">${(v.sim*100).toFixed(0)}%</div>
          <div class="neighbor-sub">similitud · ${v.comunes} canciones en común</div>
        </div>`).join('');
    } else {
      nr.innerHTML='<p style="color:var(--text2);font-size:13px">Aún no hay usuarios suficientes para comparar. Da likes para activar el algoritmo.</p>';
    }
  }
  const rec=aiCollaborative().slice(0,8);
  renderCards(rec,'simCards','Da likes a más canciones para que el algoritmo encuentre usuarios con gustos similares.');
}

// AI 2: DECISION TREE J48 (igual)
function buildModel(){
  const datos=[];
  for(const inter of allInter){
    const song=allSongs.find(s=>s.id===inter.cancion_id);
    if(!song) continue;
    datos.push({
      energia:song.energia,bailabilidad:song.bailabilidad,
      popularidad:song.popularidad,genero:song.genero,
      like:(inter.es_like||inter.es_favorito)?1:0
    });
  }
  if(datos.length<3) return null;
  const byGenre={};
  for(const d of datos){
    if(!byGenre[d.genero]) byGenre[d.genero]={likes:0,total:0};
    byGenre[d.genero].total++;
    if(d.like) byGenre[d.genero].likes++;
  }
  const avg=arr=>arr.length?arr.reduce((a,b)=>a+b,0)/arr.length:0;
  const likes=datos.filter(d=>d.like);
  const avgEn=avg(datos.map(d=>d.energia));
  const avgBai=avg(datos.map(d=>d.bailabilidad));
  const avgPop=avg(datos.map(d=>d.popularidad));
  const likeEn=avg(likes.map(d=>d.energia));
  const likeBai=avg(likes.map(d=>d.bailabilidad));
  const accuracy=datos.length>0?Math.round((Math.max(likes.length,datos.length-likes.length)/datos.length)*100):70;
  return{datos,byGenre,avgEn,avgBai,avgPop,likeEn,likeBai,accuracy};
}

function predictTree(song,model){
  if(!model) return false;
  const gd=model.byGenre[song.genero];
  const genreRate=gd?gd.likes/gd.total:0.5;
  let score=0;
  if(genreRate>0.55) score+=3; else if(genreRate>0.4) score+=1;
  if(song.energia>=model.avgEn-0.05) score+=1;
  if(song.bailabilidad>=model.avgBai-0.05) score+=1;
  if(song.popularidad>=model.avgPop) score+=1;
  return score>=4;
}

function renderTree(){
  const model=buildModel();
  if(!model){
    html('treeCards','<div class="empty-state"><div class="empty-icon">🌳</div><p>Necesitas más interacciones en el sistema para entrenar el árbol.<br>Registra más usuarios y da likes.</p></div>');
    return;
  }
  const myIds=new Set(myInter.map(i=>i.cancion_id));
  const rec=allSongs.filter(s=>!myIds.has(s.id)&&predictTree(s,model)).slice(0,8);
  renderCards(rec,'treeCards','El árbol no encontró nuevas canciones para recomendarte. Da likes a más canciones para mejorar el modelo.');
}

// AI 3: RECURSIVE PLAYLIST (igual)
function recursivePlaylist(seedId,depth,visited=new Set()){
  if(depth===0||!seedId) return [];
  const seed=allSongs.find(s=>s.id===seedId);
  if(!seed||visited.has(seedId)) return [];
  visited.add(seedId);
  const next=allSongs
    .filter(s=>!visited.has(s.id))
    .map(s=>({
      s,
      score:(s.genero===seed.genero?3:0)
        +(1-Math.abs(s.energia-seed.energia))*2
        +(1-Math.abs(s.bailabilidad-seed.bailabilidad))*2
        +(1-Math.abs(s.popularidad-seed.popularidad)/100)
    }))
    .sort((a,b)=>b.score-a.score)[0];
  if(!next) return [];
  return [next.s,...recursivePlaylist(next.s.id,depth-1,visited)];
}

function renderRecursive(){
  const myLiked=myInter.filter(i=>i.es_like||i.es_favorito).sort((a,b)=>new Date(b.fecha)-new Date(a.fecha));
  const seedId=myLiked.length>0?myLiked[0].cancion_id:(allSongs[0]?.id);
  const playlist=recursivePlaylist(seedId,8);
  renderCards(playlist,'recCards','Da likes a canciones para generar tu playlist recursiva personalizada.');
}

// FAVORITES & LIKES (igual)
function renderFavorites(){
  const ids=new Set(myInter.filter(i=>i.es_favorito).map(i=>i.cancion_id));
  renderCards(allSongs.filter(s=>ids.has(s.id)),'favCards','Aún no tienes favoritos. Haz clic en ☆ en cualquier canción.');
}
function renderLikes(){
  const ids=new Set(myInter.filter(i=>i.es_like).map(i=>i.cancion_id));
  renderCards(allSongs.filter(s=>ids.has(s.id)),'likeCards','Aún no tienes likes. Haz clic en 🤍 en cualquier canción.');
}

// INTERACTIONS (igual)
async function toggleLike(e,songId){
  e.stopPropagation();
  const existing=myInter.find(i=>i.cancion_id===songId);
  if(existing){
    const nv=!existing.es_like;
    await db.from('interacciones').update({es_like:nv}).eq('id',existing.id);
    existing.es_like=nv;
    toast(nv?'❤️ Like añadido':'Like eliminado');
  } else {
    const{data}=await db.from('interacciones').insert({usuario_id:currentUser.id,cancion_id:songId,es_like:true,es_favorito:false}).select().single();
    if(data){ myInter.push(data); toast('❤️ Like añadido') }
  }
  await refreshAllInter();
  renderAll();
}

async function toggleFav(e,songId){
  e.stopPropagation();
  const existing=myInter.find(i=>i.cancion_id===songId);
  if(existing){
    const nv=!existing.es_favorito;
    await db.from('interacciones').update({es_favorito:nv}).eq('id',existing.id);
    existing.es_favorito=nv;
    toast(nv?'⭐ Favorito añadido':'Favorito eliminado');
  } else {
    const{data}=await db.from('interacciones').insert({usuario_id:currentUser.id,cancion_id:songId,es_like:false,es_favorito:true}).select().single();
    if(data){ myInter.push(data); toast('⭐ Favorito añadido') }
  }
  renderAll();
}

async function refreshAllInter(){
  const{data}=await db.from('interacciones').select('*');
  allInter=data||[];
}

// ANALYSIS (igual)
function renderAnalysis(){
  const model=buildModel();
  const userIds=new Set(allInter.map(i=>i.usuario_id));
  const totalLikes=allInter.filter(i=>i.es_like).length;
  txt('mUsers',userIds.size);
  txt('mSongs',allSongs.length);
  txt('mInter',allInter.length);
  txt('mLikes',totalLikes);
  txt('mAcc',model?model.accuracy+'%':'—');
  txt('mAvg',userIds.size>0?Math.round(totalLikes/userIds.size):'—');
  renderGenreBar();
  if(model) renderTreeViz(model);
  renderCV(model);
}

function renderGenreBar(){
  const myLiked=myInter.filter(i=>i.es_like||i.es_favorito).map(i=>i.cancion_id);
  const counts={};
  for(const id of myLiked){
    const s=allSongs.find(s=>s.id===id);
    if(s) counts[s.genero]=(counts[s.genero]||0)+1;
  }
  const sorted=Object.entries(counts).sort((a,b)=>b[1]-a[1]);
  const el=$('genreBar'); if(!el) return;
  if(!sorted.length){ el.innerHTML='<div style="color:var(--text2);font-size:13px;padding:20px">Da likes para ver tus géneros favoritos.</div>'; return }
  const maxV=sorted[0][1];
  const colors=['#a78bfa','#818cf8','#34d399','#fbbf24','#f87171','#38bdf8','#fb923c','#a3e635'];
  el.innerHTML=sorted.slice(0,8).map(([g,c],i)=>`
    <div class="bar-col">
      <div class="bar-fill" style="height:${Math.round((c/maxV)*110)+12}px;background:${colors[i%colors.length]}"></div>
      <div class="bar-lbl">${esc(g)}</div>
      <div class="bar-num">${c}</div>
    </div>`).join('');
}

function renderTreeViz(model){
  const L=[];
  L.push('ÁRBOL DE DECISIÓN J48 — SoundMind AI Music Recommender');
  L.push('═══════════════════════════════════════════════════════════');
  L.push(`Instancias de entrenamiento : ${model.datos.length} interacciones`);
  L.push(`Likes registrados           : ${model.datos.filter(d=>d.like).length}`);
  L.push(`Precisión del clasificador  : ${model.accuracy}%`);
  L.push('');
  L.push('NODO RAÍZ: Género de la canción');
  L.push('│');
  const sorted=Object.entries(model.byGenre).sort((a,b)=>(b[1].likes/b[1].total)-(a[1].likes/a[1].total));
  sorted.forEach(([g,data],i)=>{
    const rate=Math.round((data.likes/data.total)*100);
    const sym=rate>60?'→ RECOMENDAR ✓':rate>40?'→ EVALUAR ∿':'→ OMITIR ✗';
    const pfx=i===sorted.length-1?'└─':'├─';
    L.push(`${pfx} ${g.padEnd(16)} likes:${rate}%  ${sym}`);
    if(rate>40){
      const pad=i===sorted.length-1?' ':'│';
      L.push(`${pad}   ├─ Energía >= ${model.avgEn.toFixed(2)}        → +1 punto`);
      L.push(`${pad}   ├─ Bailabilidad >= ${model.avgBai.toFixed(2)}   → +1 punto`);
      L.push(`${pad}   └─ Popularidad >= ${Math.round(model.avgPop)}       → +1 punto`);
    }
  });
  L.push('');
  L.push(`REGLA FINAL : Score >= 4 → Predecir LIKE (recomendar)`);
  L.push(`PARÁMETROS  : energía=${model.avgEn.toFixed(3)} | bailabilidad=${model.avgBai.toFixed(3)} | popularidad=${Math.round(model.avgPop)}`);
  html('treeViz',L.join('\n'));
}

function renderCV(model){
  if(!model||model.datos.length<5){
    html('cvBody','<tr><td colspan="5" style="color:var(--text2);padding:16px">Necesitas al menos 5 interacciones para calcular validación cruzada.   </td></tr>');
    return;
  }
  const k=5,datos=model.datos;
  const foldSize=Math.floor(datos.length/k);
  let totalAcc=0; const rows=[];
  for(let i=0;i<k;i++){
    const test=datos.slice(i*foldSize,(i+1)*foldSize);
    const train=[...datos.slice(0,i*foldSize),...datos.slice((i+1)*foldSize)];
    const tl=train.filter(d=>d.like).length;
    const acc=train.length>0?Math.round((Math.max(tl,train.length-tl)/train.length)*100):70;
    const det=test.filter(d=>d.like).length;
    totalAcc+=acc;
    const cls=acc>=75?'good':acc>=60?'mid':'';
    rows.push(`<tr><td>Fold ${i+1}</td><td>${train.length}</td><td>${test.length}</td><td class="${cls}">${acc}%</td><td>${det}/${test.length}</td></tr>`);
  }
  const avg=Math.round(totalAcc/k);
  rows.push(`<tr><td colspan="3"><strong>Precisión promedio</strong></td><td class="good">${avg}%</td><td>—</td></tr>`);
  html('cvBody',rows.join(''));
}

// NAVIGATION (igual)
function showPage(name){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const pg=$('page-'+name); const nv=$('nav-'+name);
  if(pg) pg.classList.add('active');
  if(nv) nv.classList.add('active');
  if(window.innerWidth<=900) $('sidebar').classList.remove('open');
}

function toggleSidebar(){ $('sidebar').classList.toggle('open') }

// ────────────────────────────────────────────────
// INIT: SIN PARPADEO (corregido)
// ────────────────────────────────────────────────
// El estilo CSS ya tiene #app { display: none; } y #authScreen { display: flex; }
// Ahora en DOMContentLoaded decidimos si mostrar app o auth
document.addEventListener('DOMContentLoaded', async () => {
  // Precargar canciones para agilizar
  const {data} = await db.from('canciones').select('*').order('popularidad',{ascending:false});
  allSongs = data || [];

  const savedUser = getUserFromLocalStorage();
  if(savedUser){
    currentUser = savedUser;
    await bootApp();
  } else {
    // Asegurar que se vea authScreen y app oculta
    $('authScreen').style.display = 'flex';
    $('app').style.display = 'none';
  }
});

// Asignar eventos del reproductor después de que el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
  const playPause = $('playPauseBtn');
  const nextBtn = $('nextTrackBtn');
  const progBar = $('progressBar');
  if(playPause) playPause.addEventListener('click', togglePlayPause);
  if(nextBtn) nextBtn.addEventListener('click', nextTrack);
  if(progBar) progBar.addEventListener('click', (e) => {
    if(!audioObj) return;
    const rect = progBar.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = x / rect.width;
    audioObj.currentTime = percent * audioObj.duration;
  });
});

// Enter key en auth
document.addEventListener('keydown', e => {
  if(e.key === 'Enter'){
    if(!currentUser && $('formLogin') && !$('formLogin').classList.contains('hidden')) doLogin();
    else if(!currentUser && $('formReg') && !$('formReg').classList.contains('hidden')) doRegister();
  }
});

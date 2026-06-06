const API_BASE = 'https://streamflix-music.onrender.com';
const SUPABASE_URL = 'https://jhlktvdylbiieeuwykgj.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpobGt0dmR5bGJpaWVldXd5a2dqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMzIwNjMsImV4cCI6MjA5NTkwODA2M30.jie5MZF36VXhsfEZggCCWJ3M5HQVShGmyss6f-nLa3s';

let allSongs = [], nowPlayingId = null, searchQuery = '', activeGenre = null;
let audioCtx = null, analyser = null, sourceNode = null, sourceLinked = false, visRaf = null;

const $ = id => document.getElementById(id);
function esc(s){ return (s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])) }
function txt(id,v){ const e=$(id); if(e) e.textContent=v }

function toast(msg){
  const t=$('toast');
  if(!t) return;
  t.textContent=msg;
  t.classList.add('show');
  clearTimeout(t._to);
  t._to=setTimeout(()=>t.classList.remove('show'),2600);
}

const GENRE_EMOJI = {
  'Pop':'🎤','Electrónica':'🎛️','Anime':'⛩️','Rock':'🎸',
  'Latino':'💃','Alternativo':'🌊','Trap':'🎧','Balada':'🎻','J-Pop':'🎌','Phonk':'💜','default':'🎵'
};
const GENRE_COLORS = {
  'Pop':['#ec4899','#f472b6'],'Electrónica':['#6366f1','#a78bfa'],'Anime':['#f59e0b','#fbbf24'],
  'Rock':['#ef4444','#f87171'],'Latino':['#10b981','#34d399'],'Alternativo':['#0ea5e9','#38bdf8'],
  'Trap':['#8b5cf6','#a78bfa'],'Balada':['#f97316','#fb923c'],'J-Pop':['#ec4899','#f472b6'],
  'Phonk':['#8b5cf6','#a78bfa'],'default':['#6b7280','#9ca3af']
};
function genreEmoji(g){ return GENRE_EMOJI[g]||GENRE_EMOJI.default }
function genreGradient(g){ const c=GENRE_COLORS[g]||GENRE_COLORS.default; return `linear-gradient(135deg,${c[0]},${c[1]})` }

function requireLogin(feature='esta función'){
  // Mostrar modal de login
  const existing = document.getElementById('loginPromptOverlay');
  if(existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'loginPromptOverlay';
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:9500;display:flex;align-items:center;justify-content:center;
    background:rgba(5,5,12,.88);backdrop-filter:blur(12px);
  `;
  overlay.innerHTML = `
    <div style="background:#111120;border:1px solid rgba(167,139,250,.25);border-radius:24px;
                padding:36px 32px;width:90%;max-width:360px;text-align:center;
                box-shadow:0 24px 80px rgba(0,0,0,.8)">
      <div style="font-size:48px;margin-bottom:16px">🔒</div>
      <h3 style="font-family:'Syne',sans-serif;font-size:20px;font-weight:800;margin-bottom:8px">
        Inicia sesión
      </h3>
      <p style="color:#9090b0;font-size:14px;margin-bottom:24px;line-height:1.6">
        Necesitas una cuenta para acceder a <strong style="color:#c4b5fd">${feature}</strong>.
      </p>
      <div style="display:flex;gap:10px;justify-content:center">
        <button onclick="document.getElementById('loginPromptOverlay').remove()"
          style="padding:11px 20px;border-radius:50px;border:1px solid rgba(255,255,255,.1);
                 background:transparent;color:#9090b0;font-size:13px;font-weight:600;cursor:pointer">
          Ahora no
        </button>
        <button onclick="window.location.href='login.html'"
          style="padding:11px 24px;border-radius:50px;background:#7c3aed;
                 color:#fff;font-size:13px;font-weight:700;cursor:pointer;border:none;
                 box-shadow:0 4px 14px rgba(124,58,237,.5)">
          Iniciar sesión →
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if(e.target===overlay) overlay.remove(); });
}

async function loadSongs(){
  try {
    const res = await fetch(`${API_BASE}/api/songs`);
    const data = await res.json();
    allSongs = data.data || [];
  } catch(e) {
    // Fallback: cargar directo desde Supabase
    if(window.supabase){
      const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      const { data } = await sb.from('canciones').select('*').order('id',{ascending:true});
      allSongs = data || [];
    }
  }
  txt('hsSongs', allSongs.length);
  buildGenrePills();
  renderCatalog();
  renderMoodCards();
  renderTopRanking();
}

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
  const cb=$('clearSearchBtn');
  if(cb) cb.classList.toggle('hidden',!searchQuery);
  renderCatalog();
}
function clearSearch(){
  const input=$('searchInput');
  if(input){ input.value=''; input.focus(); }
  searchQuery='';
  const cb=$('clearSearchBtn');
  if(cb) cb.classList.add('hidden');
  renderCatalog();
}

function renderCatalog(){
  let songs=allSongs;
  if(activeGenre) songs=songs.filter(s=>s.genero===activeGenre);
  if(searchQuery) songs=songs.filter(s=>
    s.titulo.toLowerCase().includes(searchQuery)||s.artista.toLowerCase().includes(searchQuery)
  );
  txt('catalogCount', songs.length+' canciones');
  const el=$('catalogCards'); if(!el) return;
  if(!songs.length){
    el.innerHTML=`<div class="empty-state"><div class="empty-icon">🎵</div><p>No se encontraron canciones.</p></div>`;
    return;
  }
  el.className='album-track-list';
  el.innerHTML=songs.map((s,i)=>{
    const playing=nowPlayingId===s.id;
    const thumbHTML=s.url_imagen
      ?`<img class="album-track-thumb" src="${esc(s.url_imagen)}" alt="${esc(s.titulo)}" onerror="this.style.display='none'">`
      :`<div class="album-track-thumb-placeholder" style="background:${genreGradient(s.genero)}">${genreEmoji(s.genero)}</div>`;
    return `
      <div class="album-track${playing?' playing':''}" data-id="${s.id}" onclick="playSong(null,${s.id})">
        <div class="album-track-num">${playing?'▶':i+1}</div>
        ${thumbHTML}
        <div class="album-track-info">
          <div class="album-track-title">${esc(s.titulo)}</div>
          <div class="album-track-artist">${esc(s.artista)}</div>
        </div>
        <span class="album-track-genre">${esc(s.genero)}</span>
        <div class="album-track-actions" onclick="event.stopPropagation()">
          <button class="album-track-btn" onclick="requireLogin('likes y favoritos')" title="Like">🤍</button>
          <button class="album-track-btn" onclick="requireLogin('favoritos')" title="Favorito">☆</button>
          <button class="album-track-btn" onclick="requireLogin('playlists')" title="Playlist">➕</button>
          <button class="album-track-btn" onclick="playSong(null,${s.id});event.stopPropagation()" title="Play">▶</button>
        </div>
      </div>`;
  }).join('');
}

/* ── Moods preview ── */
const MOODS=[
  {id:'tristes',nombre:'Canciones tristes',emoji:'😢',color:'linear-gradient(135deg,#1e3a5f,#3730a3)',cover:'img/sad_album.jpg'},
  {id:'estudiar',nombre:'Para estudiar',emoji:'📚',color:'linear-gradient(135deg,#0c4a6e,#1e40af)',cover:'img/para_estudiar.jpg'},
  {id:'ejercitar',nombre:'Para ejercitarse',emoji:'💪',color:'linear-gradient(135deg,#7f1d1d,#991b1b)',cover:'img/musica_para_entrenar.png'},
  {id:'anime',nombre:'Anime OST',emoji:'⛩️',color:'linear-gradient(135deg,#4c1d95,#6d28d9)',cover:'img/anime_ost.jpg'},
  {id:'latino',nombre:'Latino Hits',emoji:'🎺',color:'linear-gradient(135deg,#064e3b,#065f46)',cover:'img/latino_hits.png'}
];
function renderMoodCards(){
  const row=$('moodCardsRow'); if(!row) return;
  row.innerHTML=MOODS.map(m=>`
    <div onclick="requireLogin('estados de ánimo')"
      style="min-width:140px;height:100px;border-radius:12px;cursor:pointer;flex-shrink:0;
             position:relative;overflow:hidden;transition:.18s;
             background-image:url(${m.cover}),${m.color};background-size:cover;background-position:center"
      onmouseover="this.style.transform='scale(1.04)'"
      onmouseout="this.style.transform=''">
      <div style="position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.7),transparent)"></div>
      <div style="position:absolute;bottom:8px;left:10px;z-index:1">
        <div style="font-size:16px">${m.emoji}</div>
        <div style="font-weight:700;font-size:13px;color:#fff;line-height:1.2">${m.nombre}</div>
        <div style="font-size:10px;color:rgba(255,255,255,.65)">🔒 Inicia sesión</div>
      </div>
    </div>`).join('');
}

/* ── Top ranking preview ── */
async function renderTopRanking(){
  const el=$('rankingPreview'); if(!el) return;
  try {
    const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
    const {data}=await sb.from('interacciones')
      .select('cancion_id,es_like,es_favorito')
      .or('es_like.eq.true,es_favorito.eq.true');
    const scores={};
    (data||[]).forEach(i=>{
      if(!scores[i.cancion_id]) scores[i.cancion_id]=0;
      if(i.es_like) scores[i.cancion_id]+=1;
      if(i.es_favorito) scores[i.cancion_id]+=0.5;
    });
    const top=Object.entries(scores)
      .sort((a,b)=>b[1]-a[1]).slice(0,6)
      .map(([cid,score])=>({cancion:allSongs.find(s=>s.id===parseInt(cid)),score}))
      .filter(r=>r.cancion);
    if(!top.length){
      el.innerHTML=`<div style="color:#9090b0;padding:20px;text-align:center">Aún no hay suficientes interacciones.</div>`;
      return;
    }
    el.innerHTML=top.map(({cancion:c,score})=>{
      const img=c.url_imagen
        ?`<img src="${c.url_imagen}" style="width:72px;height:72px;border-radius:8px;object-fit:cover;margin-bottom:6px">`
        :`<div style="width:72px;height:72px;border-radius:8px;background:${genreGradient(c.genero)};display:flex;align-items:center;justify-content:center;font-size:24px;margin-bottom:6px">${genreEmoji(c.genero)}</div>`;
      return `<div onclick="playSong(null,${c.id})"
        style="min-width:110px;background:rgba(11,11,22,.8);border:1px solid rgba(255,255,255,.07);
               border-radius:12px;padding:10px;text-align:center;cursor:pointer;flex-shrink:0;transition:.18s"
        onmouseover="this.style.borderColor='#a78bfa';this.style.transform='translateY(-3px)'"
        onmouseout="this.style.borderColor='rgba(255,255,255,.07)';this.style.transform=''">
        ${img}
        <div style="font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.titulo)}</div>
        <div style="font-size:9px;color:#9090b0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.artista)}</div>
        <div style="color:#f59e0b;font-size:9px;margin-top:3px">★ ${score.toFixed(1)}</div>
      </div>`;
    }).join('');
  } catch(e){ el.innerHTML=''; }
}

/* ── Player ── */
function playSong(e,songId){
  if(e&&e.stopPropagation) e.stopPropagation();
  const song=allSongs.find(s=>s.id===songId);
  if(!song) return;
  nowPlayingId=songId;
  txt('plTitle',song.titulo); txt('plArtist',song.artista);
  updateDiscCover($('plDiscCover'),song);
  if(!$('expandedPlayer').classList.contains('hidden')){
    updateDiscCover($('expDiscCover'),song);
    $('expDisc').classList.remove('spinning');
    $('expPlayPauseBtn').textContent='▶';
    txt('expTitle',song.titulo); txt('expArtist',song.artista);
  }
  const audio=$('audioEl');
  if(song.url_preview){
    audio.src=song.url_preview;
    audio.crossOrigin='anonymous';
    audio.load();
    if(audioCtx&&audioCtx.state==='suspended') audioCtx.resume().catch(()=>{});
    audio.play().then(()=>{
      $('plDisc').classList.add('spinning');
      updatePlayPauseBtn(true);
      if(sourceLinked) startVisRaf(); else startIdleVisualizer();
      ensureAudioContext(audio);
      toast('▶ '+song.titulo);
    }).catch(()=>toast('⚠️ No se pudo reproducir'));
  } else {
    audio.pause(); audio.removeAttribute('src');
    $('plDisc').classList.remove('spinning');
    updatePlayPauseBtn(false);
    toast('⚠️ Sin archivo de audio');
  }
  refreshCardHighlight();
}
function updateDiscCover(el,song){
  el.innerHTML=''; el.style.background=genreGradient(song.genero);
  if(song.url_imagen){
    const img=document.createElement('img');
    img.src=song.url_imagen; img.alt=song.titulo;
    img.style.cssText='width:100%;height:100%;object-fit:cover;border-radius:50%';
    el.appendChild(img);
  } else { el.textContent=genreEmoji(song.genero); }
}
function playPrevSong(){
  if(!nowPlayingId||!allSongs.length) return;
  const idx=allSongs.findIndex(s=>s.id===nowPlayingId);
  playSong(null,allSongs[idx>0?idx-1:allSongs.length-1].id);
}
function playNextSong(){
  if(!nowPlayingId||!allSongs.length) return;
  const idx=allSongs.findIndex(s=>s.id===nowPlayingId);
  playSong(null,allSongs[idx<allSongs.length-1?idx+1:0].id);
}
function skipBackward(){ const a=$('audioEl'); if(a&&a.src) a.currentTime=Math.max(0,a.currentTime-15); }
function skipForward(){ const a=$('audioEl'); if(a&&a.src) a.currentTime=Math.min(a.duration||0,a.currentTime+15); }
function ensureAudioContext(audioEl){
  if(sourceLinked) return;
  try{
    audioCtx=new(window.AudioContext||window.webkitAudioContext)();
    analyser=audioCtx.createAnalyser(); analyser.fftSize=64;
    sourceNode=audioCtx.createMediaElementSource(audioEl);
    sourceNode.connect(analyser); analyser.connect(audioCtx.destination);
    sourceLinked=true; startVisRaf();
  }catch(e){ startIdleVisualizer(); }
}
function refreshCardHighlight(){
  document.querySelectorAll('.album-track').forEach(t=>{
    const id=parseInt(t.dataset.id);
    t.classList.toggle('playing',id===nowPlayingId);
    const n=t.querySelector('.album-track-num');
    if(n) n.textContent=(id===nowPlayingId)?'▶':(Array.from(document.querySelectorAll('.album-track')).indexOf(t)+1);
  });
}
function togglePlayPause(){
  const audio=$('audioEl');
  if(!audio.src||audio.src===window.location.href) return;
  if(audio.paused){
    if(audioCtx&&audioCtx.state==='suspended') audioCtx.resume();
    audio.play().then(()=>{
      $('plDisc').classList.add('spinning'); updatePlayPauseBtn(true);
      if(sourceLinked) startVisRaf(); else startIdleVisualizer();
      $('expPlayPauseBtn').textContent='⏸'; $('expDisc')?.classList.add('spinning');
    });
  } else {
    audio.pause(); $('plDisc').classList.remove('spinning'); updatePlayPauseBtn(false);
    $('expPlayPauseBtn').textContent='▶'; $('expDisc')?.classList.remove('spinning');
    startIdleVisualizer();
  }
}
function updatePlayPauseBtn(p){
  const b=$('playPauseBtn'); if(b) b.textContent=p?'⏸':'▶';
  const e=$('expPlayPauseBtn'); if(e) e.textContent=p?'⏸':'▶';
}
function startVisRaf(){
  stopVisRaf(); if(!analyser) return;
  const bars=document.querySelectorAll('.vis-bar'); if(!bars.length) return;
  const buf=analyser.frequencyBinCount, arr=new Uint8Array(buf);
  function draw(){ analyser.getByteFrequencyData(arr);
    bars.forEach((b,i)=>{ const h=Math.max(3,(arr[Math.floor(i*(buf/bars.length))]/255)*26); b.style.height=h+'px'; b.classList.remove('idle'); });
    visRaf=requestAnimationFrame(draw); }
  draw();
}
function stopVisRaf(){ if(visRaf){ cancelAnimationFrame(visRaf); visRaf=null; } }
function startIdleVisualizer(){
  stopVisRaf();
  document.querySelectorAll('.vis-bar').forEach((b,i)=>{ b.style.setProperty('--d',(i*0.06)+'s'); b.classList.add('idle'); b.style.height=''; });
}
function updateProgress(){
  const a=$('audioEl'); if(!a.duration) return;
  const p=(a.currentTime/a.duration)*100;
  const f=$('progressFill'); if(f) f.style.width=p+'%';
  txt('currentTime',fmtTime(a.currentTime)); txt('totalTime',fmtTime(a.duration));
  const ef=$('expProgressFill'); if(ef) ef.style.width=p+'%';
  txt('expCurrentTime',fmtTime(a.currentTime)); txt('expTotalTime',fmtTime(a.duration));
}
function seekProgress(e){ const a=$('audioEl'); if(!a.duration) return; const r=$('progressBar').getBoundingClientRect(); a.currentTime=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width))*a.duration; }
function seekProgressExpanded(e){ const a=$('audioEl'); if(!a.duration) return; const r=$('expProgressBar').getBoundingClientRect(); a.currentTime=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width))*a.duration; }
function fmtTime(s){ if(isNaN(s)||!isFinite(s)) return '0:00'; return Math.floor(s/60)+':'+(Math.floor(s%60)<10?'0':'')+Math.floor(s%60); }
function setVolume(val){
  const a=$('audioEl'); if(a) a.volume=parseFloat(val);
  const p=Math.round(val*100);
  txt('volPercent',p+'%'); txt('expVolPercent',p+'%');
  $('volumeRange').value=val; $('expVolumeRange').value=val;
  const i=$('volIcon'); if(i) i.textContent=val==0?'🔇':val<0.5?'🔉':'🔊';
}
function onAudioEnded(){ $('plDisc').classList.remove('spinning'); updatePlayPauseBtn(false); playNextSong(); }
function openExpandedPlayer(){
  if(!nowPlayingId) return;
  const song=allSongs.find(s=>s.id===nowPlayingId); if(!song) return;
  txt('expTitle',song.titulo); txt('expArtist',song.artista);
  updateDiscCover($('expDiscCover'),song);
  const a=$('audioEl');
  if(a&&!a.paused){ $('expDisc').classList.add('spinning'); $('expPlayPauseBtn').textContent='⏸'; }
  else { $('expDisc').classList.remove('spinning'); $('expPlayPauseBtn').textContent='▶'; }
  $('expVolumeRange').value=a?a.volume:0.8;
  txt('expVolPercent',Math.round((a?.volume||0.8)*100)+'%');
  $('expandedPlayer').classList.remove('hidden');
}
function closeExpandedPlayer(){ $('expandedPlayer').classList.add('hidden'); }

/* ── Chat solo lectura ── */
function initChatReadOnly(){
  fetch(`${API_BASE}/api/messages`).then(r=>r.json()).then(data=>{
    const c=$('chatMessages'); if(!c) return;
    c.innerHTML='';
    (data.messages||[]).forEach(m=>addMsgUI(m));
    c.scrollTop=c.scrollHeight;
  }).catch(()=>{});
  if(!window.supabase) return;
  const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
  sb.channel('explore-chat').on('postgres_changes',{event:'INSERT',schema:'public',table:'mensajes'},p=>{
    addMsgUI(p.new);
    const c=$('chatMessages'); if(c) c.scrollTop=c.scrollHeight;
  }).subscribe();
}
function addMsgUI(msg){
  const c=$('chatMessages'); if(!c) return;
  const d=document.createElement('div');
  d.className='msg-bubble';
  d.innerHTML=`<div class="msg-user">${esc(msg.username)}</div>${esc(msg.mensaje)}`;
  c.appendChild(d);
}
function toggleChat(){ $('chatPanel')?.classList.toggle('hidden'); }

window.addEventListener('load',async()=>{
  await loadSongs();
  const vizEl=$('audioVisualizer');
  if(vizEl) vizEl.innerHTML=Array.from({length:14},(_,i)=>`<div class="vis-bar idle" style="--d:${i*0.06}s"></div>`).join('');
  const audio=$('audioEl');
  if(audio){
    audio.addEventListener('timeupdate',updateProgress);
    audio.addEventListener('ended',onAudioEnded);
    audio.addEventListener('play',()=>{ if(audioCtx&&audioCtx.state==='suspended') audioCtx.resume(); $('plDisc')?.classList.add('spinning'); updatePlayPauseBtn(true); $('expDisc')?.classList.add('spinning'); $('expPlayPauseBtn').textContent='⏸'; if(sourceLinked) startVisRaf(); else startIdleVisualizer(); });
    audio.addEventListener('pause',()=>{ $('plDisc')?.classList.remove('spinning'); updatePlayPauseBtn(false); $('expDisc')?.classList.remove('spinning'); $('expPlayPauseBtn').textContent='▶'; startIdleVisualizer(); });
  }
  const vr=$('volumeRange'); if(vr){ vr.value=0.8; setVolume(0.8); }
  $('playerBar').classList.remove('hidden');
  initChatReadOnly();
});

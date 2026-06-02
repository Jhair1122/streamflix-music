// ========================= CONFIGURACIÓN SUPABASE =========================
const SUPABASE_URL = "https://jhlktvdylbiieeuwykgj.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpobGt0dmR5bGJpaWVldXd5a2dqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMzIwNjMsImV4cCI6MjA5NTkwODA2M30.jie5MZF36VXhsfEZggCCWJ3M5HQVShGmyss6f-nLa3s";
const supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ========================= ESTADO GLOBAL =========================
let currentUser = null;
let allSongs = [];
let currentSong = null;
let currentPlaylist = [];
let currentIndex = 0;
let audioPlayer = new Audio();
let shuffle = false;
let repeat = false;

// Interacciones locales
let userLikes = [];     // IDs de canciones que le gustan
let userPlaylists = []; // { nombre, canciones: [] }

// Elementos DOM
const $ = id => document.getElementById(id);

// ========================= UTILERÍAS =========================
function toast(msg, isError = false) {
    let t = $("toastMsg");
    if (!t) {
        t = document.createElement("div");
        t.id = "toastMsg";
        t.style.cssText = "position:fixed; bottom:110px; left:50%; transform:translateX(-50%); background:#1a1a2e; border:1px solid #6366f1; color:white; padding:10px 20px; border-radius:30px; z-index:9999; font-size:13px;";
        document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.backgroundColor = isError ? "#dc2626" : "#1a1a2e";
    t.style.opacity = "1";
    setTimeout(() => t.style.opacity = "0", 2500);
}

function formatTime(sec) {
    if (isNaN(sec)) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? "0" + s : s}`;
}

// ========================= PERSISTENCIA DE SESIÓN =========================
function saveSession() {
    if (currentUser) localStorage.setItem("soundmind_user", JSON.stringify(currentUser));
}
function loadSession() {
    const raw = localStorage.getItem("soundmind_user");
    if (raw) {
        try {
            const user = JSON.parse(raw);
            currentUser = user;
            userLikes = user.likes || [];
            userPlaylists = user.playlists || [];
            return true;
        } catch(e) {}
    }
    return false;
}
function clearSession() {
    localStorage.removeItem("soundmind_user");
    currentUser = null;
    userLikes = [];
    userPlaylists = [];
}

// ========================= AUTENTICACIÓN =========================
async function login(username, password) {
    const { data, error } = await supabase
        .from("usuarios")
        .select("*")
        .eq("username", username)
        .eq("password", password)
        .maybeSingle();
    if (!data) return false;
    currentUser = data;
    userLikes = currentUser.likes || [];
    userPlaylists = currentUser.playlists || [];
    saveSession();
    return true;
}
async function register(username, password, nombre, generoFav) {
    const { data: existing } = await supabase
        .from("usuarios")
        .select("id")
        .eq("username", username)
        .maybeSingle();
    if (existing) return false;
    const newUser = {
        username,
        password,
        nombre,
        generoFav,
        likes: [],
        playlists: [],
        scores: { [generoFav]: 5 }
    };
    const { data, error } = await supabase.from("usuarios").insert(newUser).select().single();
    if (!data) return false;
    currentUser = data;
    userLikes = [];
    userPlaylists = [];
    saveSession();
    return true;
}

// ========================= CARGAR CATÁLOGO =========================
async function loadCatalog() {
    const { data } = await supabase.from("canciones").select("*").order("id");
    allSongs = data || [];
    return allSongs;
}

// ========================= REPRODUCTOR (estable, sin errores) =========================
function playSong(song, index) {
    if (!song) return;
    currentSong = song;
    currentIndex = index;
    $("playerTitle").innerText = song.titulo;
    $("playerArtist").innerText = song.artista;
    $("nowTitle").innerText = song.titulo;
    $("nowArtist").innerText = song.artista;
    $("nowComposer").innerText = `${song.artista} · ${song.genero}`;
    const coverUrl = song.url_imagen || `https://ui-avatars.com/api/?background=6366f1&color=fff&name=${encodeURIComponent(song.artista)}`;
    $("nowCoverImg").src = coverUrl;
    $("discArt").innerHTML = `<img src="${coverUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;

    if (audioPlayer.src !== song.url_audio) {
        audioPlayer.src = song.url_audio;
        audioPlayer.load();
    }
    audioPlayer.play().catch(e => toast("No se pudo reproducir: " + e.message, true));
    $("playBtn").innerHTML = "⏸️";
    document.querySelectorAll(".track-row").forEach(row => row.classList.remove("playing"));
    const activeRow = document.querySelector(`.track-row[data-id='${song.id}']`);
    if (activeRow) activeRow.classList.add("playing");
    $("playerDisc").classList.add("spinning");

    // Registrar escucha para IA
    registrarInteraccion(song, "play");
}
function nextSong() {
    if (!allSongs.length) return;
    let nextIdx = currentIndex + 1;
    if (shuffle) {
        let newIdx;
        do { newIdx = Math.floor(Math.random() * allSongs.length); } while (newIdx === currentIndex && allSongs.length > 1);
        nextIdx = newIdx;
    }
    if (nextIdx >= allSongs.length) {
        if (repeat) nextIdx = currentIndex;
        else return;
    }
    playSong(allSongs[nextIdx], nextIdx);
}
function prevSong() {
    let prevIdx = currentIndex - 1;
    if (prevIdx < 0) prevIdx = allSongs.length - 1;
    playSong(allSongs[prevIdx], prevIdx);
}

// ========================= INTERACCIONES (likes, playlists) =========================
async function registrarInteraccion(cancion, tipo) {
    if (!currentUser || currentUser.username === "Invitado") return;
    if (tipo === "like") {
        if (!userLikes.includes(cancion.id)) {
            userLikes.push(cancion.id);
            toast("❤️ Añadido a Me gusta");
        } else {
            userLikes = userLikes.filter(id => id !== cancion.id);
            toast("💔 Like eliminado");
        }
        // Actualizar en Supabase
        await supabase.from("usuarios").update({ likes: userLikes }).eq("id", currentUser.id);
        currentUser.likes = userLikes;
        saveSession();
        renderCurrentView(); // refrescar lista
    } else if (tipo === "play") {
        // Actualizar scores de IA
        let scores = currentUser.scores || {};
        scores[cancion.genero] = (scores[cancion.genero] || 0) + 1;
        await supabase.from("usuarios").update({ scores }).eq("id", currentUser.id);
        currentUser.scores = scores;
        saveSession();
    }
}
// Playlists
function createPlaylist(name) {
    userPlaylists.push({ nombre: name, canciones: [] });
    savePlaylists();
}
function addToPlaylist(playlistIndex, songId) {
    userPlaylists[playlistIndex].canciones.push(songId);
    savePlaylists();
    toast(`Añadida a ${userPlaylists[playlistIndex].nombre}`);
}
function savePlaylists() {
    supabase.from("usuarios").update({ playlists: userPlaylists }).eq("id", currentUser.id);
    currentUser.playlists = userPlaylists;
    saveSession();
    renderPlaylistsSidebar();
}

// ========================= RENDERIZADO PRINCIPAL =========================
function renderSongs(songs, title = "Canciones") {
    const container = $("tracksContainer");
    if (!songs.length) {
        container.innerHTML = "<div class='empty-state'>No hay canciones para mostrar</div>";
        return;
    }
    container.innerHTML = songs.map((song, idx) => `
        <div class="track-row ${currentSong && currentSong.id === song.id ? 'playing' : ''}" data-id="${song.id}">
            <div class="col-num">${idx+1}</div>
            <div class="col-title">
                <div class="col-cover" style="background: linear-gradient(135deg, #6366f1, #a855f7);"></div>
                <div class="col-text">
                    <div class="song-name">${escapeHtml(song.titulo)}</div>
                    <div class="artist-name">${escapeHtml(song.artista)}</div>
                </div>
            </div>
            <div class="col-genre">${song.genero}</div>
            <div class="col-duration">3:30</div>
            <div class="col-actions">
                <span class="action-like ${userLikes.includes(song.id) ? 'liked' : ''}" data-id="${song.id}">${userLikes.includes(song.id) ? '❤️' : '♡'}</span>
                <span class="action-add" data-id="${song.id}">➕</span>
            </div>
        </div>
    `).join("");
    // Eventos dinámicos
    document.querySelectorAll(".action-like").forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const id = parseInt(btn.dataset.id);
            const song = allSongs.find(s => s.id === id);
            if (song) registrarInteraccion(song, "like");
        };
    });
    document.querySelectorAll(".action-add").forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const id = parseInt(btn.dataset.id);
            openPlaylistModal(id);
        };
    });
    document.querySelectorAll(".track-row").forEach(row => {
        row.onclick = () => {
            const id = parseInt(row.dataset.id);
            const song = allSongs.find(s => s.id === id);
            const idx = allSongs.findIndex(s => s.id === id);
            if (song) playSong(song, idx);
        };
    });
}
function escapeHtml(str) { return str.replace(/[&<>]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m])); }

// ========================= IA – SISTEMA DE RECOMENDACIÓN =========================
function obtenerTopGeneros(n = 2) {
    if (!currentUser || !currentUser.scores) return [];
    const scores = currentUser.scores;
    return Object.entries(scores).sort((a,b) => b[1] - a[1]).slice(0,n).map(([g]) => g);
}
function calcularMoodPreferido() {
    if (!currentUser || !currentUser.scores) return null;
    // Simulación basada en género con más puntos
    const top = obtenerTopGeneros(1);
    if (top[0] === "Rock" || top[0] === "Electrónica") return "Energético";
    if (top[0] === "Jazz" || top[0] === "Clásica") return "Relajado";
    if (top[0] === "Reguetón" || top[0] === "Latina") return "Fiesta";
    return "Melancólico";
}
function recomendarCanciones() {
    if (!allSongs.length) return [];
    const topGeneros = obtenerTopGeneros(2);
    const mood = calcularMoodPreferido();
    const likedIds = new Set(userLikes);
    // Puntuación
    const scored = allSongs.map(song => {
        let score = 0;
        if (topGeneros.includes(song.genero)) score += 10;
        if (song.mood === mood) score += 5;
        if (likedIds.has(song.id)) score += 3;
        if (currentUser && currentUser.scores && currentUser.scores[song.genero]) {
            score += currentUser.scores[song.genero] * 0.5;
        }
        return { ...song, _score: score };
    });
    scored.sort((a,b) => b._score - a._score);
    return scored.slice(0, 20);
}

// ========================= SUBIR MÚSICA (solo admin) =========================
async function uploadSong(file, artista, genero, mood, coverFile = null) {
    const fileName = `${Date.now()}_${file.name.replace(/[^a-z0-9.]/gi, "_")}`;
    const audioPath = `canciones/${fileName}`;
    const { error: uploadError } = await supabase.storage.from("canciones").upload(audioPath, file);
    if (uploadError) { toast("Error subiendo audio", true); return false; }
    const { data: urlData } = supabase.storage.from("canciones").getPublicUrl(audioPath);
    let coverUrl = null;
    if (coverFile) {
        const coverName = `covers/${Date.now()}_cover.jpg`;
        await supabase.storage.from("canciones").upload(coverName, coverFile);
        coverUrl = supabase.storage.from("canciones").getPublicUrl(coverName).data.publicUrl;
    }
    const titulo = file.name.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " ");
    const { error: insertError } = await supabase.from("canciones").insert({
        titulo, artista, genero, mood, url_audio: urlData.publicUrl, url_imagen: coverUrl
    });
    if (insertError) { toast("Error guardando en BD", true); return false; }
    return true;
}

// ========================= INICIALIZAR VISTAS =========================
let currentView = "home";
function renderCurrentView() {
    if (currentView === "home") {
        $("sectionTitle").innerText = "Descubre lo nuevo";
        $("sectionSub").innerText = "";
        renderSongs(allSongs);
    } else if (currentView === "library") {
        $("sectionTitle").innerText = "Tu biblioteca";
        $("sectionSub").innerText = "Todas las canciones";
        renderSongs(allSongs);
    } else if (currentView === "recommend") {
        $("sectionTitle").innerText = "Recomendado para ti";
        $("sectionSub").innerText = "Basado en tu actividad";
        const recs = recomendarCanciones();
        renderSongs(recs);
    }
}
function renderPlaylistsSidebar() {
    const container = $("playlistsContainer");
    if (!container) return;
    container.innerHTML = userPlaylists.map((pl, idx) => `
        <div class="playlist-item" data-idx="${idx}">
            <span>📀 ${pl.nombre}</span>
            <span class="pl-count">${pl.canciones.length}</span>
        </div>
    `).join("");
    document.querySelectorAll(".playlist-item").forEach(el => {
        el.onclick = () => {
            const idx = parseInt(el.dataset.idx);
            const pl = userPlaylists[idx];
            const songs = allSongs.filter(s => pl.canciones.includes(s.id));
            $("sectionTitle").innerText = pl.nombre;
            renderSongs(songs);
            currentView = "playlist";
        };
    });
}
function updateUIAfterLogin() {
    const isLogged = currentUser && currentUser.username !== "Invitado";
    $("sidebarUserName").innerText = currentUser ? (currentUser.nombre || currentUser.username) : "Invitado";
    $("topUserName").innerText = currentUser ? (currentUser.nombre || currentUser.username) : "Invitado";
    $("welcomeName").innerText = currentUser ? (currentUser.nombre || "amante de la música") : "Invitado";
    $("sidebarFavGen").innerText = currentUser && currentUser.generoFav ? `Fav: ${currentUser.generoFav}` : "—";
    const uploadNav = $("uploadNavBtn");
    if (uploadNav) uploadNav.style.display = (currentUser && currentUser.username === "admin") ? "block" : "none";
    renderPlaylistsSidebar();
    renderCurrentView();
}

// ========================= EVENTOS Y ARRANQUE =========================
document.addEventListener("DOMContentLoaded", async () => {
    await loadCatalog();
    if (loadSession()) {
        $("authModal").classList.add("hidden");
        $("app").classList.remove("hidden");
        $("playerBar").classList.remove("hidden");
        updateUIAfterLogin();
    } else {
        $("authModal").classList.remove("hidden");
        $("app").classList.add("hidden");
        $("playerBar").classList.add("hidden");
    }

    // Autenticación
    $("doLogin").onclick = async () => {
        const user = $("loginUser").value;
        const pass = $("loginPass").value;
        if (!user || !pass) { toast("Completa todos los campos", true); return; }
        const ok = await login(user, pass);
        if (ok) {
            $("authModal").classList.add("hidden");
            $("app").classList.remove("hidden");
            $("playerBar").classList.remove("hidden");
            updateUIAfterLogin();
        } else toast("Usuario o contraseña incorrectos", true);
    };
    $("doRegister").onclick = async () => {
        const nombre = $("regName").value;
        const user = $("regUser").value;
        const pass = $("regPass").value;
        const gen = $("regGen").value;
        if (!nombre || !user || !pass) { toast("Completa todos los campos", true); return; }
        const ok = await register(user, pass, nombre, gen);
        if (ok) {
            $("authModal").classList.add("hidden");
            $("app").classList.remove("hidden");
            $("playerBar").classList.remove("hidden");
            updateUIAfterLogin();
        } else toast("El usuario ya existe", true);
    };
    $("guestMode").onclick = () => {
        currentUser = { username: "Invitado", nombre: "Invitado", likes: [], playlists: [], scores: {} };
        userLikes = [];
        userPlaylists = [];
        $("authModal").classList.add("hidden");
        $("app").classList.remove("hidden");
        $("playerBar").classList.remove("hidden");
        updateUIAfterLogin();
    };
    $("sidebarLogout").onclick = () => {
        clearSession();
        location.reload();
    };
    $("dropdownLogout").onclick = () => {
        clearSession();
        location.reload();
    };
    // Navegación
    document.querySelectorAll(".nav-link").forEach(link => {
        link.onclick = (e) => {
            e.preventDefault();
            document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
            link.classList.add("active");
            const view = link.dataset.view;
            if (view === "home") currentView = "home";
            else if (view === "library") currentView = "library";
            else if (view === "recommend") currentView = "recommend";
            else if (view === "upload") { $("uploadModal").classList.remove("hidden"); return; }
            renderCurrentView();
        };
    });
    // Reproductor
    audioPlayer.ontimeupdate = () => {
        const percent = (audioPlayer.currentTime / audioPlayer.duration) * 100;
        $("progressFill").style.width = percent + "%";
        $("currentTime").innerText = formatTime(audioPlayer.currentTime);
        $("totalTime").innerText = formatTime(audioPlayer.duration);
    };
    audioPlayer.onended = () => {
        $("playerDisc").classList.remove("spinning");
        if (repeat) {
            audioPlayer.currentTime = 0;
            audioPlayer.play();
            $("playerDisc").classList.add("spinning");
        } else nextSong();
    };
    $("playBtn").onclick = () => {
        if (!currentSong) return;
        if (audioPlayer.paused) {
            audioPlayer.play();
            $("playBtn").innerHTML = "⏸️";
            $("playerDisc").classList.add("spinning");
        } else {
            audioPlayer.pause();
            $("playBtn").innerHTML = "▶️";
            $("playerDisc").classList.remove("spinning");
        }
    };
    $("nextBtn").onclick = () => nextSong();
    $("prevBtn").onclick = () => prevSong();
    $("shuffleBtn").onclick = () => { shuffle = !shuffle; toast(shuffle ? "Aleatorio activado" : "Aleatorio desactivado"); };
    $("repeatBtn").onclick = () => { repeat = !repeat; toast(repeat ? "Repetir activado" : "Repetir desactivado"); };
    $("likePlayerBtn").onclick = () => {
        if (currentSong) registrarInteraccion(currentSong, "like");
    };
    // Volumen
    const volSlider = $("volumeSlider");
    volSlider.onclick = (e) => {
        const rect = volSlider.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        audioPlayer.volume = Math.min(1, Math.max(0, pct));
        $("volumeFill").style.width = (audioPlayer.volume * 100) + "%";
        $("volumeIcon").innerText = audioPlayer.volume === 0 ? "🔇" : audioPlayer.volume < 0.5 ? "🔉" : "🔊";
    };
    // Progreso clickeable
    $("progressBarWrap").onclick = (e) => {
        const rect = $("progressBarWrap").getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        if (audioPlayer.duration) audioPlayer.currentTime = pct * audioPlayer.duration;
    };
    // Subida de música
    $("uploadAudioLabel").onclick = () => $("audioFiles").click();
    $("uploadImageLabel").onclick = () => $("coverImage").click();
    $("confirmUpload").onclick = async () => {
        const files = $("audioFiles").files;
        const artista = $("uploadArtist").value.trim();
        const genero = $("uploadGenre").value;
        const mood = $("uploadMood").value;
        const cover = $("coverImage").files[0];
        if (!files.length || !artista) { toast("Selecciona audio y artista", true); return; }
        for (let f of files) {
            await uploadSong(f, artista, genero, mood, cover);
        }
        await loadCatalog();
        renderCurrentView();
        $("uploadModal").classList.add("hidden");
        toast("Música subida correctamente");
    };
    $("closeUpload").onclick = () => $("uploadModal").classList.add("hidden");
    // Nueva playlist
    $("newPlaylistBtn").onclick = () => $("newPlaylistModal").classList.remove("hidden");
    $("createPl").onclick = () => {
        const name = $("newPlName").value.trim();
        if (name) { createPlaylist(name); $("newPlaylistModal").classList.add("hidden"); }
        else toast("Escribe un nombre", true);
    };
    $("cancelPl").onclick = () => $("newPlaylistModal").classList.add("hidden");
    // Visualizador básico
    const canvas = $("visualizer");
    const ctx = canvas.getContext("2d");
    function drawVisualizer() {
        if (!canvas) return;
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
        const w = canvas.width, h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        if (!audioPlayer.paused && audioPlayer.duration) {
            const freq = 32;
            for (let i = 0; i < freq; i++) {
                const val = Math.sin(Date.now() * 0.005 + i * 0.3) * 0.6 + 0.4;
                const barH = val * h;
                ctx.fillStyle = `hsl(${240 + i * 2}, 70%, 60%)`;
                ctx.fillRect(i * (w / freq), h - barH, (w / freq) - 1, barH);
            }
        }
        requestAnimationFrame(drawVisualizer);
    }
    drawVisualizer();
});
function openPlaylistModal(songId) {
    if (!currentUser || currentUser.username === "Invitado") { toast("Inicia sesión para usar playlists", true); return; }
    const container = $("playlistOptions");
    container.innerHTML = userPlaylists.map((pl, idx) => `<button class="playlist-opt" data-idx="${idx}">📀 ${pl.nombre}</button>`).join("");
    document.querySelectorAll(".playlist-opt").forEach(btn => {
        btn.onclick = () => {
            const idx = parseInt(btn.dataset.idx);
            addToPlaylist(idx, songId);
            $("playlistModal").classList.add("hidden");
        };
    });
    $("playlistModal").classList.remove("hidden");
}
$("closePlaylistModal").onclick = () => $("playlistModal").classList.add("hidden");
window.openPlaylistModal = openPlaylistModal;

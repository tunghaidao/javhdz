/* ============================================
   Netflix-Style Frontend App
   ============================================ */
let currentSite = 'javhdz';
let currentPage = 1;
let currentCategory = '';
let currentSearch = '';
let allVideos = [];
let allCategories = [];
let totalPages = 1;

// ===================== INIT =====================
document.addEventListener('DOMContentLoaded', () => {
  window.addEventListener('scroll', () => {
    document.getElementById('navbar').classList.toggle('scrolled', window.scrollY > 68);
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    const overlay = document.getElementById('playerOverlay');
    const isOpen = overlay.classList.contains('open');

    if (e.key === ' ' || e.key === 'Spacebar') {
      if (isOpen) {
        const video = document.getElementById('videoPlayer');
        if (video) { if (video.paused) video.play().catch(() => {}); else video.pause(); }
        e.preventDefault();
      }
      return;
    }
    if ((e.key === 'f' || e.key === 'F') && isOpen) {
      const video = document.getElementById('videoPlayer');
      const wrap = document.getElementById('playerWrap');
      if (video) {
        if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); }
        else { const el = wrap || video; el.requestFullscreen?.() || el.webkitRequestFullscreen?.() || el.msRequestFullscreen?.(); }
      }
      e.preventDefault();
    }
    if (e.key === 'Escape' && isOpen) closePlayer();
  });

  // Event delegation
  document.addEventListener('click', e => {
    const card = e.target.closest('.card');
    if (card) {
      const idx = card.dataset.idx;
      if (idx !== undefined && allVideos[idx]) {
        const v = allVideos[idx];
        const origSite = v._site || currentSite;
        openPlayer(v, origSite);
      }
      return;
    }
    const heart = e.target.closest('.card-fav');
    if (heart) {
      e.stopPropagation();
      const idx = heart.dataset.idx;
      if (idx !== undefined && allVideos[idx]) toggleFavorite(allVideos[idx]);
      return;
    }
    const catBtn = e.target.closest('.cat-btn');
    if (catBtn) { filterCategory(catBtn.dataset.slug); return; }
    const navLink = e.target.closest('.nav-links a');
    if (navLink) { switchSite(navLink.dataset.site); return; }
    const logo = e.target.closest('.logo');
    if (logo) { e.preventDefault(); switchSite('javhdz'); return; }
    const favLink = e.target.closest('#favNavLink');
    if (favLink) { e.preventDefault(); showFavorites(); return; }
    const searchBtn = e.target.closest('.search-box button');
    if (searchBtn) { doSearch(); return; }
    const pageBtn = e.target.closest('.page-btn');
    if (pageBtn) { const d = parseInt(pageBtn.dataset.delta); if (d) changePage(d); return; }
    const tag = e.target.closest('.player-tag');
    if (tag) { filterByTag(tag.dataset.slug); return; }
    const part = e.target.closest('.player-part');
    if (part) { switchPart(part); return; }
    const close = e.target.closest('.player-close');
    if (close) { closePlayer(); return; }
    const dlBtn = e.target.closest('.dl-btn');
    if (dlBtn) { if (dlBtn.dataset.url) downloadCached(dlBtn.dataset.url); return; }
    // Click hero banner → phát video đầu
    if (e.target.closest('.hero') && !e.target.closest('.btn-secondary')) {
      if (allVideos[0]) openPlayer(allVideos[0]);
      return;
    }
    if (e.target.closest('.player-overlay') && !e.target.closest('.player-container')) { closePlayer(); }
  });

  document.getElementById('searchInput').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
  document.querySelector('.menu-toggle').addEventListener('click', () => { document.getElementById('navLinks').classList.toggle('open'); });

  loadVideos();
});

// ===================== API =====================
async function apiFetch(path) {
  try { const r = await fetch(path); return await r.json(); }
  catch (e) { console.error('API error:', e); return { success: false }; }
}

// ===================== NAVIGATION =====================
function switchSite(site) {
  currentSite = site; currentPage = 1; currentCategory = ''; currentSearch = '';
  document.querySelectorAll('.nav-links a').forEach(a => a.classList.toggle('active', a.dataset.site === site));
  if (window.innerWidth <= 768) document.getElementById('navLinks').classList.remove('open');
  document.getElementById('searchInput').value = '';
  loadVideos();
}

function doSearch() {
  const q = document.getElementById('searchInput').value.trim();
  if (!q) return;
  currentSearch = q; currentCategory = ''; currentPage = 1;
  loadVideos();
}

// ===================== LOAD VIDEOS =====================
async function loadVideos() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading-screen"><div class="spinner"></div><p>Đang tải...</p></div>';
  const params = new URLSearchParams({ site: currentSite, page: currentPage });
  if (currentCategory) params.set('category', currentCategory);
  if (currentSearch) params.set('search', currentSearch);
  const data = await apiFetch(`/api/videos?${params}`);
  if (!data.success || !data.videos?.length) {
    content.innerHTML = '<div class="loading-screen"><p style="color:#aaa">Không tìm thấy video nào.</p></div>';
    return;
  }
  allVideos = data.videos;
  allCategories = data.categories || [];
  totalPages = data.totalPages || Math.max(1, Math.ceil(allVideos.length / 20) + 1);
  renderHero(allVideos);
  renderCategories(allCategories);
  renderRows(allVideos);
}

// ===================== HERO =====================
function renderHero(videos) {
  const pick = videos[0];
  if (!pick) return;
  document.getElementById('heroBg').style.backgroundImage = `url(${pick.thumbnail})`;
  document.getElementById('heroTitle').textContent = pick.title.length > 60 ? pick.title.slice(0, 57) + '...' : pick.title;
  document.getElementById('heroDesc').textContent = 'Luot xem: ' + (pick.views || 'N/A') + ' · ' + currentSite.toUpperCase();
  document.getElementById('heroPlayBtn').onclick = () => openPlayer(pick);
}

// ===================== CATEGORIES =====================
function renderCategories(cats) {
  const scroll = document.getElementById('catScroll');
  let html = '<button class="cat-btn active" data-slug="">📺 Tat ca</button>';
  for (const c of cats) html += `<button class="cat-btn" data-slug="${c.slug}">${c.name}</button>`;
  scroll.innerHTML = html;
}

function filterCategory(slug) {
  currentCategory = slug; currentPage = 1;
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.toggle('active', b.dataset.slug === slug));
  loadVideos();
}

// ===================== ROWS =====================
function renderRows(videos) {
  const content = document.getElementById('content');
  if (!videos.length) { content.innerHTML = '<div class="loading-screen"><p style="color:#aaa">Khong co video.</p></div>'; return; }

  const rows = [{ title: '🔥 De xuat cho ban', vids: videos.slice(0, 10) }];
  if (videos.length > 10) rows.push({ title: '📌 Tiep theo', vids: videos.slice(10, 22) });
  if (videos.length > 22) rows.push({ title: '🎬 Phim moi cap nhat', vids: videos.slice(22, 40) });
  const remaining = videos.slice(40);
  if (remaining.length) { for (let i = 0; i < remaining.length; i += 12) rows.push({ title: i === 0 ? '✨ Goi y them' : '📺 Xem them', vids: remaining.slice(i, i + 12) }); }

  let html = '<div class="rows-container">';
  for (const row of rows) {
    html += `<div class="row"><div class="row-header"><h3 class="row-title">${escHtml(row.title)}</h3><span class="row-count">${row.vids.length} video</span></div><div class="row-scroll">`;
    for (let i = 0; i < row.vids.length; i++) html += renderCard(row.vids[i], allVideos.indexOf(row.vids[i]));
    html += '</div></div>';
  }
  html += '</div>';
  html += `<div class="page-controls"><button class="page-btn" data-delta="-1" ${currentPage <= 1 ? 'disabled' : ''}>◀ Truoc</button><span class="page-info">Trang ${currentPage} / ${totalPages}</span><button class="page-btn" data-delta="1" ${currentPage >= totalPages ? 'disabled' : ''}>Sau ▶</button></div>`;
  content.innerHTML = html;
}

function renderCard(v, idx) {
  const thumb = v.thumbnail || '';
  const title = v.title || 'Khong co tieu de';
  const views = v.views || 'N/A';
  const faved = isFavorite(v);
  return `<div class="card" data-idx="${idx}"><img class="card-img" src="${thumb}" alt="${escHtml(title)}" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 220 310%22><rect fill=%22%23222%22 width=%22220%22 height=%22310%22/><text x=%22110%22 y=%22155%22 text-anchor=%22middle%22 fill=%22%23555%22 font-size=%2224%22>🎬</text></svg>'"><div class="card-body"><div class="card-title">${escHtml(title)}</div><div class="card-views">👁 ${escHtml(views)}</div></div><div class="card-overlay"><span class="card-play">▶</span><span class="card-fav ${faved ? 'faved' : ''}" data-idx="${idx}" style="position:absolute;top:8px;right:8px;font-size:20px;cursor:pointer;text-shadow:0 1px 4px rgba(0,0,0,.8)">${faved ? '♥' : '♡'}</span></div></div>`;
}

function escHtml(s) { if (!s) return ''; return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function changePage(delta) { currentPage += delta; if (currentPage < 1) currentPage = 1; loadVideos(); window.scrollTo({ top: 0, behavior: 'smooth' }); }

// ===================== PLAYER =====================
let currentHls = null;
let currentVideoPath = '';

// Favorites
const FAV_KEY = 'netflix_favs';

function getFavorites() {
  try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch { return []; }
}

function saveFavorites(favs) {
  localStorage.setItem(FAV_KEY, JSON.stringify(favs));
  updateFavNav();
}

function updateFavNav() {
  const favs = getFavorites();
  const link = document.getElementById('favNavLink');
  if (link) {
    link.style.display = favs.length ? 'inline' : 'none';
    link.textContent = '♥ ' + favs.length;
  }
}

function toggleFavorite(video) {
  const favs = getFavorites();
  const key = currentSite + ':' + video.path;
  const idx = favs.findIndex(f => f.key === key);
  if (idx > -1) { favs.splice(idx, 1); } else { favs.push({ key, site: currentSite, path: video.path, title: video.title, thumbnail: video.thumbnail }); }
  saveFavorites(favs);
  // Re-render cards to update hearts
  renderRows(allVideos);
}

function isFavorite(video) {
  const key = currentSite + ':' + video.path;
  return getFavorites().some(f => f.key === key);
}

function showFavorites() {
  closePlayer();
  const favs = getFavorites();
  const content = document.getElementById('content');
  if (!favs.length) { content.innerHTML = '<div class="loading-screen"><p style="color:#aaa">Chua co video yeu thich.</p></div>'; return; }
  currentSite = 'fav';
  document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
  document.getElementById('favNavLink').style.color = '#fff';
  // Render favorites with site data attributes
  const vids = favs.map(f => ({ title: f.title, path: f.path, thumbnail: f.thumbnail, views: '♥', _site: f.site }));
  allVideos = vids;
  renderRows(vids);
}

async function openPlayer(video, optSite) {
  const site = optSite || currentSite;
  const overlay = document.getElementById('playerOverlay');
  document.getElementById('playerTitle').textContent = video.title || 'Dang tai...';
  overlay.classList.add('open');
  const playerWrap = document.getElementById('playerWrap');
  playerWrap.innerHTML = '<div class="loading-screen" style="padding:40px 0"><div class="spinner"></div><p>Dang tai video...</p></div>';

  const path = video.path || '';
  const detail = await apiFetch(`/api/video-detail?path=${encodeURIComponent(path)}&site=${site}`);
  if (!detail.success) { playerWrap.innerHTML = '<div class="loading-screen"><p style="color:#e50914">Khong the tai video.</p></div>'; return; }

  document.getElementById('playerTitle').textContent = detail.title || video.title;
  // Heart trong player header
  const isFav = getFavorites().some(f => f.key === site + ':' + video.path);
  const existingHeart = document.getElementById('playerHeart');
  if (existingHeart) existingHeart.remove();
  const heartBtn = document.createElement('button');
  heartBtn.id = 'playerHeart';
  heartBtn.textContent = isFav ? '♥' : '♡';
  heartBtn.style.cssText = 'background:none;border:none;color:' + (isFav ? '#e50914' : '#fff') + ';font-size:22px;cursor:pointer;opacity:.8;margin-right:8px;flex-shrink:0';
  heartBtn.onclick = () => {
    toggleFavorite(video);
    heartBtn.textContent = getFavorites().some(f => f.key === site + ':' + video.path) ? '♥' : '♡';
    heartBtn.style.color = getFavorites().some(f => f.key === site + ':' + video.path) ? '#e50914' : '#fff';
  };
  document.getElementById('playerTitle').parentNode.insertBefore(heartBtn, document.getElementById('playerTitle'));
  document.getElementById('playerTags').innerHTML = (detail.tags || []).slice(0, 10).map(t => `<span class="player-tag" data-slug="${escHtml(t.slug)}">${escHtml(t.name)}</span>`).join('');
  document.getElementById('playerDesc').innerHTML = detail.description ? `<p>${detail.description}</p>` : '';

  // Download yt-dlp command
  const streamUrl = detail.streamUrl || '';
  document.getElementById('playerActions').innerHTML = '';
  // Xoá command cũ nếu có
  const oldCmd = document.querySelector('.dl-cmd-row');
  if (oldCmd) oldCmd.remove();

  if (streamUrl) {
    const hostMap = { javhdz:'javhdz.ws', vlxx:'vlxx.moi', quatvn:'quatvn.moi', sexbjcam:'sexbjcam.com' };
    const host = hostMap[site] || 'javhdz.ws';
    // Dùng proxy URL (qua server) thay vì CDN gốc — tránh Cloudflare
    const proxyUrl = detail.proxiedStreamUrl || streamUrl;
    const fullUrl = proxyUrl.startsWith('http') ? proxyUrl : 'http://localhost:3000' + proxyUrl;
    const safeTitle = (detail.title || video.title || 'video').replace(/[/\\?%*:|"<>]/g, '_').slice(0, 100);
    const cmd = `yt-dlp --downloader ffmpeg --downloader-args "ffmpeg_i:-threads 4" --referer "https://${host}/" -o "${safeTitle}.%(ext)s" --force-overwrites '${fullUrl}'`;

    // Tự copy vào clipboard
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(cmd).catch(() => {});
    }

    const cmdRow = document.createElement('div');
    cmdRow.className = 'dl-cmd-row';
    cmdRow.style.cssText = 'margin:6px 20px 0;padding:8px 0;border-top:1px solid #2a2a2a';
    cmdRow.innerHTML = `<div style="font-size:11px;color:#666;margin-bottom:4px">📋 yt-dlp <span style="color:#444">(đã copy vào clipboard)</span></div>
      <pre style="background:#0d0d0d;color:#0f0;padding:6px 10px;border-radius:4px;font-size:11px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;cursor:pointer;margin:0" 
        onclick="navigator.clipboard.writeText(this.textContent);this.style.color='#fff';setTimeout(()=>this.style.color='#0f0',1000)">${escHtml(cmd)}</pre>`;
    document.getElementById('playerActions').insertAdjacentElement('afterend', cmdRow);
  }

  // Playlist parts
  const playlist = detail.playlist || [];
  const existingPl = document.querySelector('.player-playlist');
  if (existingPl) existingPl.remove();

  if (playlist.length > 1) {
    let plHtml = '<div class="player-playlist" style="margin:0 20px 12px;border-top:1px solid #333;padding-top:10px">';
    plHtml += '<div style="font-size:13px;color:#999;margin-bottom:6px">📋 Danh sach phan</div><div style="display:flex;gap:6px;flex-wrap:wrap">';
    for (const p of playlist) {
      const active = p.index === 0 ? 'background:var(--accent);color:#fff' : 'background:var(--surface2);color:var(--text)';
      plHtml += `<span class="player-part" data-idx="${p.index}" data-url="${p.proxiedStreamUrl || p.streamUrl}" data-title="${escHtml(p.title)}" style="cursor:pointer;padding:4px 12px;border-radius:12px;font-size:12px;${active}" onclick="event.stopPropagation();switchPart(this)">${escHtml(p.title)}</span>`;
    }
    plHtml += '</div></div>';
    document.getElementById('playerTags').insertAdjacentHTML('afterend', plHtml);
  }

  // Load video player
  const hlsUrl = detail.proxiedStreamUrl || detail.streamUrl;
  if (!hlsUrl) {
    if (site === 'sexbjcam') {
      // Mở trang gốc trong iframe — cách duy nhất để xem Stripchat embed
      playerWrap.innerHTML = `<iframe src="https://sexbjcam.com${video.path}" style="width:100%;height:100%;position:absolute;top:0;left:0;border:none" allowfullscreen></iframe>`;
      const badge = document.createElement('span');
      badge.style.cssText = 'position:absolute;top:8px;right:8px;z-index:10;background:rgba(0,0,0,.7);color:#e50914;font-size:11px;font-weight:600;padding:3px 8px;border-radius:4px';
      badge.textContent = 'EMBED';
      playerWrap.appendChild(badge);
    } else {
      playerWrap.innerHTML = '<div class="loading-screen"><p style="color:#aaa">Khong tim thay nguon phat.</p></div>';
    }
    return;
  }

  currentVideoPath = video.path || '';
  loadVideoSource(hlsUrl, site, currentVideoPath, playerWrap);
}

function loadVideoSource(url, site, path, playerWrap) {
  playerWrap.innerHTML = '<video id="videoPlayer" controls autoplay playsinline></video>';
  const videoEl = document.getElementById('videoPlayer');

  // Resume
  const resumeKey = 'resume:' + site + ':' + path;
  let saveTimer = null;
  videoEl.addEventListener('timeupdate', () => {
    if (saveTimer) return;
    saveTimer = setTimeout(() => { saveTimer = null; if (videoEl.currentTime > 3) localStorage.setItem(resumeKey, videoEl.currentTime.toString()); }, 2000);
  });

  const badge = document.getElementById('qualityBadge');
  if (badge) badge.remove();

  const playVideo = () => videoEl.play().catch(() => {});

  if (currentHls) { try { currentHls.destroy(); } catch {} currentHls = null; }

  if (typeof Hls !== 'undefined' && Hls.isSupported()) {
    // URL .mp4 → bỏ qua HLS.js, phát trực tiếp
    if (url.includes('.mp4') || url.includes('?format=mp4') || url.includes('.m4v')) {
      videoEl.src = url; playVideo(); return;
    }
    const hls = new Hls({ enableWorker: true, lowLatencyMode: true, backbufferLength: 30, maxBufferLength: 30, startLevel: -1 });
    currentHls = hls;
    hls.loadSource(url);
    hls.attachMedia(videoEl);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      const levels = hls.levels;
      if (levels && levels.length > 0) {
        let maxLevel = 0, maxHeight = 0;
        for (let i = 0; i < levels.length; i++) { const h = levels[i].height || 0; if (h > maxHeight) { maxHeight = h; maxLevel = i; } }
        hls.currentLevel = maxLevel; hls.loadLevel = maxLevel; hls.nextLevel = maxLevel;
      }
      playVideo();
      const saved = localStorage.getItem(resumeKey);
      if (saved) { const t = parseFloat(saved); if (t > 3) videoEl.currentTime = t; }
    });
    hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
      const lvl = hls.levels?.[data.level];
      if (lvl) {
        const b = document.getElementById('qualityBadge') || (() => { const b2 = document.createElement('span'); b2.id = 'qualityBadge'; b2.style.cssText = 'position:absolute;bottom:60px;right:12px;z-index:10;background:rgba(0,0,0,.7);color:#fff;font-size:12px;font-weight:600;padding:3px 8px;border-radius:4px;pointer-events:none'; document.getElementById('playerWrap').appendChild(b2); return b2; })();
        b.textContent = lvl.height ? lvl.height + 'p' : 'HD';
      }
    });
    hls.on(Hls.Events.ERROR, (e, data) => { if (data.fatal) { hls.destroy(); currentHls = null; videoEl.src = url; playVideo(); } });
  } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
    videoEl.src = url; playVideo();
  } else {
    videoEl.src = url; playVideo();
  }
}

function switchPart(el) {
  document.querySelectorAll('.player-part').forEach(p => { p.style.background = 'var(--surface2)'; p.style.color = 'var(--text)'; });
  el.style.background = 'var(--accent)'; el.style.color = '#fff';
  const url = el.dataset.url;
  if (!url) return;
  document.getElementById('playerTitle').textContent = el.dataset.title || 'Dang phat...';
  loadVideoSource(url, currentSite, currentVideoPath, document.getElementById('playerWrap'));
}

function closePlayer() {
  if (currentHls) { try { currentHls.destroy(); } catch {} currentHls = null; }
  const overlay = document.getElementById('playerOverlay');
  const player = document.getElementById('videoPlayer');
  if (player) {
    player.pause();
    player.removeAttribute('src');
    player.load();
    // Xoá hẳn video element khỏi DOM để chặn mọi âm thanh
    player.remove();
  }
  // Stop iframe (sexbjcam) nếu có
  const iframe = document.querySelector('#playerWrap iframe');
  if (iframe) { iframe.src = ''; iframe.remove(); }
  // Reset playerWrap về trạng thái rỗng
  document.getElementById('playerWrap').innerHTML = '';
  overlay.classList.remove('open');
}

function filterByTag(slug) {
  closePlayer();
  currentCategory = slug; currentPage = 1; currentSearch = '';
  document.getElementById('searchInput').value = '';
  loadVideos();
}

function downloadCached(encodedUrl) {
  const url = decodeURIComponent(encodedUrl);
  if (!url) return;
  const btn = document.querySelector('.dl-btn');
  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
  const dlSite = btn ? (btn.dataset.site || currentSite) : currentSite;

  // Lấy stream URL gốc + tạo lệnh yt-dlp
  const cmd = `yt-dlp --downloader ffmpeg --downloader-args "ffmpeg_i:-threads 4" --referer "https://${dlSite === 'javhdz' ? 'javhdz.ws' : dlSite === 'vlxx' ? 'vlxx.moi' : dlSite === 'quatvn' ? 'quatvn.moi' : 'sexbjcam.com'}/" -o "video.mp4" '${url}'`;
  
  // Copy vào clipboard
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(cmd).catch(() => {});
  }

  // Hiển thị lệnh để copy — popup lớn
  const existingCmd = document.querySelector('.dl-command-overlay');
  if (existingCmd) existingCmd.remove();

  const overlay = document.createElement('div');
  overlay.className = 'dl-command-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:300;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  const box = document.createElement('div');
  box.style.cssText = 'background:#1a1a2e;border-radius:12px;padding:24px;max-width:700px;width:100%;box-shadow:0 8px 40px rgba(0,0,0,.5)';
  box.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
    <span style="font-size:16px;font-weight:700;color:#fff">📋 Lệnh tải video</span>
    <span onclick="this.closest('.dl-command-overlay').remove()" style="cursor:pointer;font-size:20px;color:#999">&times;</span>
  </div>
  <div style="font-size:13px;color:#aaa;margin-bottom:10px">Đã copy vào clipboard. Paste vào terminal:</div>
  <pre style="background:#0d0d0d;color:#0f0;padding:12px 16px;border-radius:6px;font-size:13px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;cursor:pointer;user-select:all;border:1px solid #333" 
    onclick="navigator.clipboard.writeText(this.textContent);this.style.borderColor='#0f0';setTimeout(()=>this.style.borderColor='#333',1000)">${escHtml(cmd)}</pre>
  <div style="font-size:11px;color:#666;margin-top:8px;text-align:center">Click vào lệnh để copy lại &bull; Đóng = bấm ra ngoài hoặc ✕</div>`;

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  if (btn) { btn.textContent = '✅ Da copy!'; setTimeout(() => { btn.textContent = '⬇ yt-dlp'; btn.disabled = false; }, 3000); }
}

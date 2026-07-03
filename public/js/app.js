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
    if (card) { const idx = card.dataset.idx; if (idx !== undefined && allVideos[idx]) openPlayer(allVideos[idx]); return; }
    const catBtn = e.target.closest('.cat-btn');
    if (catBtn) { filterCategory(catBtn.dataset.slug); return; }
    const navLink = e.target.closest('.nav-links a');
    if (navLink) { switchSite(navLink.dataset.site); return; }
    const logo = e.target.closest('.logo');
    if (logo) { e.preventDefault(); switchSite('javhdz'); return; }
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
  return `<div class="card" data-idx="${idx}"><img class="card-img" src="${thumb}" alt="${escHtml(title)}" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 220 310%22><rect fill=%22%23222%22 width=%22220%22 height=%22310%22/><text x=%22110%22 y=%22155%22 text-anchor=%22middle%22 fill=%22%23555%22 font-size=%2224%22>🎬</text></svg>'"><div class="card-body"><div class="card-title">${escHtml(title)}</div><div class="card-views">👁 ${escHtml(views)}</div></div><div class="card-overlay"><span class="card-play">▶</span></div></div>`;
}

function escHtml(s) { if (!s) return ''; return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function changePage(delta) { currentPage += delta; if (currentPage < 1) currentPage = 1; loadVideos(); window.scrollTo({ top: 0, behavior: 'smooth' }); }

// ===================== PLAYER =====================
let currentHls = null;
let currentVideoPath = '';

async function openPlayer(video) {
  const overlay = document.getElementById('playerOverlay');
  document.getElementById('playerTitle').textContent = video.title || 'Dang tai...';
  overlay.classList.add('open');
  const playerWrap = document.getElementById('playerWrap');
  playerWrap.innerHTML = '<div class="loading-screen" style="padding:40px 0"><div class="spinner"></div><p>Dang tai video...</p></div>';

  const path = video.path || '';
  const detail = await apiFetch(`/api/video-detail?path=${encodeURIComponent(path)}&site=${currentSite}`);
  if (!detail.success) { playerWrap.innerHTML = '<div class="loading-screen"><p style="color:#e50914">Khong the tai video.</p></div>'; return; }

  document.getElementById('playerTitle').textContent = detail.title || video.title;
  document.getElementById('playerTags').innerHTML = (detail.tags || []).slice(0, 10).map(t => `<span class="player-tag" data-slug="${escHtml(t.slug)}">${escHtml(t.name)}</span>`).join('');
  document.getElementById('playerDesc').innerHTML = detail.description ? `<p>${detail.description}</p>` : '';

  // Download button
  const streamUrl = detail.streamUrl || '';
  document.getElementById('playerActions').innerHTML = streamUrl ? `<button class="btn-secondary dl-btn" data-url="${encodeURIComponent(streamUrl)}" style="font-size:13px;padding:6px 14px">⬇ Tai tu cache</button>` : '';

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
    if (currentSite === 'sexbjcam') {
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
  loadVideoSource(hlsUrl, currentSite, currentVideoPath, playerWrap);
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
  if (btn) { btn.textContent = '⏳ Dang kiem tra...'; btn.disabled = true; }

  fetch(`/api/download-cached?pl=${encodeURIComponent(url)}&s=${currentSite}`)
    .then(r => {
      const ct = r.headers.get('content-type') || '';
      if (ct.includes('video/') || r.headers.get('content-disposition')) {
        const a = document.createElement('a');
        a.href = `/api/download-cached?pl=${encodeURIComponent(url)}&s=${currentSite}`;
        a.download = ''; a.click();
        if (btn) { btn.textContent = '✅ Da tai!'; btn.disabled = false; }
        return null;
      }
      return r.json().then(data => data);
    })
    .then(data => {
      if (!data) return;
      if (data.error === 'CACHE_NOT_READY') alert(`⏳ Cache chua san sang (${data.progress}%)\n${data.message}\n\n👉 Hay xem them video roi bam tai lai!`);
      else if (data.error === 'TOO_MANY_MISSING') alert(`❌ Nhieu segment loi (${data.progress}%)\n${data.message}`);
      else if (!data.success) alert('❌ Khong the tai. Thu lai sau.');
      if (btn) { btn.textContent = '⬇ Tai tu cache'; btn.disabled = false; }
    })
    .catch(() => { alert('❌ Loi ket noi.'); if (btn) { btn.textContent = '⬇ Tai tu cache'; btn.disabled = false; } });
}

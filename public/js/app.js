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
let allStudioRows = [];

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
    // Mũi tên trái/phải = tua 10s
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && isOpen) {
      const video = document.getElementById('videoPlayer');
      if (video && video.duration) {
        const seek = e.key === 'ArrowLeft' ? -30 : 30;
        video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + seek));
      }
      e.preventDefault();
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
    const heart = e.target.closest('.card-fav');
    if (heart) {
      e.stopPropagation();
      const idx = heart.dataset.idx;
      if (idx !== undefined && allVideos[idx]) {
        const v = allVideos[idx];
        toggleFavorite(v, v._site);
      }
      return;
    }
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
        const recItem = e.target.closest('.rec-item');
    if (recItem) {
      const idx = recItem.dataset.idx;
      if (idx !== undefined && allVideos[idx]) {
        const v = allVideos[idx];
        openPlayer(v, v._site || currentSite);
      }
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
    if (tag) { filterByTag(tag.dataset.slug, tag.dataset.type); return; }
    const part = e.target.closest('.player-part');
    if (part) { switchPart(part); return; }
    const close = e.target.closest('.player-close');
    if (close) { closePlayer(); return; }
    const childFav = e.target.closest('.child-fav-btn');
    if (childFav) {
      toggleChildFavorite(parseInt(childFav.dataset.cidx), childFav.dataset.ctitle, childFav.dataset.cpath, childFav.dataset.csite);
      return;
    }
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

  // Load favorites từ server
  loadFavs();

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
  allStudioRows = data.studioRows || [];
  totalPages = data.totalPages || Math.max(1, Math.ceil(allVideos.length / 20) + 1);
  renderCategories(allCategories);
  renderGrid(allVideos);
  // Fetch JAV codes cho javhdz (không có code trong listing)
  if (currentSite === 'javhdz') {
    const paths = allVideos.filter(v => !v.code).map(v => v.path).slice(0, 50);
    if (paths.length) {
      fetch(`/api/batch-codes?paths=${paths.map(encodeURIComponent).join(',')}`).then(r => r.json()).then(codes => {
        document.querySelectorAll('.card').forEach(card => {
          const idx = parseInt(card.dataset.idx);
          const v = allVideos[idx];
          if (v && codes[v.path]) {
            v.code = codes[v.path];
            const badge = card.querySelector('.card-code');
            if (badge) badge.textContent = codes[v.path];
          }
        });
      }).catch(() => {});
    }
  }
}

// ===================== CATEGORIES =====================
function renderCategories(cats) {
  const sidebar = document.getElementById('sidebarCats');
  let html = '<button class="cat-btn" data-slug="">📺 Tất cả</button>';
  for (const c of cats) html += `<button class="cat-btn" data-slug="${c.slug}">${c.name}</button>`;
  sidebar.innerHTML = html;
  // Studio sidebar
  const studioSec = document.getElementById('sidebarStudios');
  const studioList = document.getElementById('sidebarStudiosList');
  if (currentSite === 'javtrailers') {
    const studios = cats.filter(c => !['trending','newest'].includes(c.slug));
    if (studios.length) {
      studioSec.style.display = 'block';
      studioList.innerHTML = studios.map(c => `<button class="cat-btn" data-slug="${c.slug}">${c.name}</button>`).join('');
    }
  } else {
    studioSec.style.display = 'none';
  }
  // Highlight current
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.toggle('active', b.dataset.slug === currentCategory));
}

function filterCategory(slug) {
  currentCategory = slug; currentPage = 1;
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.toggle('active', b.dataset.slug === slug));
  loadVideos();
}

// ===================== ROWS =====================
function renderGrid(videos) {
  const content = document.getElementById('content');
  if (!videos.length) { content.innerHTML = '<div class="loading-screen"><p style="color:#aaa">Khong co video.</p></div>'; return; }

  let html = '<div class="video-list">';
  for (let i = 0; i < videos.length; i++) html += renderCard(videos[i], i);
  html += '</div>';

  html += `<div class="page-controls"><button class="page-btn" data-delta="-1" ${currentPage <= 1 ? 'disabled' : ''}>◀ Truoc</button><span class="page-info">Trang ${currentPage} / ${totalPages}</span><button class="page-btn" data-delta="1" ${currentPage >= totalPages ? 'disabled' : ''}>Sau ▶</button></div>`;
  content.innerHTML = html;

  // Populate right sidebar with first few videos as suggestions
  const sidebarRec = document.getElementById('sidebarRec');
  let recHtml = '';
  const maxRec = Math.min(15, videos.length);
  for (let i = 0; i < maxRec; i++) {
    const v = videos[i];
    recHtml += `<div class="rec-item" data-idx="${i}">
      <img class="rec-thumb" src="${v.thumbnail || ''}" alt="" loading="lazy" onerror="this.style.background='#222'">
      <div class="rec-info">
        <div class="rec-title">${escHtml(v.title || '')}</div>
        <div class="rec-views">👁 ${escHtml(v.views || 'N/A')}</div>
      </div>
    </div>`;
  }
  sidebarRec.innerHTML = recHtml;
}function renderCard(v, idx) {
  const thumb = v.thumbnail || '';
  const title = v.title || 'Khong co tieu de';
  const views = v.views || 'N/A';
  const code = v.code || '';
  const faved = isFavorite(v);
  const codeBadge = code ? `<span class="card-code">${escHtml(code)}</span>` : '';
  return `<div class="card" data-idx="${idx}">${codeBadge}<span class="card-fav ${faved ? 'faved' : ''}" data-idx="${idx}" style="position:absolute;z-index:5;top:6px;right:6px;font-size:22px;cursor:pointer;text-shadow:0 1px 6px rgba(0,0,0,.9);color:${faved ? '#e50914' : 'rgba(255,255,255,.85)'};transition:transform .15s" onmouseover="this.style.transform='scale(1.2)'" onmouseout="this.style.transform='scale(1)'">${faved ? '♥' : '♡'}</span><img class="card-img" src="${thumb}" alt="${escHtml(title)}" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 220 310%22><rect fill=%22%23222%22 width=%22220%22 height=%22310%22/><text x=%22110%22 y=%22155%22 text-anchor=%22middle%22 fill=%22%23555%22 font-size=%2224%22>🎬</text></svg>'"><div class="card-body"><div class="card-title">${escHtml(title)}</div><div class="card-views">👁 ${escHtml(views)}${code ? ' · <a href="https://sukebei.nyaa.si/?f=0&c=0_0&q=' + encodeURIComponent(code) + '" target="_blank" style="color:#e50914;font-weight:600;text-decoration:none" onclick="event.stopPropagation()">' + escHtml(code) + '</a>' : ''}</div></div></div>`;
}

function escHtml(s) { if (!s) return ''; return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

async function sukebeiSearch(code) {
  if (!code) return;
  const btn = event?.target;
  if (btn) { btn.textContent = '⏳'; }
  try {
    const r = await fetch('/api/sukebei-search?code=' + encodeURIComponent(code));
    const d = await r.json();
    if (d.success && d.magnet) {
      // Copy magnet + mở tab
      if (navigator.clipboard) navigator.clipboard.writeText(d.magnet).catch(() => {});
      window.open('https://sukebei.nyaa.si/?f=0&c=0_0&q=' + encodeURIComponent(code), '_blank');
      // Show popup
      const old = document.getElementById('sukebeiPopup');
      if (old) old.remove();
      const div = document.createElement('div');
      div.id = 'sukebeiPopup';
      div.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:999;background:#1a1a1a;padding:16px;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.6);max-width:400px';
      div.innerHTML = '<div style="font-size:13px;color:#0f0;margin-bottom:8px">✅ Torrent: ' + d.seeders + ' seeders</div>' +
        '<div style="font-size:11px;color:#888;margin-bottom:8px">Magnet đã copy. Mở tab Brave > PikPak extension sẽ bắt.</div>' +
        '<a href="' + d.magnet + '" target="_blank" style="display:inline-block;background:#e50914;color:#fff;padding:6px 14px;border-radius:6px;text-decoration:none;font-size:12px">📥 Mở magnet</a>' +
        '<button onclick="this.parentElement.remove()" style="margin-left:8px;background:var(--surface2);color:#fff;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:12px">✕</button>';
      document.body.appendChild(div);
      setTimeout(() => { const p = document.getElementById('sukebeiPopup'); if (p) p.remove(); }, 15000);
    } else {
      alert('❌ ' + (d.error || 'Không tìm thấy'));
    }
  } catch(e) { alert('Lỗi: ' + e.message); }
  if (btn) { setTimeout(() => { btn.textContent = code; }, 1000); }
}

function parseDuration(durStr) {
  if (!durStr) return 0;
  const parts = durStr.trim().split(':');
  if (parts.length === 3) return parseInt(parts[0]) * 60 + parseInt(parts[1]);
  if (parts.length === 2) return parseInt(parts[0]);
  return parseInt(parts[0]) || 0;
}

function changePage(delta) { currentPage += delta; if (currentPage < 1) currentPage = 1; loadVideos(); window.scrollTo({ top: 0, behavior: 'smooth' }); }

// ===================== PLAYER =====================
let currentHls = null;
let currentVideoPath = '';

// Favorites — server-sync (đồng bộ giữa các thiết bị)
let serverFavs = [];
let favLoaded = false;

function getFavorites() {
  return serverFavs;
}

async function loadFavs() {
  try {
    const r = await fetch('/api/favorites');
    const d = await r.json();
    if (d.success) {
      serverFavs = d.favorites;
      // Migrate localStorage favorites cũ lên server
      try {
        const old = JSON.parse(localStorage.getItem('netflix_favs') || '[]');
        if (old.length) {
          for (const f of old) {
            if (!serverFavs.some(sf => sf.key === f.key)) {
              await fetch('/api/favorites', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'toggle', site: f.site, path: f.path, title: f.title, thumbnail: f.thumbnail })
              });
              serverFavs.push(f);
            }
          }
          localStorage.removeItem('netflix_favs');
        }
      } catch {}
      favLoaded = true;
    }
  } catch {}
  updateFavNav();
}

async function toggleFavorite(video, optSite) {
  const site = optSite || currentSite;
  const key = site + ':' + video.path;
  const idx = serverFavs.findIndex(f => f.key === key);
  const hashIdx = video.path.indexOf('#idx=');
  const extra = hashIdx !== -1 ? { childIdx: parseInt(video.path.substring(hashIdx + 5)) || -1, parentPath: video.path.substring(0, hashIdx) } : {};
  if (idx > -1) { serverFavs.splice(idx, 1); } else { serverFavs.push({ key, site, path: video.path, title: video.title, thumbnail: video.thumbnail, ...extra }); }
  updateFavNav();
  renderGrid(allVideos);
  try {
    await fetch('/api/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggle', site, path: video.path, title: video.title, thumbnail: video.thumbnail, ...extra })
    });
  } catch {}
}

async function toggleChildFavorite(idx, title, parentPath, site) {
  const key = site + ':' + parentPath + '#idx=' + idx;
  const path = parentPath + '#idx=' + idx;
  const favIdx = serverFavs.findIndex(f => f.key === key);
  if (favIdx > -1) {
    serverFavs.splice(favIdx, 1);
  } else {
    serverFavs.push({ key, site, path, title, thumbnail: '', childIdx: idx, parentPath });
  }
  updateFavNav();
  // Refresh ♡ states in playlist
  document.querySelectorAll('.child-fav-btn').forEach(el => {
    const ek = site + ':' + el.dataset.cpath + '#idx=' + el.dataset.cidx;
    const isFav = serverFavs.some(f => f.key === ek);
    el.style.color = isFav ? '#e50914' : '#555';
    el.textContent = isFav ? '♥' : '♡';
  });
  try {
    await fetch('/api/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggle', site, path, title, thumbnail: '' })
    });
  } catch {}
}

function isFavorite(video) {
  const key = (currentSite) + ':' + video.path;
  return serverFavs.some(f => f.key === key);
}

function updateFavNav() {
  const link = document.getElementById('favNavLink');
  const count = document.getElementById('favCount');
  if (link) link.style.display = 'inline';
  if (count) count.textContent = serverFavs.length;
}

function showFavorites() {
  closePlayer();
  const favs = serverFavs;
  const content = document.getElementById('content');
  if (!favs.length) { content.innerHTML = '<div class="loading-screen"><p style="color:#aaa">Chua co video yeu thich.</p></div>'; return; }
  currentSite = 'fav';
  document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
  document.getElementById('favNavLink').style.color = '#fff';
  const vids = favs.map(f => ({ title: f.title, path: f.path, thumbnail: f.thumbnail, views: '♥', _site: f.site }));
  allVideos = vids;
  renderGrid(vids);
}

async function openPlayer(video, optSite) {
  const site = optSite || currentSite;
  const overlay = document.getElementById('playerOverlay');
  document.getElementById('playerTitle').textContent = video.title || 'Dang tai...';
  overlay.classList.add('open');
  const playerWrap = document.getElementById('playerWrap');
  playerWrap.innerHTML = '<div class="loading-screen" style="padding:40px 0"><div class="spinner"></div><p>Dang tai video...</p></div>';

  // Extract child index from path (e.g. /creators/foo#idx=2)
  let childIdx = -1;
  const rawPath = video.path || '';
  const hashIdx = rawPath.indexOf('#idx=');
  const path = hashIdx !== -1 ? rawPath.substring(0, hashIdx) : rawPath;
  if (hashIdx !== -1) childIdx = parseInt(rawPath.substring(hashIdx + 5)) || -1;

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
    toggleFavorite(video, site);
    heartBtn.textContent = getFavorites().some(f => f.key === site + ':' + video.path) ? '♥' : '♡';
    heartBtn.style.color = getFavorites().some(f => f.key === site + ':' + video.path) ? '#e50914' : '#fff';
  };
  document.getElementById('playerTitle').parentNode.insertBefore(heartBtn, document.getElementById('playerTitle'));
  document.getElementById('playerTags').innerHTML = (detail.tags || []).slice(0, 10).map(t => `<span class="player-tag" data-slug="${escHtml(t.slug)}" data-type="${t.type || ''}">${escHtml(t.name)}</span>`).join('');
  // Torrent tự động
  const existingT = document.getElementById('torrentInfo');
  if (existingT) existingT.remove();
  if (detail.torrent && detail.torrent.magnet) {
    const tDiv = document.createElement('div');
    tDiv.id = 'torrentInfo';
    tDiv.style.cssText = 'margin:0 20px 8px;padding:8px 12px;background:#1a2a1a;border-radius:8px;display:flex;align-items:center;gap:10px;font-size:12px';
    tDiv.innerHTML = '<span>🟢 Torrent sẵn (' + detail.torrent.seeders + ' seeders)</span>' +
      '<a href="' + detail.torrent.magnet + '" target="_blank" style="margin-left:auto;background:#e50914;color:#fff;padding:4px 12px;border-radius:6px;text-decoration:none;font-size:11px;font-weight:600">⬇ Magnet</a>';
    document.getElementById('playerTags').parentNode.insertAdjacentElement('afterend', tDiv);
  }
  document.getElementById('playerDesc').innerHTML = detail.description ? `<p>${detail.description}</p>` : '';

  // Download yt-dlp command
  const streamUrl = detail.streamUrl || '';
  document.getElementById('playerActions').innerHTML = streamUrl ? '<a href="/api/download-cached?pl=' + encodeURIComponent(streamUrl) + '&s=' + site + '" class="btn-secondary" style="font-size:12px;padding:4px 12px;text-decoration:none;color:#fff;background:var(--surface2);border-radius:6px">⬇ Cache</a><button class="btn-secondary" onclick="nextRandom()" style="font-size:12px;padding:4px 12px;margin-left:6px;background:var(--surface2);color:#fff;border:none;border-radius:6px;cursor:pointer">🎲 Tiếp</button><button class="btn-secondary" onclick="nextRandomFav()" style="font-size:12px;padding:4px 12px;margin-left:6px;background:var(--surface2);color:#e50914;border:none;border-radius:6px;cursor:pointer;font-weight:600">♥ Tiếp</button><button class="btn-secondary" onclick="clearVideoCache()" style="font-size:12px;padding:4px 12px;margin-left:6px;background:var(--surface2);color:#fff;border:none;border-radius:6px;cursor:pointer">🗑 Cache</button><button class="btn-secondary" onclick="showClipDialog()" style="font-size:12px;padding:4px 12px;margin-left:6px;background:var(--surface2);color:#fff;border:none;border-radius:6px;cursor:pointer">✂ Cắt</button>' : '';
  // Xoá command cũ nếu có
  const oldCmd = document.querySelector('.dl-cmd-row');
  if (oldCmd) oldCmd.remove();

  window._lastStreamUrl = streamUrl;
  window._lastVideoPath = video.path || '';
  window._lastSite = site;
  if (streamUrl) {
    const hostMap = { javhdz:'javhdz.ws', vlxx:'vlxx.moi', quatvn:'quatvn.moi', sexbjcam:'sexbjcam.com', javtrailers:'javtrailers.com', javtiful:'javtiful.com', viet69:'viet69.be', pornhub:'www.pornhub.com', kkphim:'kkphim.com', nguonc:'phim.nguonc.com', xchina:'3xchina.page', '18tube':'18tube.my' };
    const host = hostMap[site] || 'javhdz.ws';
    // Dùng stream URL gốc (CDN) thay vì proxy — yt-dlp xử lý Cloudflare tốt
    const baseUrl = window.location.origin;
    const fullUrl = detail.proxiedStreamUrl ? baseUrl + detail.proxiedStreamUrl : streamUrl;
    const safeTitle = (detail.title || video.title || 'video').replace(/[/\\?%*:|"<>]/g, '_').slice(0, 100);
    const safeUrl = fullUrl.replace(/'/g, "'\\''");
    const cmd = `yt-dlp --referer "https://${host}/" -o "${safeTitle}.%(ext)s" --force-overwrites '${safeUrl}'`;
    const dlUrl = `/api/download-cached?pl=${encodeURIComponent(streamUrl)}&s=${site}`;

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
    document.getElementById('playerDesc').parentNode.insertBefore(cmdRow, document.getElementById('playerRec'));
  }

  // Recommended videos theo tag đầu tiên
  const recContainer = document.getElementById('playerRec');
  if (recContainer) recContainer.remove();
  const tags = detail.tags || [];
  const firstTag = tags[0]?.slug || tags[0]?.name || '';
  if (firstTag && site !== 'fav' && site !== 'sexbjcam') {
    apiFetch(`/api/videos?site=${site}&search=${encodeURIComponent(firstTag)}&page=1`).then(data => {
      if (!data.success || !data.videos?.length) return;
      // Lọc bỏ video hiện tại
      const related = data.videos.filter(v => v.path !== video.path).slice(0, 12);
      if (!related.length) return;
      let html = `<div class="player-rec" id="playerRec" style="padding:12px 20px;border-top:1px solid #2a2a2a">`;
      html += `<div style="font-size:14px;color:#999;margin-bottom:8px">🎬 Liên quan: ${escHtml(tags[0]?.name || firstTag)}</div>`;
      html += `<div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:4px">`;
      for (const r of related) {
        const idx = allVideos.length;
        allVideos.push(r);
        html += `<div class="card" data-idx="${idx}" style="flex:0 0 auto;width:160px"><img class="card-img" src="${r.thumbnail}" alt="" loading="lazy" onerror="this.style.background='#222'"><div class="card-body"><div class="card-title">${escHtml(r.title || '')}</div></div></div>`;
      }
      html += `</div></div>`;
      document.getElementById('playerDesc').insertAdjacentHTML('afterend', html);
    }).catch(() => {});
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
      const childKey = site + ':' + video.path + '#idx=' + p.index;
      const isChildFav = getFavorites().some(f => f.key === childKey);
      plHtml += `<span class="player-part" data-idx="${p.index}" data-url="${p.proxiedStreamUrl || p.streamUrl}" data-title="${escHtml(p.title)}" style="cursor:pointer;padding:4px 12px;border-radius:12px;font-size:12px;${active}" onclick="event.stopPropagation();switchPart(this)">${escHtml(p.title)}</span>`;
      plHtml += `<span class="child-fav-btn" data-cidx="${p.index}" data-ctitle="${escHtml(p.title)}" data-cpath="${escHtml(video.path)}" data-csite="${site}" style="cursor:pointer;font-size:14px;${isChildFav?'color:#e50914':'color:#ccc'};margin:0 4px 0 2px;vertical-align:middle;text-shadow:0 1px 4px rgba(0,0,0,.8)">${isChildFav?'♥':'♡'}</span>`;
    }
    plHtml += '</div></div>';
    document.getElementById('playerTags').insertAdjacentHTML('afterend', plHtml);
  }

  // Auto-switch to child part if opened from favorites
  if (childIdx >= 0) {
    const target = document.querySelector(`.player-part[data-idx="${childIdx}"]`);
    if (target) setTimeout(() => switchPart(target), 100);
  }

  // Load video player
  const hlsUrl = detail.proxiedStreamUrl || detail.streamUrl;
  const useEmbed = detail.playMode === 'embed'
    || (site === 'nguonc' && detail.embedUrl)
    || (site === 'nguonc' && hlsUrl && /streamc\.xyz\/embed\.php/i.test(hlsUrl));
  if (useEmbed) {
    const emb = detail.embedUrl || hlsUrl;
    playerWrap.innerHTML = `<iframe src="${escHtml(emb)}" style="width:100%;height:100%;position:absolute;top:0;left:0;border:none" allowfullscreen allow="autoplay; fullscreen; encrypted-media"></iframe>`;
    const badge = document.createElement('span');
    badge.style.cssText = 'position:absolute;top:8px;right:8px;z-index:10;background:rgba(0,0,0,.7);color:#e50914;font-size:11px;font-weight:600;padding:3px 8px;border-radius:4px';
    badge.textContent = 'EMBED';
    playerWrap.appendChild(badge);
    return;
  }
  if (!hlsUrl) {
    if (site === 'sexbjcam') {
      playerWrap.innerHTML = `<iframe src="https://sexbjcam.com${video.path}" style="width:100%;height:100%;position:absolute;top:0;left:0;border:none" allowfullscreen></iframe>`;
      const badge = document.createElement('span');
      badge.style.cssText = 'position:absolute;top:8px;right:8px;z-index:10;background:rgba(0,0,0,.7);color:#e50914;font-size:11px;font-weight:600;padding:3px 8px;border-radius:4px';
      badge.textContent = 'EMBED';
      playerWrap.appendChild(badge);
    } else if (site === '18tube') {
      playerWrap.innerHTML = `<div style="text-align:center;padding:60px 20px"><p style="color:#e50914;font-size:16px;font-weight:600;margin-bottom:12px">18Tube - Creator Directory</p><p style="color:#999;font-size:13px;margin-bottom:20px">${escHtml(detail.title || video.title)}</p><a href="${escHtml(detail.streamUrl || '')}" target="_blank" style="display:inline-block;background:#e50914;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600">Mở trang creator</a></div>`;
    } else {
      playerWrap.innerHTML = '<div class="loading-screen"><p style="color:#aaa">Khong tim thay nguon phat.</p></div>';
    }
    return;
  }

  currentVideoPath = video.path || '';
  window._playerPoster = detail.thumbnail || video.thumbnail || '';
  window._playerVtt = detail.proxiedVtt || '';
  window._lastStreamUrl = detail.streamUrl || streamUrl || '';
  loadVideoSource(hlsUrl, site, currentVideoPath, playerWrap, {
    poster: window._playerPoster,
    vtt: window._playerVtt,
    streamUrl: window._lastStreamUrl,
    site
  });
}

function parseVttTime(s) {
  const p = String(s || '').trim().split(':');
  if (p.length < 2) return 0;
  const sec = parseFloat(p[p.length - 1]) || 0;
  const min = parseInt(p[p.length - 2], 10) || 0;
  const hr = p.length > 2 ? (parseInt(p[p.length - 3], 10) || 0) : 0;
  return hr * 3600 + min * 60 + sec;
}

function parseVttCues(text) {
  const cues = [];
  if (!text) return cues;
  const blocks = text.replace(/\r/g, '').split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length || lines[0].startsWith('WEBVTT')) continue;
    const timeLine = lines.find(l => l.includes('-->'));
    if (!timeLine) continue;
    const [a, b] = timeLine.split('-->').map(x => x.trim().split(/\s+/)[0]);
    const payload = lines.filter(l => l !== timeLine && !/^\d+$/.test(l)).join('');
    if (!payload) continue;
    const hashIdx = payload.indexOf('#');
    const url = hashIdx >= 0 ? payload.slice(0, hashIdx) : payload;
    let xywh = null;
    if (hashIdx >= 0 && /xywh=/i.test(payload)) {
      const m = payload.match(/xywh=(\d+),(\d+),(\d+),(\d+)/i);
      if (m) xywh = { x: +m[1], y: +m[2], w: +m[3], h: +m[4] };
    }
    cues.push({ start: parseVttTime(a), end: parseVttTime(b), url, xywh });
  }
  return cues;
}

function formatSeekTime(t) {
  t = Math.max(0, Math.floor(t || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function cueAt(cues, t) {
  if (!cues?.length) return null;
  for (const c of cues) {
    if (t >= c.start && t < c.end) return c;
  }
  // nearest earlier
  let best = null;
  for (const c of cues) {
    if (c.start <= t) best = c;
    else break;
  }
  return best || cues[0];
}

function setupSeekPreview(videoEl, playerWrap, opts = {}) {
  const poster = opts.poster || '';
  const vttUrl = opts.vtt || '';
  const streamUrl = opts.streamUrl || '';
  const site = opts.site || currentSite || 'javhdz';
  let cues = [];
  let lastBucket = -1;
  let hoverTimer = null;

  // remove old
  playerWrap.querySelectorAll('.seek-rail, .seek-preview').forEach(n => n.remove());

  const rail = document.createElement('div');
  rail.className = 'seek-rail';
  rail.innerHTML = '<div class="seek-rail-track"><div class="seek-rail-fill" id="seekRailFill"></div></div>';
  const preview = document.createElement('div');
  preview.className = 'seek-preview';
  preview.id = 'seekPreview';
  preview.innerHTML = `
    <div class="seek-preview-img-wrap" id="seekPreviewWrap">
      <img id="seekPreviewImg" alt="" ${poster ? `src="${escHtml(poster)}"` : ''}>
    </div>
    <div class="seek-preview-time" id="seekPreviewTime">00:00</div>`;
  playerWrap.appendChild(rail);
  playerWrap.appendChild(preview);

  const fill = rail.querySelector('#seekRailFill');
  const img = preview.querySelector('#seekPreviewImg');
  const wrap = preview.querySelector('#seekPreviewWrap');
  const timeEl = preview.querySelector('#seekPreviewTime');

  if (vttUrl) {
    fetch(vttUrl).then(r => r.text()).then(t => { cues = parseVttCues(t); }).catch(() => {});
  }

  const showPosterFrame = () => {
    wrap.classList.remove('sprite');
    img.style.cssText = '';
    wrap.style.width = '160px';
    wrap.style.height = '90px';
    if (poster && img.getAttribute('src') !== poster) img.src = poster;
  };

  const applyCue = (t) => {
    const cue = cueAt(cues, t);
    if (cue?.url) {
      if (img.getAttribute('data-cue') !== cue.url + (cue.xywh ? JSON.stringify(cue.xywh) : '')) {
        img.setAttribute('data-cue', cue.url + (cue.xywh ? JSON.stringify(cue.xywh) : ''));
        img.src = cue.url;
      }
      if (cue.xywh) {
        wrap.classList.add('sprite');
        img.style.width = 'auto';
        img.style.height = 'auto';
        img.style.maxWidth = 'none';
        img.style.transform = `translate(${-cue.xywh.x}px,${-cue.xywh.y}px)`;
        wrap.style.width = cue.xywh.w + 'px';
        wrap.style.height = cue.xywh.h + 'px';
      } else {
        wrap.classList.remove('sprite');
        img.style.cssText = '';
        wrap.style.width = '160px';
        wrap.style.height = '90px';
      }
      return;
    }

    // No VTT: request ffmpeg frame for this time bucket (all sites)
    if (!streamUrl) {
      showPosterFrame();
      return;
    }
    const bucket = Math.floor(Math.max(0, t) / 5) * 5;
    if (bucket === lastBucket && img.getAttribute('data-bucket') === String(bucket)) return;
    lastBucket = bucket;
    // keep last frame while loading; first time show poster
    if (!img.getAttribute('data-bucket') && poster) showPosterFrame();
    const api = `/api/thumb-preview?url=${encodeURIComponent(streamUrl)}&t=${bucket}&s=${encodeURIComponent(site)}`;
    // debounce network a bit under rapid mouse move
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      const probe = new Image();
      probe.onload = () => {
        wrap.classList.remove('sprite');
        img.style.cssText = '';
        wrap.style.width = '160px';
        wrap.style.height = '90px';
        img.src = api;
        img.setAttribute('data-bucket', String(bucket));
        img.removeAttribute('data-cue');
      };
      probe.onerror = () => { /* keep poster/last frame */ };
      probe.src = api;
    }, 80);
  };

  const posFromEvent = (e) => {
    const rect = rail.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX - rect.left, 0), rect.width);
    const ratio = rect.width ? x / rect.width : 0;
    const dur = videoEl.duration || 0;
    return { x, ratio, time: dur * ratio };
  };

  rail.addEventListener('mousemove', (e) => {
    const { x, time } = posFromEvent(e);
    preview.classList.add('show');
    preview.style.left = Math.min(Math.max(x, 80), rail.clientWidth - 80) + 'px';
    timeEl.textContent = formatSeekTime(time);
    applyCue(time);
  });
  rail.addEventListener('mouseleave', () => {
    preview.classList.remove('show');
    clearTimeout(hoverTimer);
  });
  rail.addEventListener('click', (e) => {
    const { time } = posFromEvent(e);
    if (Number.isFinite(videoEl.duration) && videoEl.duration > 0) {
      videoEl.currentTime = time;
    }
  });

  const syncFill = () => {
    if (!fill || !videoEl.duration) return;
    fill.style.width = ((videoEl.currentTime / videoEl.duration) * 100) + '%';
  };
  videoEl.addEventListener('timeupdate', syncFill);
  videoEl.addEventListener('loadedmetadata', syncFill);
  videoEl.addEventListener('seeked', syncFill);
}

function loadVideoSource(url, site, path, playerWrap, opts = {}) {
  const poster = opts.poster || window._playerPoster || '';
  const vtt = opts.vtt || window._playerVtt || '';
  const streamUrl = opts.streamUrl || window._lastStreamUrl || '';
  const posterAttr = poster ? ` poster="${escHtml(poster)}"` : '';
  playerWrap.innerHTML = `<video id="videoPlayer" controls autoplay playsinline${posterAttr}></video>`;
  const videoEl = document.getElementById('videoPlayer');
  setupSeekPreview(videoEl, playerWrap, { poster, vtt, streamUrl, site });

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
    const hls = new Hls({ enableWorker: true, lowLatencyMode: false, backbufferLength: 300, maxBufferLength: 600, maxMaxBufferLength: 1200, startLevel: -1, maxBufferSize: 500 * 1000 * 1000 });
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
  const wrap = document.getElementById('playerWrap');
  if (/streamc\.xyz\/embed\.php/i.test(url) || currentSite === 'nguonc' && !/\.m3u8|proxy\/pl/i.test(url)) {
    wrap.innerHTML = `<iframe src="${escHtml(url)}" style="width:100%;height:100%;position:absolute;top:0;left:0;border:none" allowfullscreen allow="autoplay; fullscreen; encrypted-media"></iframe>`;
    return;
  }
  loadVideoSource(url, currentSite, currentVideoPath, wrap, {
    poster: window._playerPoster || '',
    vtt: window._playerVtt || '',
    streamUrl: window._lastStreamUrl || el.dataset.stream || '',
    site: currentSite
  });
}

function showClipDialog() {
  const currentStreamUrl = document.querySelector('.dl-cmd-row pre')?.textContent?.match(/'([^']+)'/)?.[1] || '';
  const video = document.getElementById('videoPlayer');
  const now = video ? Math.floor(video.currentTime) : 0;
  const h = String(Math.floor(now / 3600)).padStart(2, '0');
  const m = String(Math.floor((now % 3600) / 60)).padStart(2, '0');
  const s = String(now % 60).padStart(2, '0');
  const startStr = h + ':' + m + ':' + s;

  // Remove old dialog
  const old = document.getElementById('clipDialog');
  if (old) old.remove();

  const div = document.createElement('div');
  div.id = 'clipDialog';
  div.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:#1a1a1a;padding:20px;border-radius:12px;z-index:300;width:320px;box-shadow:0 8px 40px rgba(0,0,0,.6)';
  div.innerHTML = `<div style="font-size:14px;font-weight:700;color:#fff;margin-bottom:12px">✂ Cắt video</div>
    <label style="font-size:12px;color:#888;display:block;margin-bottom:4px">Bắt đầu (HH:MM:SS)</label>
    <input id="clipStart" value="${startStr}" style="width:100%;background:#0d0d0d;border:1px solid #333;color:#fff;padding:6px 10px;border-radius:6px;margin-bottom:10px;font-size:13px">
    <label style="font-size:12px;color:#888;display:block;margin-bottom:4px">Thời lượng (giây)</label>
    <input id="clipDur" value="30" style="width:100%;background:#0d0d0d;border:1px solid #333;color:#fff;padding:6px 10px;border-radius:6px;margin-bottom:14px;font-size:13px">
    <div style="display:flex;gap:8px">
      <button onclick="doClip()" style="flex:1;background:#e50914;color:#fff;border:none;padding:8px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600">✂ Cắt</button>
      <button onclick="this.closest('#clipDialog').remove()" style="flex:1;background:var(--surface2);color:#fff;border:none;padding:8px;border-radius:6px;cursor:pointer;font-size:13px">Hủy</button>
    </div>
    <div id="clipResult" style="margin-top:10px;font-size:12px;color:#0f0;display:none"></div>`;
  document.querySelector('.player-container').appendChild(div);
}

async function doClip() {
  const start = document.getElementById('clipStart')?.value || '00:00:00';
  const dur = document.getElementById('clipDur')?.value || '30';
  // Get stream URL from current context
  const streamUrl = window._lastStreamUrl || '';
  const site = window._lastSite || '';
  if (!streamUrl) { alert('Không tìm thấy URL video'); return; }
  const btn = document.querySelector('#clipDialog button');
  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
  const resultDiv = document.getElementById('clipResult');
  try {
    const r = await fetch('/api/clip?pl=' + encodeURIComponent(streamUrl) + '&s=' + site + '&start=' + encodeURIComponent(start) + '&dur=' + encodeURIComponent(dur));
    const d = await r.json();
    if (d.success && resultDiv) {
      resultDiv.style.display = 'block';
      resultDiv.innerHTML = '✅ Xong! <a href="' + d.url + '" target="_blank" style="color:#0f0">Mở clip</a>';
    } else if (resultDiv) {
      resultDiv.style.display = 'block';
      resultDiv.innerHTML = '❌ ' + (d.error || 'Lỗi');
    }
  } catch(e) {
    if (resultDiv) { resultDiv.style.display = 'block'; resultDiv.innerHTML = '❌ ' + e.message; }
  }
  if (btn) { btn.textContent = '✂ Cắt'; btn.disabled = false; }
}
 {
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

function filterByTag(slug, type) {
  closePlayer();
  if (currentSite === 'javtrailers' && type === 'cast') {
    document.getElementById('searchInput').value = slug.replace(/-/g, ' ');
    currentSearch = slug.replace(/-/g, ' '); currentCategory = ''; currentPage = 1;
  } else {
    currentCategory = slug; currentPage = 1; currentSearch = '';
    document.getElementById('searchInput').value = '';
  }
  loadVideos();
}

async function clearVideoCache() {
  const pl = window._lastStreamUrl;
  if (!pl) return;
  const btn = document.activeElement;
  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
  try {
    const r = await fetch('/api/clear-cache?pl=' + encodeURIComponent(pl));
    const d = await r.json();
    if (d.success) {
      alert('✅ Đã xoá ' + d.deleted + ' segment (' + (d.freed/1e6).toFixed(1) + 'MB)');
    } else {
      alert('❌ ' + (d.error || 'Lỗi'));
    }
  } catch(e) { alert('❌ ' + e.message); }
  if (btn) { btn.textContent = '🗑 Cache'; btn.disabled = false; }
}

function nextRandom() {
  if (!allVideos.length) return;
  // Loại bỏ video hiện tại
  const currentPath = window._lastVideoPath || '';
  const others = allVideos.filter(v => v.path !== currentPath);
  if (!others.length) return;
  const pick = others[Math.floor(Math.random() * others.length)];
  if (pick) openPlayer(pick, pick._site || currentSite);
}

function nextRandomFav() {
  const favs = getFavorites();
  if (!favs.length) return;
  const currentKey = (window._lastSite || currentSite) + ':' + (window._lastVideoPath || '');
  const others = favs.filter(f => f.key !== currentKey);
  if (!others.length) { playRandomFav(); return; }
  const pick = others[Math.floor(Math.random() * others.length)];
  if (pick) openPlayer({ title: pick.title, path: pick.path, thumbnail: pick.thumbnail }, pick.site);
}

function playRandomVideo() {
  if (!allVideos.length) return;
  const pick = allVideos[Math.floor(Math.random() * allVideos.length)];
  if (pick) openPlayer(pick, pick._site || currentSite);
}

function playRandomFav() {
  const favs = getFavorites();
  if (!favs.length) return;
  const pick = favs[Math.floor(Math.random() * favs.length)];
  if (pick) openPlayer({ title: pick.title, path: pick.path, thumbnail: pick.thumbnail }, pick.site);
}

function closePlayer() {
  if (currentHls) { try { currentHls.destroy(); } catch {} currentHls = null; }
  const overlay = document.getElementById('playerOverlay');
  const player = document.getElementById('videoPlayer');
  if (player) { player.pause(); player.removeAttribute('src'); player.load(); player.remove(); }
  const iframe = document.querySelector('#playerWrap iframe');
  if (iframe) { iframe.src = ''; iframe.remove(); }
  document.getElementById('playerWrap').innerHTML = '';
  overlay.classList.remove('open');
}

function startAutoPlay() {
  if (autoPlayActive) {
    autoPlayActive = false;
    if (autoPlayTimer) { clearTimeout(autoPlayTimer); autoPlayTimer = null; }
    const btn = document.getElementById('autoPlayBtn');
    if (btn) { btn.textContent = '🎲 Tự động'; btn.style.background = 'var(--surface2)'; }
    return;
  }
  autoPlayActive = true;
  const btn = document.getElementById('autoPlayBtn');
  if (btn) { btn.textContent = '⏹ Dừng'; btn.style.background = '#e50914'; }
  playRandomFromList();
}

function playRandomFromList() {
  if (!autoPlayActive) return;
  if (!allVideos.length) { autoPlayActive = false; const b = document.getElementById('autoPlayBtn'); if (b) b.textContent = '🎲 Tự động'; return; }
  const pick = allVideos[Math.floor(Math.random() * allVideos.length)];
  if (pick) openPlayer(pick, pick._site || currentSite);
  if (autoPlayTimer) { clearTimeout(autoPlayTimer); }
  autoPlayTimer = setTimeout(() => {
    if (!autoPlayActive) return;
    const video = document.getElementById('videoPlayer');
    if (video && video.duration && video.currentTime > 0 && video.currentTime >= video.duration - 2) {
      setTimeout(playRandomFromList, 1500);
    } else if (autoPlayActive) {
      autoPlayTimer = setTimeout(playRandomFromList, 5000);
    }
  }, 5000);
}

function downloadCached(encodedUrl) {
  const url = decodeURIComponent(encodedUrl);
  if (!url) return;
  const btn = document.querySelector('.dl-btn');
  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
  const dlSite = btn ? (btn.dataset.site || currentSite) : currentSite;

  // Lấy stream URL gốc + tạo lệnh yt-dlp
  const cmd = `yt-dlp --downloader ffmpeg --downloader-args "ffmpeg_i:-threads 4" --referer "https://${dlSite === 'javhdz' ? 'javhdz.ws' : dlSite === 'vlxx' ? 'vlxx.moi' : dlSite === 'quatvn' ? 'quatvn.moi' : dlSite === 'viet69' ? 'viet69.be' : dlSite === 'pornhub' ? 'www.pornhub.com' : dlSite === 'kkphim' ? 'kkphim.com' : dlSite === 'nguonc' ? 'phim.nguonc.com' : 'sexbjcam.com'}/" -o "video.mp4" '${url}'`;
  
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

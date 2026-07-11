const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const crypto = require('crypto');
const dns = require('dns');

const BLOCKED_HOSTS = ['javtrailers.com', 'javtiful.com'];
const SOCKS5_PROXY = 'socks5://127.0.0.1:1080';
const FAVORITES_FILE = path.join(__dirname, 'favorites.json');

// ============================================================
// Favorites (server-side, sync across devices)
// ============================================================
function loadFavorites() {
  try { return JSON.parse(fs.readFileSync(FAVORITES_FILE, 'utf8')); } catch { return []; }
}
function saveFavorites(favs) {
  fs.writeFileSync(FAVORITES_FILE, JSON.stringify(favs, null, 2));
}

function needsProxy(url) {
  try { const host = new URL(url).hostname; return BLOCKED_HOSTS.some(b => host === b || host.endsWith('.' + b)); }
  catch { return false; }
}

// ============================================================
// DNS bypass
// ============================================================
try {
  dns.setServers(['1.1.1.1', '1.0.0.1', '8.8.8.8', '8.8.4.4']);
  console.log('[DNS] → Cloudflare + Google');
} catch (e) {
  console.warn('[DNS] Failed:', e.message);
}

const PORT = process.env.PORT || 3000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ============================================================
// KeepAlive Agent — QUAN TRỌNG: vượt Cloudflare CDN
// ============================================================
const AGENTS = {
  http: new http.Agent({ keepAlive: true, maxSockets: 64 }),
  https: new https.Agent({ keepAlive: true, maxSockets: 64, rejectUnauthorized: false }),
};

// ============================================================
// DISK CACHE
// ============================================================
const CACHE_DIR = path.join(__dirname, '.video_cache');
const MAX_DISK_CACHE = 20 * 1024 * 1024 * 1024;
const SEGMENT_TTL = 3 * 60 * 60 * 1000;
const PLAYLIST_TTL = 5 * 60 * 1000;
const PREFETCH_CONCURRENCY = 6;

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

const playlistCache = new Map();
const fetchPromises = new Map();
const detailCache = new Map(); // 5 min cache cho video-detail

function parseDuration(durStr) {
  if (!durStr) return 0;
  const parts = durStr.trim().split(':');
  if (parts.length === 3) return parseInt(parts[0]) * 60 + parseInt(parts[1]);
  if (parts.length === 2) return parseInt(parts[0]);
  return parseInt(parts[0]) || 0;
}

function cachePath(url) {
  return path.join(CACHE_DIR, crypto.createHash('md5').update(url).digest('hex') + '.ts');
}

function cacheGet(url) {
  const fp = cachePath(url);
  if (fs.existsSync(fp)) {
    try { fs.utimesSync(fp, new Date(), new Date()); return fs.readFileSync(fp); } catch { return null; }
  }
  return null;
}

function cleanLRU(needed) {
  try {
    const files = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.ts')).map(f => {
      const fp = path.join(CACHE_DIR, f);
      const s = fs.statSync(fp);
      return { path: fp, size: s.size, atime: s.atimeMs };
    });
    let total = files.reduce((a, f) => a + f.size, 0);
    if (total + needed <= MAX_DISK_CACHE) return;
    files.sort((a, b) => a.atime - b.atime);
    let del = 0;
    for (const f of files) {
      if (total + needed <= MAX_DISK_CACHE) break;
      try { fs.unlinkSync(f.path); total -= f.size; del++; } catch {}
    }
    if (del) console.log(`[CACHE] LRU evicted ${del} files (${(total/1e9).toFixed(2)}GB)`);
  } catch {}
}

function cacheSet(url, buf) {
  const fp = cachePath(url);
  if (fs.existsSync(fp)) return;
  cleanLRU(buf.length);
  try { fs.writeFileSync(fp, buf); } catch {}
}

// ============================================================
// FETCH với KeepAlive Agent — vượt Cloudflare. Dùng SOCKS5 cho site bị chặn.
// ============================================================
function fetchText(url, referer, extraHeaders = {}) {
  // Nếu host bị chặn → dùng curl --socks5 ngay
  if (needsProxy(url)) {
    return new Promise((resolve, reject) => {
      try {
        const { execSync } = require('child_process');
        const escapedUrl = url.replace(/'/g, "'\\''");
        const cookieOpt = extraHeaders['Cookie'] ? ` -b '${extraHeaders['Cookie'].replace(/'/g, "'\\''")}'` : '';
        const cmd = `curl -sL --max-time 30 --socks5 '${SOCKS5_PROXY}' -A '${UA.replace(/'/g, "'\\''")}'${cookieOpt} '${escapedUrl}'`;
        const out = execSync(cmd, { encoding: 'utf8', timeout: 35000 });
        if (out && out.length > 100) return resolve(out);
        reject(new Error('Empty response via proxy'));
      } catch (e) { reject(e); }
    });
  }
  return new Promise((resolve, reject) => {
    const doFetch = (u, redirects = 0) => {
      if (redirects > 5) return reject(new Error('Too many redirects'));
      const isHttps = u.startsWith('https:');
      const mod = isHttps ? https : http;
      const opts = {
        headers: {
          'User-Agent': UA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8',
          ...(referer ? { 'Referer': referer, 'Origin': new URL(referer).origin } : {}),
          ...extraHeaders
        },
        agent: isHttps ? AGENTS.https : AGENTS.http,
        timeout: 20000,
        rejectUnauthorized: false
      };
      const req = mod.get(u, opts, resp => {
        // Follow redirect
        if (resp.statusCode > 299 && resp.statusCode < 400 && resp.headers.location) {
          resp.resume();
          const loc = resp.headers.location.startsWith('http')
            ? resp.headers.location
            : new URL(resp.headers.location, u).href;
          return doFetch(loc, redirects + 1);
        }
        if (resp.statusCode < 200 || resp.statusCode > 299) {
          resp.resume();
          // Fallback: dùng curl cho 403 (Cloudflare TLS fingerprint)
          if (resp.statusCode === 403) {
            console.log(`[CURL FALLBACK] ${u.slice(0, 60)}`);
            try {
              const { execSync } = require('child_process');
              const escapedUrl = u.replace(/'/g, "'\\''");
              const out = execSync(`curl -sL -A '${UA.replace(/'/g, "'\\''")}' --max-time 15 '${escapedUrl}'`, {
                encoding: 'utf8', timeout: 20000
              });
              if (out && out.length > 100) return resolve(out);
            } catch {}
          }
          return reject(new Error(`HTTP ${resp.statusCode}`));
        }
        const chunks = [];
        resp.on('data', c => chunks.push(c));
        resp.on('end', () => resolve(Buffer.concat(chunks).toString()));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    };
    doFetch(url);
  });
}
function fetchBuffer(url, referer) {
  // Nếu host bị chặn → dùng curl --socks5
  if (needsProxy(url)) {
    return new Promise((resolve, reject) => {
      try {
        const { execSync } = require('child_process');
        const escapedUrl = url.replace(/'/g, "'\\''");
        const cmd = `curl -sfL --max-time 30 --socks5 '${SOCKS5_PROXY}' -A '${UA.replace(/'/g, "'\\''")}' '${escapedUrl}'`;
        const buf = execSync(cmd, { encoding: 'buffer', timeout: 35000, maxBuffer: 500 * 1024 * 1024 });
        if (buf && buf.length > 100) return resolve(buf);
        reject(new Error('Empty response via proxy'));
      } catch (e) { reject(e); }
    });
  }
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https:');
    const mod = isHttps ? https : http;
    const opts = {
      headers: {
        'User-Agent': UA,
        'Accept': '*/*',
        ...(referer ? { 'Referer': referer, 'Origin': new URL(referer).origin } : {}),
      },
      agent: isHttps ? AGENTS.https : AGENTS.http,
      timeout: 20000,
      rejectUnauthorized: false
    };
    const req = mod.get(url, opts, resp => {
      if (resp.statusCode > 299 && resp.statusCode < 400 && resp.headers.location) {
        resp.resume();
        const loc = resp.headers.location.startsWith('http')
          ? resp.headers.location
          : new URL(resp.headers.location, url).href;
        return fetchBuffer(loc, referer).then(resolve).catch(reject);
      }
      if (resp.statusCode < 200 || resp.statusCode > 299) {
        resp.resume();
        return reject(new Error(`HTTP ${resp.statusCode}`));
      }
      const chunks = [];
      resp.on('data', c => chunks.push(c));
      resp.on('end', () => {
        let buf = Buffer.concat(chunks);
        // Strip PNG disguise
        if (buf.length > 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
          for (let i = 0; i < Math.min(buf.length - 376, 2000); i++) {
            if (buf[i] === 0x47 && buf[i+188] === 0x47 && buf[i+376] === 0x47) {
              buf = buf.subarray(i); break;
            }
          }
        }
        resolve(buf);
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function fetchAndCacheSegment(url, host) {
  const cached = cacheGet(url);
  if (cached) return cached;
  if (fetchPromises.has(url)) return fetchPromises.get(url);

  const p = (async () => {
    try {
      const buf = await fetchBuffer(url, host + '/');
      if (buf && buf.length > 100) { cacheSet(url, buf); fetchPromises.delete(url); return buf; }
    } catch {}
    try {
      const { execSync } = require('child_process');
      const proxyFlag = needsProxy(url) ? ` --socks5 '${SOCKS5_PROXY}'` : '';
      const buf = execSync("curl -sfL -A 'Mozilla/5.0' --max-time 20" + proxyFlag + " '" + url.replace(/'/g, "'\\''") + "'", { encoding: 'buffer', timeout: 25000, maxBuffer: 500 * 1024 * 1024 });
      if (buf && buf.length > 100) { cacheSet(url, buf); fetchPromises.delete(url); return buf; }
    } catch {}
    fetchPromises.delete(url);
  })();
  fetchPromises.set(url, p);
  return p;
}

async function getPlaylistSegments(plUrl, host) {
  const cached = playlistCache.get(plUrl);
  if (cached && Date.now() - cached.ts < PLAYLIST_TTL) return cached.urls;
  try {
    const text = await fetchText(plUrl, host + '/');
    const base = plUrl.substring(0, plUrl.lastIndexOf('/') + 1);
    const urls = [];
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      urls.push(t.startsWith('http') ? t : (t.startsWith('/') ? new URL(plUrl).origin + t : base + t));
    }
    playlistCache.set(plUrl, { urls, rawText: text, ts: Date.now() });
    return urls;
  } catch { return []; }
}

let activePlUrl = '';

function prefetchToEnd(allUrls, idx, host, plUrl) {
  activePlUrl = plUrl;
  const todo = [];
  for (let i = idx; i < allUrls.length; i++) {
    const u = allUrls[i];
    if (!fs.existsSync(cachePath(u)) && !fetchPromises.has(u)) todo.push(u);
  }
  if (!todo.length) return;
  (async () => {
    for (let i = 0; i < todo.length; i += PREFETCH_CONCURRENCY) {
      if (activePlUrl !== plUrl) break;
      await Promise.all(todo.slice(i, i + PREFETCH_CONCURRENCY).map(u => fetchAndCacheSegment(u, host).catch(() => {})));
    }
  })();
}

// ============================================================
// SITES CONFIG
// ============================================================
const SITES = {
  javhdz: { base: 'https://javhdz.ws' },
  vlxx: { base: 'https://vlxx.moi' },
  quatvn: { base: 'https://quatvn.mom' },
  sexbjcam: { base: 'https://sexbjcam.com' },
  javtrailers: { base: 'https://javtrailers.com' },
  javtiful: { base: 'https://javtiful.com' },
  '18tube': { base: 'https://18tube.my' },
};

function getHost(site) { return SITES[site]?.base || SITES.javhdz.base; }

// ============================================================
// HELPERS
// ============================================================
function sendJSON(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': '*'
  });
  res.end(JSON.stringify(data));
}

function serveStatic(res, fp) {
  const mime = {
    '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon', '.webp': 'image/webp'
  };
  const ct = mime[path.extname(fp).toLowerCase()] || 'application/octet-stream';
  fs.readFile(fp, (err, data) => {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain' });
      res.end(err.code === 'ENOENT' ? 'Not found' : 'Server error');
    } else {
      res.writeHead(200, { 'Content-Type': ct, 'Access-Control-Allow-Origin': '*' });
      res.end(data);
    }
  });
}

function deobfuscatePacked(html) {
  try {
    const s = html.indexOf("eval(function(p,a,c,k,e,d){");
    if (s === -1) return null;
    const code = html.substring(s);
    const end = code.indexOf("}(");
    if (end === -1) return null;
    const call = code.substring(end + 2);
    let i = 1, p = '';
    while (i < call.length) {
      if (call[i] === "'" && call[i+1] === ",") { i += 2; break; }
      if (call[i] === "\\" && call[i+1] === "'") { p += "'"; i += 2; continue; }
      p += call[i]; i++;
    }
    const m = call.substring(i).match(/^(\d+),(\d+),'([^']+)'\.split/);
    if (!m) return null;
    const a = parseInt(m[1]), c = parseInt(m[2]);
    const k = m[3].split('|');
    let r = p;
    for (let j = 0; j < c; j++) {
      if (k[j]) r = r.replace(new RegExp("\\b" + j.toString(a) + "\\b", "g"), k[j]);
    }
    return r;
  } catch { return null; }
}

// ============================================================
// HTTP SERVER
// ============================================================
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': '*', 'Access-Control-Max-Age': '86400' });
    return res.end();
  }

  const parsed = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsed.pathname;
  let site = parsed.searchParams.get('site') || parsed.searchParams.get('s') || 'javhdz';
  if (!SITES[site]) site = 'javhdz';
  const HOST = getHost(site);

  try {
    // ==================== API: DANH SÁCH VIDEO ====================
    if (pathname === '/api/videos') {
      const page = parsed.searchParams.get('page') || 1;
      const category = parsed.searchParams.get('category') || '';
      const search = parsed.searchParams.get('search') || '';
      let url = HOST;

      if (site === 'vlxx') {
        if (search) {
          url = `${HOST}/search/${search.replace(/\s+/g, '-')}/`;
          if (page > 1) url += `${page}/`;
        } else if (category) {
          url = `${HOST}/${category}/`;
          if (page > 1) url += `${page}/`;
        } else {
          url = page > 1 ? `${HOST}/new/${page}/` : `${HOST}/`;
        }
      } else if (site === 'quatvn') {
        if (search) {
          url = `${HOST}/?s=${encodeURIComponent(search)}`;
          if (page > 1) url = `${HOST}/page/${page}/?s=${encodeURIComponent(search)}`;
        } else if (category) {
          url = `${HOST}/${category}/`;
          if (page > 1) url += `page/${page}/`;
        } else {
          url = page > 1 ? `${HOST}/page/${page}/` : `${HOST}/`;
        }
      } else if (site === 'sexbjcam') {
        if (search) {
          url = `${HOST}/?s=${encodeURIComponent(search)}`;
          if (page > 1) url = `${HOST}/page/${page}/?s=${encodeURIComponent(search)}`;
        } else if (category) {
          url = `${HOST}/category/${category}/`;
          if (page > 1) url += `page/${page}/`;
        } else {
          url = page > 1 ? `${HOST}/page/${page}/` : `${HOST}/`;
        }
      } else if (site === 'javtrailers') {
        if (search) {
          // Thử tìm video theo code/title trước, fallback cast
          const searchUrl = `${HOST}/videos?q=${encodeURIComponent(search)}`;
          if (page > 1) url = `${searchUrl}&page=${page}`;
          try {
            const testHtml = await fetchText(page > 1 ? `${searchUrl}&page=${page}` : searchUrl, HOST + '/');
            if (testHtml.includes('vid-title')) { url = page > 1 ? `${searchUrl}&page=${page}` : searchUrl; }
            else throw new Error('No results');
          } catch {
            // Fallback: tìm diễn viên qua /casts/{slug}
            const castSlug = search.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
            const parts = castSlug.split('-');
            const slugs = [castSlug];
            if (parts.length > 1 && parts[1] !== parts[0]) {
              slugs.push([...parts.slice(1), parts[0]].join('-'));
            }
            for (const slug of slugs) {
              url = `${HOST}/casts/${slug}`;
              if (page > 1) url += `?page=${page}`;
              try {
                const testHtml = await fetchText(url, HOST + '/');
                if (testHtml.includes('vid-title')) break;
              } catch { continue; }
            }
          }
        } else if (category) {
          // Studio slug luôn dùng /studios/{slug}
          if (['trending','newest'].includes(category)) {
            url = `${HOST}/videos?category=${category}`;
            if (page > 1) url += `&page=${page}`;
          } else {
            // Thử cast page trước, fallback studio
            const tryUrl = `${HOST}/casts/${category}` + (page > 1 ? `?page=${page}` : '');
            let tryHtml;
            try { tryHtml = await fetchText(tryUrl, HOST + '/'); } catch {}
            if (tryHtml && tryHtml.includes('vid-title')) {
              url = tryUrl;
            } else {
              url = `${HOST}/studios/${category}`;
              if (page > 1) url += `?page=${page}`;
            }
          }
        } else {
          url = page > 1 ? `${HOST}/videos?page=${page}` : `${HOST}/`;
        }
      } else if (site === '18tube') {
        if (search) {
          url = `${HOST}/?s=${encodeURIComponent(search)}`;
          if (page > 1) url += `&page=${page}`;
        } else {
          url = page > 1 ? `${HOST}/page/${page}/` : `${HOST}/`;
        }
      } else if (site === 'javtiful') {
        if (parsed.searchParams.get('url')) {
          url = parsed.searchParams.get('url');
        } else if (category === 'feed') {
          url = `${HOST}/en/collections/subscriptions`;
        } else if (search) {
          url = `${HOST}/search?q=${encodeURIComponent(search)}`;
          if (page > 1) url += `&page=${page}`;
        } else if (category) {
          url = `${HOST}/zh/videos?category=${category}`;
          if (page > 1) url += `&page=${page}`;
        } else {
          url = page > 1 ? `${HOST}/zh/censored?page=${page}` : `${HOST}/zh/censored`;
        }
      } else {
        if (search) {
          url = `${HOST}/search/${encodeURIComponent(search)}/`;
          if (page > 1) url += `page/${page}/`;
        } else if (category) {
          url = category === 'trending'
            ? (page > 1 ? `${HOST}/trending/page/${page}/` : `${HOST}/trending/`)
            : `${HOST}/category/${category}/` + (page > 1 ? `page/${page}/` : '');
        } else {
          url = page > 1 ? `${HOST}/video/page/${page}/` : `${HOST}/video/`;
        }
      }

      console.log(`[SCRAPE] ${url}`);
      // JavTiful: pass auth cookies để search/listing hoạt động
      let fetchHeaders = {};
      if (site === 'javtiful') {
        try {
          const c = fs.readFileSync(path.join(__dirname, '.javtiful_cookies.txt'), 'utf8').trim();
          if (c) fetchHeaders['Cookie'] = c;
        } catch {}
      }
      const html = await fetchText(url, HOST + '/', fetchHeaders);
      const videos = [];
      let categories = [];

      if (site === 'vlxx') {
        const re = /<div[^>]*class="video-item">[\s\S]*?<a title="([^"]+)" href="([^"]+)"[\s\S]*?data-original="([^"]+)"[\s\S]*?(?:<div class="ribbon">([^<]+)<\/div>)?/g;
        let m; while ((m = re.exec(html))) videos.push({ title: m[1], path: m[2], thumbnail: m[3], views: m[4] || 'N/A' });
        categories = [
          { slug: 'jav', name: 'JAV' }, { slug: 'phim-sex-hay', name: 'Phim sex hay' },
          { slug: 'vietsub', name: 'Vietsub' }, { slug: 'khong-che', name: 'Không che' },
          { slug: 'hoc-sinh', name: 'Học sinh' }, { slug: 'vung-trom', name: 'Vụng trộm' },
          { slug: 'cap-3', name: 'Cấp 3' }, { slug: 'chau-au', name: 'Mỹ - Châu Âu' },
          { slug: 'xvideos', name: 'XVIDEOS' }, { slug: 'xnxx', name: 'XNXX' }
        ];
      } else if (site === 'quatvn') {
        // QuatVN.mom: g1-mega entry-title headings + g1-frame thumbnails
        const re = /<h2[^>]*class="[^"]*entry-title[^"]*"[^>]*>\s*<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<img[^>]*(?:data-src|src)="([^"]+\.(?:webp|jpg|png))"[^>]*>/g;
        let m; while ((m = re.exec(html))) {
          let p = ''; try { p = m[1].startsWith('http') ? new URL(m[1]).pathname : m[1]; } catch { p = m[1]; }
          videos.push({ title: m[2].replace(/<[^>]+>/g, '').trim(), path: p, thumbnail: m[3], views: 'N/A' });
        }
        categories = [
          { slug: 'phim-sex-vn', name: 'Việt Nam' }, { slug: 'phim-sex-trung-quoc', name: 'Trung Quốc' },
          { slug: 'phim-sex-han-quoc', name: 'Hàn Quốc' }, { slug: 'phim-sex-us', name: 'US-UK' },
          { slug: 'phim-sex-thai-lan', name: 'Thái Lan' }, { slug: 'phim-sex-nhat-ban', name: 'Nhật Bản' },
          { slug: 'phim-sex-malaysia', name: 'Malaysia' }
        ];
      } else if (site === 'sexbjcam') {
        const blocked = ['jinricp', 'mscrew33'];
        const parse = (h) => {
          const out = [];
          const arts = h.match(/<article[\s\S]*?<\/article>/g) || [];
          for (const a of arts) {
            // Thumbnail từ data-main-thumb
            const thumb = a.match(/data-main-thumb="([^"]+)"/)?.[1]
                      || a.match(/src="([^"]+\.(?:jpg|jpeg|png|webp))"/i)?.[1]
                      || '';
            // Link từ <a href=...> đầu tiên
            const hrefM = a.match(/<a\s+href="([^"]+)"[^>]*>/i);
            if (!hrefM) continue;
            let p = '';
            try { p = hrefM[1].startsWith('http') ? new URL(hrefM[1]).pathname : hrefM[1]; } catch { p = hrefM[1]; }
            // Title từ entry-title hoặc thẻ <h2>/<h3>
            const titleM = a.match(/class="[^"]*entry-title[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
                        || a.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/i)
                        || a.match(/alt="([^"]+)"/i);
            let t = titleM ? titleM[1].replace(/<[^>]+>/g, '').trim() : '';
            if (!t || blocked.some(k => t.toLowerCase().includes(k))) continue;
            out.push({
              title: t,
              path: p,
              thumbnail: thumb.includes('sexbjcam.com') ? '/api/proxy/image?url=' + encodeURIComponent(thumb) + '&site=sexbjcam' : thumb,
              views: 'N/A'
            });
          }
          return out;
        };
        videos.push(...parse(html));
        if (videos.length > 500) videos.length = 500;
        categories = [{ slug: 'kbj', name: 'KBJ' }, { slug: 'bj', name: 'BJ' }, { slug: 'webcam', name: 'Webcam' }];
      } else if (site === 'javtrailers') {
        const re = /<a\s+href="\/video\/([^"]+)"\s+class="video-link"\s+title="([^"]+)"[\s\S]*?<img[^>]*(?:data-src|src)="([^"]+)"[\s\S]*?duration-badge[^>]*>([^<]+)<\/span>[\s\S]*?<p class="card-text title mb-0 vid-title">[^<]*<\/p>\s*<small[^>]*>([^<]*)<\/small>/g;
        let m; while ((m = re.exec(html))) {
          const t = m[2];
          const dur = parseDuration(m[4]);
          // Lọc compilation + video dài
          if (/\b(Best|Collection|Compilation)\b/i.test(t)) continue;
          if (dur >= 240) continue;
          videos.push({ title: t, path: '/video/' + m[1], thumbnail: m[3], views: m[5] || 'N/A' });
        }
        categories = [{ slug: 'trending', name: 'Xu hướng' }, { slug: 'newest', name: 'Mới nhất' }];
        // Studio từ dropdown
        const stuRe = /href="\/studios\/([^"]+)"[^>]*class="dropdown-item"[^>]*>([^<]+)<\/a>/g;
        let sm; while ((sm = stuRe.exec(html))) {
          categories.push({ slug: sm[1], name: sm[2].trim() });
        }
        // Studio đặc biệt không có trong dropdown
        const extraStudios = [{ slug: 'das', name: 'DAS' }];
        for (const es of extraStudios) {
          if (!categories.find(c => c.slug === es.slug)) categories.push(es);
        }
      } else if (site === 'javtiful') {
        // Nếu có url tùy chỉnh (vd: subscriptions), thử fetch với auth cookie trước
        let javHtml = html;
        if (parsed.searchParams.get('url')) {
          const javCookiesPath = path.join(__dirname, '.javtiful_cookies.txt');
          try {
            const cookieStr = fs.readFileSync(javCookiesPath, 'utf8').trim();
            if (cookieStr) {
              const authHtml = await fetchText(url, HOST + '/', { 'Cookie': cookieStr });
              if (authHtml && authHtml.length > 1000 && !authHtml.includes('login')) javHtml = authHtml;
            }
          } catch {}
        }
        // Phần tử card + title nằm rời nhau trong HTML, dùng index pairing
        const parseVids = (h) => {
          const out = [];
          const thumbs = [...h.matchAll(/<a\s+href="(\/(?:zh\/)?video\/\d+\/[^"]+)"\s+class="front-video-thumb"[^>]*>[\s\S]*?data-front-lazy-src="([^"]+)"[\s\S]*?class="front-duration-tag"[^>]*>([^<]+)<\/span>/g)];
          const titles = [...h.matchAll(/<a\s+href="(\/(?:zh\/)?video\/\d+\/[^"]+)"\s+class="front-video-title"[^>]*>([^<]+)<\/a>/g)];
          for (let i = 0; i < Math.min(thumbs.length, titles.length); i++) {
            out.push({
              title: titles[i][2],
              path: thumbs[i][1],
              thumbnail: thumbs[i][2].startsWith('http') ? thumbs[i][2] : 'https://javtiful.com' + thumbs[i][2],
              views: thumbs[i][3] || 'N/A'
            });
          }
          return out;
        };
        videos.length = 0; videos.push(...parseVids(javHtml));
        categories = [{ slug: 'newest', name: 'Mới nhất' }, { slug: 'trending', name: 'Xu hướng' }, { slug: 'feed', name: '📺 Feed' }];
      } else if (site === '18tube') {
        const parseCards = (h) => {
          const out = [];
          const cards = [...h.matchAll(/<article[^>]*class="[^"]*post-item[^"]*creator-card[^"]*"[^>]*data-post-id="(\d+)"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*title="([^"]*)"[\s\S]*?<img[^>]*class="avatar-image"[^>]*src="([^"]+)"[\s\S]*?<h3[^>]*class="[^"]*post-card-title[^"]*"[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<span class="username">([^<]*)<\/span>[\s\S]*?<span class="views">([\s\S]*?)<\/span>/g)];
          for (const m of cards) {
            out.push({
              title: (m[5] || '').trim(),
              path: m[2].replace('https://18tube.my', ''),
              thumbnail: m[4],
              views: (m[7] || '').replace(/<[^>]+>/g, '').trim()
            });
          }
          return out;
        };
        videos.push(...parseCards(html));
        if (videos.length > 50) videos.length = 50;
        categories = [
          { slug: 'creators/onlyfans', name: 'OnlyFans' },
          { slug: 'creators/fansly', name: 'Fansly' },
          { slug: 'creators/instagram', name: 'Instagram' }
        ];
      } else {
        const re = /<a class="movie-item m-block" title="([^"]+)" href="([^"]+)">[\s\S]*?<img[^>]*src="([^"]+)"[\s\S]*?<span class="ribbon-viewed">([^<]+)<\/span>/g;
        let m; while ((m = re.exec(html))) {
          const cd1 = m[1].match(/([A-Z]{2,6}-\d+)/); videos.push({ title: m[1], path: m[2], thumbnail: m[3].startsWith('http') ? m[3] : `${HOST}${m[3]}`, views: m[4], code: cd1 ? cd1[1] : '' });
        }
        if (!videos.length) {
          const re2 = /<a class="movie-item m-block" title="([^"]+)" href="([^"]+)">[\s\S]*?<img[^>]*src="([^"]+)"/g;
          while ((m = re2.exec(html))) { const cd2 = m[1].match(/([A-Z]{2,6}-\d+)/); videos.push({ title: m[1], path: m[2], thumbnail: m[3].startsWith('http') ? m[3] : `${HOST}${m[3]}`, views: 'N/A', code: cd2 ? cd2[1] : '' }); }
        }
        const cr = /<li class="menu-item"><a href="\/category\/([^"]+)\/">([^<]+)<\/a><\/li>/g;
        while ((m = cr.exec(html))) categories.push({ slug: m[1], name: m[2] });
        if (!categories.length) categories = [
          { slug: 'trending', name: 'Trending' }, { slug: 'censored-2', name: 'Censored' },
          { slug: 'uncensored-3', name: 'Không che' }, { slug: 'beauty-4', name: 'Beauty' }
        ];
      }

      // Parse tổng số trang từ navigation
      let totalPages = 1;
      const pageNums = [];

      if (site === 'sexbjcam') {
        // SexBJCam: phân trang bình thường, fetch theo page yêu cầu
        totalPages = 99; // ước lượng — tự dừng khi hết nội dung
      } else if (site === 'javtrailers') {
        // JavTrailers: tìm tất cả page=N trong href
        const pageRe = /[?&]page=(\d+)/g;
        let pm; while ((pm = pageRe.exec(html))) pageNums.push(parseInt(pm[1]));
        // Lọc unique + lấy số lớn nhất
        const unique = [...new Set(pageNums)].sort((a,b) => b - a);
        totalPages = unique.length ? unique[0] : 1;
      } else if (site === 'vlxx') {
        // VLXX dùng data-page attribute và /new/N/ URL
        const pageRe = /data-page='(\d+)'/g;
        let pm; while ((pm = pageRe.exec(html))) pageNums.push(parseInt(pm[1]));
      } else if (site === 'quatvn') {
        // QuatVN dùng g1-pagination, chỉ hiện 4 trang + "Next"
        const pageRe = /\/page\/(\d+)\/"[^>]*>(\d+)<\/a>/g;
        let pm; while ((pm = pageRe.exec(html))) pageNums.push(parseInt(pm[2]));
        // Kiểm tra có "Next" link không
        const hasNext = /rel="next"|class="[^"]*next[^"]*"|aria-label="Next"/i.test(html);
        const maxVisible = pageNums.length ? Math.max(...pageNums) : 0;
        // Nếu có Next nhưng chỉ thấy ≤4 trang → set mặc định 99 (vô hạn)
        if (hasNext && maxVisible <= 4) totalPages = 999;
        else totalPages = maxVisible || 1;
      } else {
        // javhdz, sexbjcam: /page/N/ trong href
        const pageRe = /\/page\/(\d+)\/"[^>]*>(\d+)<\/a>/g;
        let pm; while ((pm = pageRe.exec(html))) pageNums.push(parseInt(pm[2]));
        const filtered = pageNums.filter(n => n > 2);
        if (filtered.length) totalPages = Math.max(...filtered);
        else if (pageNums.length) totalPages = Math.max(...pageNums);
      }
      // ====== JAVTIFUL pagination ======
      if (site === 'javtiful') {
        const hasNext = /[?&]page=\d+/g.test(html);
        totalPages = hasNext ? 99 : 1;
      }

      // 18Tube pagination
      if (site === '18tube') {
        const hasNext = /class="next[^"]*"/i.test(html) || /rel="next"/i.test(html);
        totalPages = hasNext ? 99 : 1;
      }

      // JavTrailers: thêm studio rows cho trang chủ
      let studioRows = [];
      if (site === 'javtrailers' && page >= 1 && !search) {
        const topStudios = categories.filter(c => !['trending','newest'].includes(c.slug) && !['prestige','sod-create'].includes(c.slug));
        // Tất cả studio trên trang 1
        const pageStudios = parseInt(page) === 1 ? topStudios : topStudios.slice(0, 0);
        if (!pageStudios.length) { studioRows = []; } else {
        // Fetch song song tất cả studio pages
        const sParse = (sHtml) => {
          const svids = [];
          const sRe = /<a\s+href="\/video\/([^"]+)"\s+class="video-link"\s+title="([^"]+)"[\s\S]*?<img[^>]*(?:data-src|src)="([^"]+)"[\s\S]*?duration-badge[^>]*>([^<]+)<\/span>[\s\S]*?<p class="card-text title mb-0 vid-title">[^<]*<\/p>\s*<small[^>]*>([^<]*)<\/small>/g;
          let sm; while ((sm = sRe.exec(sHtml)) && svids.length < 40) {
            if (/\b(Best|Collection|Compilation)\b/i.test(sm[2])) continue;
            const dur = parseDuration(sm[4]);
            if (dur >= 240) continue;
            svids.push({ title: sm[2], path: '/video/' + sm[1], thumbnail: sm[3], views: sm[5] || 'N/A' });
          }
          return svids;
        };
        const results = await Promise.allSettled(pageStudios.map(st => {
          const sPage = page > 1 ? `?page=${page}` : '';
          return fetchText(`${HOST}/studios/${st.slug}${sPage}`, HOST + '/').then(h => ({ studio: st, videos: sParse(h) }));
        }));
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value.videos.length >= 3) studioRows.push(r.value);
        }
        }
      }

      // Proxy thumbnail cho site bị chặn (trình duyệt không load được trực tiếp)
      if (['javtrailers', 'javtiful'].includes(site)) {
        for (const v of videos) {
          if (v.thumbnail && !v.thumbnail.startsWith('/api/')) {
            // JavTrailers: upgrade thumbnail lên 800px thay vì 360px
            if (site === 'javtrailers') v.thumbnail = v.thumbnail.replace(/ps\.w\d+\.webp/, 'pl.w800.webp');
            v.thumbnail = `/api/proxy/image?url=${encodeURIComponent(v.thumbnail)}&site=${site}`;
          }
        }
        for (const row of studioRows) {
          for (const v of row.videos || []) {
            if (v.thumbnail && !v.thumbnail.startsWith('/api/')) {
              if (site === 'javtrailers') v.thumbnail = v.thumbnail.replace(/ps\.w\d+\.webp/, 'pl.w800.webp');
              v.thumbnail = `/api/proxy/image?url=${encodeURIComponent(v.thumbnail)}&site=${site}`;
            }
          }
        }
      }

      return sendJSON(res, { success: true, page: parseInt(page), hasMore: parseInt(page) < totalPages, totalPages, videos, categories, studioRows });

    // ==================== API: CHI TIẾT VIDEO ====================
    } else if (pathname === '/api/video-detail') {
      const videoPath = parsed.searchParams.get('path');
      if (!videoPath) return sendJSON(res, { success: false, error: 'Missing path' }, 400);

      // Detail cache (5 phút)
      const cacheKey = site + ':' + videoPath;
      const cached = detailCache.get(cacheKey);
      if (cached && Date.now() - cached.ts < 300000) return sendJSON(res, cached.data);

      const cleanPath = videoPath.startsWith('/') ? videoPath : '/' + videoPath;
      const url = HOST + cleanPath;
      console.log(`[DETAIL] ${url}`);
      const html = await fetchText(url, HOST + '/');

      const title = (html.match(/<h1 class="page-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/) ||
                     html.match(/<h1 class="header-title"><a[^>]*>([^<]+)<\/a><\/h1>/) ||
                     html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/))?.[1].replace(/<[^>]+>/g, '').trim() || 'Unknown';

      let videoId = (html.match(/id="video"\s+data-id="(\d+)"/) || html.match(/server\((\d+)/))?.[1] || null;
      if (site === 'quatvn' && !videoId) {
        const dm = html.match(/data-item="([^"]+)"/);
        if (dm) try { const di = JSON.parse(dm[1].replace(/&quot;/g, '"')); if (di.id) videoId = di.id.toString(); } catch {}
      }

      let description = '';
      if (site === 'vlxx') { const d = html.match(/<div class="video-description">([\s\S]*?)<\/div>/); description = d ? d[1] : ''; }
      else if (site === 'quatvn') { const d = html.match(/<div class="entry-content[^"]*">([\s\S]*?)<\/div>/); description = d ? d[1] : ''; }
      else { const d = html.match(/<article class="block-movie-content"[^>]*>([\s\S]*?)<\/article>/); description = d ? d[1] : ''; }
      description = description.replace(/<(?!\/?img(?=>|\s)[^>]*>)[^>]+>/g, '').trim();

      let thumbnail = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] || '';
      if (!thumbnail && site !== 'vlxx' && site !== 'quatvn') thumbnail = html.match(/class="thumb" src="([^"]+)"/)?.[1] || '';
      if (site === 'quatvn' && !thumbnail) {
        const dm = html.match(/data-item="([^"]+)"/);
        if (dm) try { const di = JSON.parse(dm[1].replace(/&quot;/g, '"')); if (di.splash) thumbnail = di.splash; } catch {}
      }
      if (thumbnail && !thumbnail.startsWith('http')) thumbnail = HOST + '/' + thumbnail.replace(/^\//, '');

      const tags = [];
      let javCode = null;
      if (site === 'vlxx') {
        const tb = html.match(/<div class="video-tags">([\s\S]*?)<\/div>/);
        if (tb) { const tr = /<a href="([^"]+)" title="([^"]+)">/g; let m; while ((m = tr.exec(tb[1]))) tags.push({ slug: m[1].replace(/^\//, '').replace(/\/$/, ''), name: m[2] }); }
        const jc = html.match(/<span class="video-code">([^<]+)<\/span>/);
        if (jc) javCode = jc[1].trim();
      } else if (site === 'quatvn') {
        const tr = /<a href="[^"]*\/tag\/([^"\/]+)\/"[\s\S]*?>([^<]+)<\/a>/g; let m;
        while ((m = tr.exec(html))) tags.push({ slug: m[1], name: m[2].trim() });
      } else {
        const tr = /<a class="tag-link" href="\/tag\/([^"]+)\/" title="([^"]+)">/g; let m;
        while ((m = tr.exec(html))) tags.push({ slug: m[1], name: m[2] });
      }

      let streamUrl = null, proxiedStreamUrl = null, quatvnPlaylist = null;

      // --- VLXX ---
      if (site === 'vlxx' && videoId) {
        // POST tới VLXX ajax để lấy stream URL
        try {
          const postData = 'vlxx_server=1&id=' + videoId + '&server=1';
          const resp = await new Promise((resolve) => {
            const req = https.request('https://vlxx.moi/ajax.php', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData),
                'Referer': url,
                'Origin': 'https://vlxx.moi',
                'User-Agent': UA
              },
              agent: AGENTS.https
            }, r => {
              const chunks = [];
              r.on('data', c => chunks.push(c));
              r.on('end', () => {
                try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
                catch { resolve(null); }
              });
            });
            req.on('error', () => resolve(null));
            req.write(postData);
            req.end();
          });
          if (resp && resp.player) {
            const src = resp.player.match(/iframe[^>]*src="([^"]+)"/) || resp.player.match(/src='([^']+)'/);
            if (src) {
              const embed = await fetchText(src[1], 'https://vlxx.moi/');
              const fm = embed.match(/"file"\s*:\s*"([^"]+)"/);
              if (fm) {
                streamUrl = fm[1];
                // Google CDN không có CORS → phải proxy qua server
                proxiedStreamUrl = `/api/proxy/pl.m3u8?url=${encodeURIComponent(streamUrl)}&s=${site}`;
              }
            }
          }
        } catch {}
      }

      // --- QUATVN ---
      if (site === 'quatvn') {
        const dr = /data-item="([^"]+)"/g; let m; const items = [];
        while ((m = dr.exec(html))) {
          try { const di = JSON.parse(m[1].replace(/&quot;/g, '"')); if (di.sources?.length) items.push(di); } catch {}
        }
        if (items.length) {
          streamUrl = items[0].sources[0].src;
          proxiedStreamUrl = streamUrl.includes('.m3u8')
            ? `/api/proxy/sub.m3u8?url=${encodeURIComponent(streamUrl)}&site=${site}`
            : `/api/proxy/mp4?url=${encodeURIComponent(streamUrl)}&site=${site}`;
          quatvnPlaylist = items.map((item, idx) => ({
            index: idx, title: item.fv_title || `Part ${idx+1}`,
            streamUrl: item.sources[0].src,
            proxiedStreamUrl: item.sources[0].src.includes('.m3u8')
              ? `/api/proxy/sub.m3u8?url=${encodeURIComponent(item.sources[0].src)}&site=${site}`
              : `/api/proxy/mp4?url=${encodeURIComponent(item.sources[0].src)}&site=${site}`,
            thumbnail: item.splash || thumbnail, videoId: item.id?.toString() || null
          }));
        }
      }

      // --- SEXBJCAM ---
      if (site === 'sexbjcam') {
        const ifm = html.match(/<iframe[^>]*src="([^"]+)"/i);
        if (ifm) {
          try {
            const embedHtml = await fetchText(ifm[1], 'https://sexbjcam.com/');
            const vidUrls = embedHtml.match(/"(https?:\/\/[^"]+\.(?:m3u8|mp4))"/g);
            if (vidUrls && vidUrls.length) {
              streamUrl = vidUrls[0].replace(/"/g, '');
              proxiedStreamUrl = streamUrl;
              console.log(`[SexBJCam] Found stream via embed: ${streamUrl.slice(0, 60)}`);
            }
          } catch {}
        }
      }

      // --- JAVTIFUL ---
      if (site === 'javtiful') {
        try {
          const javUrl = HOST + cleanPath;
          const javCookiesPath = path.join(__dirname, '.javtiful_cookies.txt');
          let extraHeaders = {};
          try {
            const cookieStr = fs.readFileSync(javCookiesPath, 'utf8').trim();
            if (cookieStr) extraHeaders['Cookie'] = cookieStr;
          } catch {}
          const javHtml = await fetchText(javUrl, HOST + '/', extraHeaders);
          // R2 signed URL in playerSources JSON config (server-rendered)
          const psMatch = javHtml.match(/"playerSources":(\[[\s\S]*?\])\s*(?:,|\})/);
          if (psMatch) {
            // Fix \\u0026 -> & for JSON parsing, then parse
            const cleaned = psMatch[1].replace(/\\\\u0026/g, '&');
            try {
              const sources = JSON.parse(cleaned);
              if (sources.length && sources[0].src) {
                streamUrl = sources[0].src;
                proxiedStreamUrl = `/api/proxy/javtiful.mp4?url=${encodeURIComponent(sources[0].src)}`;
                console.log(`[JavTiful] Stream: ${streamUrl.slice(0, 60)}...`);
              }
            } catch (e) {
              console.log(`[JavTiful] JSON parse error: ${e.message}`);
            }
          }
          if (!streamUrl) {
            // Fallback: try direct src pattern in JSON config
            const srcMatch = javHtml.match(/"src"\s*:\s*"(https:\/\/[^"]*cloudflarestorage[^"]*)"/);
            if (srcMatch) {
              streamUrl = srcMatch[1].replace(/\\\\u0026/g, '&');
              proxiedStreamUrl = streamUrl;
              console.log(`[JavTiful] Fallback stream: ${streamUrl.slice(0, 60)}...`);
            }
          }
        } catch (e) { console.log(`[JavTiful] Error: ${e.message}`); }
      }

      // --- JAVHDZ ---
      if (site === 'javhdz') {
        const ifm = html.match(/<iframe[^>]*src="([^"]+)"/i);
        if (ifm) {
          try {
            const embedHtml = await fetchText(ifm[1], 'https://sexbjcam.com/');
            const vidUrls = embedHtml.match(/"(https?:\/\/[^"]+\.(?:m3u8|mp4))"/g);
            if (vidUrls && vidUrls.length) {
              streamUrl = vidUrls[0].replace(/"/g, '');
              proxiedStreamUrl = streamUrl;
              console.log(`[SexBJCam] Found stream via embed: ${streamUrl.slice(0, 60)}`);
            }
          } catch {}
        }
      }

      // --- JAVTRAILERS ---
      if (site === 'javtrailers') {
        // Ưu tiên CDN media.javtrailers.com (dmm.co.jp bị chặn)
        const jtMatch = html.match(/"(https?:\/\/media\.javtrailers\.com[^"]+playlist\.m3u8[^"]*)"/);
        const hlsMatch = jtMatch || html.match(/"(https?:\/\/[^"]+playlist\.m3u8[^"]*)"/);
        if (hlsMatch) {
          streamUrl = hlsMatch[1];
          proxiedStreamUrl = `/api/proxy/pl.m3u8?url=${encodeURIComponent(streamUrl)}&s=${site}`;
          console.log(`[JavTrailers] Stream: ${streamUrl.slice(0, 60)}`);
        }
        // Cast(s) — diễn viên (ưu tiên trước studio)
        const castRe = /href="\/casts\/([^"]+)"[^>]*class="badge[^"]*badge-link"[^>]*>([^<]+)</g;
        let cm; while ((cm = castRe.exec(html))) {
          const name = cm[2].trim().replace(/\s+[\u3040-\u9FFF\u4E00-\u9FFF].*$/, '').trim();
          if (name && name.length > 1 && !tags.find(t => t.slug === cm[1])) {
            tags.push({ slug: cm[1], name, type: 'cast' });
          }
        }
        // Studio
        const studioM = html.match(/Studio:<\/span><a[^>]*href="\/studios\/([^"]+)"[^>]*>([^<]+)<\/a>/i);
        if (studioM) {
          tags.push({ slug: studioM[1], name: studioM[2].trim(), type: 'studio' });
        }
      }

      // --- JAVHDZ ---
      if (site === 'javhdz') {
        // 1. Try atob
        const b64 = html.match(/window\.atob\("([A-Za-z0-9+/=]+)"\)/);
        if (b64) {
          try {
            const dec = Buffer.from(b64[1], 'base64').toString();
            if (dec.startsWith('http')) { streamUrl = dec; }
          } catch {}
        }
        // 2. Fallback: tìm m3u8 URL trong HTML
        if (!streamUrl) {
          const m3 = html.match(/"((https?:)?\/\/[^"]+\.m3u8[^"]*)"/);
          if (m3) { streamUrl = m3[1].startsWith('//') ? 'https:' + m3[1] : m3[1]; }
        }
        if (streamUrl) {
          proxiedStreamUrl = `/api/proxy/pl.m3u8?url=${encodeURIComponent(streamUrl)}&s=${site}`;
        }
      }

      // --- 18TUBE (creator directory, no stream) ---
      if (site === '18tube') {
        const nameM = html.match(/<h1[^>]*class="creator-name"[^>]*>([\s\S]*?)<\/h1>/);
        const descM = html.match(/<div[^>]*class="creator-description"[^>]*>([\s\S]*?)<\/div>/);
        if (nameM) title = nameM[1].replace(/<[^>]+>/g, '').trim();
        if (descM) description = descM[1].replace(/<[^>]+>/g, '').trim();
        if (!thumbnail) {
          const tm = html.match(/<img[^>]*class="creator-avatar"[^>]*src="([^"]+)"/);
          if (tm) thumbnail = tm[1];
        }
        // Trả về URL gốc để mở trong tab mới
        streamUrl = url;
        proxiedStreamUrl = null;
      }

      // VTT thumbnails
      const vttMatch = html.match(/"([^"]+\.vtt)"[\s\S]{0,50}kind:\s*"thumbnails"/) ||
                       html.match(/"([^"]+thumbnails\.vtt)"/) ||
                       html.match(/file:\s*"([^"]+\.vtt)"/);
      let vttUrl = null, proxiedVtt = null;
      if (vttMatch) { vttUrl = vttMatch[1]; proxiedVtt = `/api/proxy/vtt?url=${encodeURIComponent(vttUrl)}&site=${site}`; }

      // Servers
      const servers = [];
      if (site === 'vlxx') {
        const sr = /onclick="server\((\d+),(\d+)\)"/g; let m;
        while ((m = sr.exec(html))) servers.push({ id: parseInt(m[1]), name: `Server ${m[1]}` });
      } else if (site === 'javhdz') {
        servers.push({ id: 1, name: 'Server 1 (HLS)' });
        const sr = /<span class="server"[^>]*onclick="server\(\d+,(\d+)\)"[^>]*>([^<]+)<\/span>/g; let m;
        while ((m = sr.exec(html))) if (parseInt(m[1]) !== 1) servers.push({ id: parseInt(m[1]), name: m[2] });
      } else if (site === 'quatvn') {
        servers.push({ id: 1, name: 'Server 1' });
      }

      // Tự động search sukebei cho javhdz
      let torrent = null;
      const codeFromParam = parsed.searchParams.get('code');
      const codeMatch = codeFromParam || title.match(/([A-Z]{2,6}-\d+)/);
      if (site === 'javhdz' && codeMatch) {
          try {
            const { execSync } = require('child_process');
            const res2 = execSync('node ' + path.join(__dirname, '.local', 'bin', 'sukebei-search.js').replace(/'/g, "'\\''") + " '" + codeMatch[1].replace(/'/g, "'\\''") + "'", { timeout: 15000, encoding: 'utf8' });
            const parts = res2.trim().split(':');
            if (parts[0] === 'SUCCESS' && parts[2]) {
              torrent = { magnet: parts[2], seeders: parts[1] };
              console.log(`[SUKEBEI] ${codeMatch[1]}: ${parts[1]} seeders`);
              // Tự động thêm vào PikPak
              try {
                const addResult = execSync('node ' + path.join(__dirname, '.local', 'bin', 'pikpak-add.js').replace(/'/g, "'\\''") + " '" + parts[2].replace(/'/g, "'\\''") + "'", { timeout: 15000, encoding: 'utf8' });
                console.log(`[PIKPAK] ${addResult.trim()}`);
              } catch (e) {
                console.log(`[PIKPAK] Error: ${e.message}`);
              }
            }
          } catch {}
        }

      // Proxy thumbnail cho site bị chặn
      if (['javtrailers', 'javtiful'].includes(site) && thumbnail && !thumbnail.startsWith('/api/')) {
        if (site === 'javtrailers') thumbnail = thumbnail.replace(/ps\.w\d+\.webp/, 'pl.w800.webp');
        thumbnail = `/api/proxy/image?url=${encodeURIComponent(thumbnail)}&site=${site}`;
      }

      const result = {
        success: true, videoId, title, description, thumbnail, tags, servers,
        streamUrl, proxiedStreamUrl, vttUrl, proxiedVtt, playlist: quatvnPlaylist,
        torrent, javCode
      };

      // Lưu cache
      detailCache.set(cacheKey, { data: result, ts: Date.now() });
      return sendJSON(res, result);

    // ==================== API: SERVER SOURCE ====================
    } else if (pathname === '/api/server-source') {
      const id = parsed.searchParams.get('id');
      const serverId = parsed.searchParams.get('server');
      const refPath = parsed.searchParams.get('referer') || '';
      if (!id || !serverId) return sendJSON(res, { success: false, error: 'id and server required' }, 400);
      const ref = refPath ? `${HOST}${refPath}` : `${HOST}/`;

      let playerHtml = null, iframeSrc = null;
      if (site === 'vlxx') {
        try {
          const postData = 'vlxx_server=1&id=' + id + '&server=' + serverId;
          const resp = await new Promise(resolve => {
            const req = https.request('https://vlxx.moi/ajax.php', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': ref, 'User-Agent': UA },
              agent: AGENTS.https
            }, r => { const c = []; r.on('data', d => c.push(d)); r.on('end', () => { try { resolve(JSON.parse(Buffer.concat(c).toString())); } catch { resolve(null); } }); });
            req.on('error', () => resolve(null));
            req.write(postData); req.end();
          });
          if (resp?.player) {
            playerHtml = resp.player;
            const sm = playerHtml.match(/iframe[^>]*src="([^"]+)"/) || playerHtml.match(/src='([^']+)'/);
            iframeSrc = sm?.[1] || null;
          }
        } catch {}
      } else {
        try {
          const postData = JSON.stringify({ id: parseInt(id), server: parseInt(serverId) });
          const mod = HOST.startsWith('https:') ? https : http;
          const req = mod.request(HOST + '/ajax', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Referer': ref, 'User-Agent': UA },
            agent: HOST.startsWith('https:') ? AGENTS.https : AGENTS.http
          }, r => {
            const c = []; r.on('data', d => c.push(d)); r.on('end', () => {
              try { const data = JSON.parse(Buffer.concat(c).toString()); if (data?.player) { playerHtml = data.player; const sm = data.player.match(/iframe[^>]*src="([^"]+)"/) || data.player.match(/src='([^']+)'/); iframeSrc = sm?.[1] || null; } } catch {}
              sendJSON(res, { success: true, playerHtml, iframeSrc });
            });
          });
          req.on('error', () => sendJSON(res, { success: false }));
          req.write(postData); req.end();
          return; // response sent in callback
        } catch {}
      }
      return sendJSON(res, { success: true, playerHtml, iframeSrc });

    // ==================== API: DOWNLOADS ====================
    } else if (pathname === '/api/downloads') {
      const id = parsed.searchParams.get('id');
      const refPath = parsed.searchParams.get('referer') || '';
      if (!id) return sendJSON(res, { success: false, error: 'id required' }, 400);
      const ref = refPath ? `${HOST}${refPath}` : `${HOST}/`;
      const downloads = [];

      if (site === 'quatvn') {
        try {
          const html = await fetchText(`${HOST}${refPath.startsWith('/') ? refPath : '/' + refPath}`, HOST + '/');
          const dm = html.match(/data-item="([^"]+)"/);
          if (dm) { const di = JSON.parse(dm[1].replace(/&quot;/g, '"')); if (di.sources?.length) downloads.push({ label: 'Direct MP4', url: di.sources[0].src }); }
        } catch {}
      } else if (site === 'vlxx') {
        try {
          const text = await new Promise(resolve => {
            const req = https.request('https://vlxx.moi/ajax.php', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': ref, 'User-Agent': UA },
              agent: AGENTS.https
            }, r => { const c = []; r.on('data', d => c.push(d)); r.on('end', () => resolve(Buffer.concat(c).toString())); });
            req.on('error', () => resolve(''));
            req.write('vlxx_download=1&id=' + id); req.end();
          });
          let data; try { data = JSON.parse(text); } catch { data = { download: text }; }
          if (data?.download) {
            const lr = /<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g; let m;
            while ((m = lr.exec(data.download))) {
              let u = m[1];
              if (u.includes('/goto.html?url=')) { try { const dec = Buffer.from(u.split('/goto.html?url=')[1], 'base64').toString(); if (dec.startsWith('http')) u = dec; } catch {} }
              downloads.push({ label: m[2], url: u });
            }
          }
        } catch {}
      } else {
        try {
          const data = await new Promise(resolve => {
            const mod = HOST.startsWith('https:') ? https : http;
            const req = mod.request(HOST + '/download', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Referer': ref, 'User-Agent': UA },
              agent: mod === https ? AGENTS.https : AGENTS.http
            }, r => { const c = []; r.on('data', d => c.push(d)); r.on('end', () => { try { resolve(JSON.parse(Buffer.concat(c).toString())); } catch { resolve(null); } }); });
            req.on('error', () => resolve(null));
            req.write(JSON.stringify({ id: parseInt(id), server: 1 })); req.end();
          });
          if (data?.download) {
            const lr = /<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g; let m;
            while ((m = lr.exec(data.download))) {
              let u = m[1];
              if (u.includes('/goto.html?url=')) { try { const dec = Buffer.from(u.split('/goto.html?url=')[1], 'base64').toString(); if (dec.startsWith('http')) u = dec; } catch {} }
              downloads.push({ label: m[2], url: u });
            }
          }
        } catch {}
      }
      return sendJSON(res, { success: true, downloads });

    // ==================== API: CACHE STATUS ====================
    } else if (pathname === '/api/cache-status') {
      const plUrl = parsed.searchParams.get('pl');
      if (!plUrl) return sendJSON(res, { success: false, error: 'Missing pl' }, 400);

      try {
        const raw = await fetchText(plUrl, HOST + '/');
        const base = plUrl.substring(0, plUrl.lastIndexOf('/') + 1);
        let total = 0, cached = 0, totalBytes = 0, cachedBytes = 0;

        for (const line of raw.split('\n')) {
          const t = line.trim();
          if (!t || t.startsWith('#')) continue;
          total++;
          const abs = t.startsWith('http') ? t : (t.startsWith('/') ? new URL(plUrl).origin + t : base + t);
          const fp = cachePath(abs);
          if (fs.existsSync(fp)) {
            cached++;
            try { const sz = fs.statSync(fp).size; cachedBytes += sz; } catch {}
          }
          // Estimate total size from first non-cached segment? Skip.
        }

        return sendJSON(res, {
          success: true,
          total,
          cached,
          progress: total > 0 ? Math.round(cached / total * 100) : 0,
          cachedBytes,
          ready: cached === total
        });
      } catch (e) {
        return sendJSON(res, { success: false, error: e.message });
      }

    // ==================== API: DOWNLOAD CACHED ====================
    } else if (pathname === '/api/download-cached') {
      let plUrl = parsed.searchParams.get('pl');
      if (!plUrl) { res.writeHead(400); return res.end('Missing pl'); }
      const force = parsed.searchParams.get('force') === '1';

      try {
        let raw = await fetchText(plUrl, HOST + '/');

        // Nếu là master playlist, tìm sub-playlist chất lượng cao nhất
        if (raw.includes('#EXT-X-STREAM-INF')) {
          const streams = [];
          let curInfo = null;
          for (const line of raw.split('\n')) {
            const t = line.trim();
            if (t.startsWith('#EXT-X-STREAM-INF')) curInfo = t;
            else if (!t.startsWith('#') && t) {
              const h = parseInt(curInfo?.match(/RESOLUTION=\d+x(\d+)/)?.[1] || 0);
              const abs = t.startsWith('http') ? t : (t.startsWith('/') ? new URL(plUrl).origin + t : plUrl.substring(0, plUrl.lastIndexOf('/') + 1) + t);
              streams.push({ url: abs, height: h });
              curInfo = null;
            }
          }
          streams.sort((a, b) => b.height - a.height);
          if (!streams.length) throw new Error('No sub-playlists found');
          plUrl = streams[0].url;
          console.log(`[DOWNLOAD] Best quality: ${streams[0].height}p`);
          raw = await fetchText(plUrl, HOST + '/');
        }

        const base = plUrl.substring(0, plUrl.lastIndexOf('/') + 1);
        const segments = [];
        const needFetch = [];

        for (const line of raw.split('\n')) {
          const t = line.trim();
          if (!t || t.startsWith('#')) continue;
          const abs = t.startsWith('http') ? t : (t.startsWith('/') ? new URL(plUrl).origin + t : base + t);
          const fp = cachePath(abs);
          if (fs.existsSync(fp)) {
            segments.push({ abs, cached: true, path: fp });
          } else {
            segments.push({ abs, cached: false });
            needFetch.push(abs);
          }
        }

        // Nếu chưa cache hết
        if (needFetch.length > 0) {
          if (!force) {
            // Trả về JSON báo progress, không download
            let cachedBytes = 0;
            for (const seg of segments) {
              if (seg.cached && seg.path) { try { cachedBytes += fs.statSync(seg.path).size; } catch {} }
            }
            return sendJSON(res, {
              success: false,
              error: 'CACHE_NOT_READY',
              total: segments.length,
              cached: segments.length - needFetch.length,
              progress: Math.round((segments.length - needFetch.length) / segments.length * 100),
              cachedBytes,
              message: `Cache chưa sẵn sàng (${segments.length - needFetch.length}/${segments.length}). Bấm lại sau khi xem thêm!`
            });
          }

          // force=1: fetch nốt rồi download
          console.log(`[DOWNLOAD] Fetching ${needFetch.length} missing segments...`);
          for (let i = 0; i < needFetch.length; i += PREFETCH_CONCURRENCY) {
            await Promise.all(needFetch.slice(i, i + PREFETCH_CONCURRENCY).map(async url => {
              try { const buf = await fetchBuffer(url, HOST + '/'); if (buf && buf.length > 100) cacheSet(url, buf); } catch {}
            }));
          }
          for (const seg of segments) {
            if (!seg.cached) { const fp = cachePath(seg.abs); if (fs.existsSync(fp)) { seg.cached = true; seg.path = fp; } }
          }
        }

        // Kiểm tra lại: nếu vẫn còn thiếu, đếm và báo
        const stillMissing = segments.filter(s => !s.cached).length;
        if (stillMissing > 0) {
          console.warn(`[DOWNLOAD] ${stillMissing}/${segments.length} segments failed to fetch — file sẽ bị thiếu!`);
          if (!force && stillMissing > segments.length * 0.1) {
            return sendJSON(res, {
              success: false, error: 'TOO_MANY_MISSING',
              total: segments.length, cached: segments.length - stillMissing,
              progress: Math.round((segments.length - stillMissing) / segments.length * 100),
              message: `Còn ${stillMissing} segment không tải được. Thử lại sau.`
            });
          }
        }

        // Stream file TS
        const safeName = plUrl.split('/').pop().replace(/[^a-zA-Z0-9_-]/g, '_') || 'video';
        res.writeHead(200, {
          'Content-Type': 'video/MP2T',
          'Content-Disposition': `attachment; filename="${safeName.replace(/\.m3u8$/, '')}.ts"`,
          'Access-Control-Allow-Origin': '*',
          'Transfer-Encoding': 'chunked'
        });

        for (const seg of segments) {
          if (seg.cached && seg.path) { res.write(fs.readFileSync(seg.path)); }
        }
        res.end();
        const finalCached = segments.filter(s => s.cached).length;
        console.log(`[DOWNLOAD] Done: ${finalCached}/${segments.length} segments (${stillMissing} missing)`);
      } catch (e) {
        if (!res.headersSent) { res.writeHead(500); res.end('Download failed: ' + e.message); }
      }

    // ==================== API: BATCH CODES ====================
    } else if (pathname === '/api/batch-codes') {
      const pathsRaw = parsed.searchParams.get('paths');
      if (!pathsRaw) return sendJSON(res, {});
      const paths = pathsRaw.split(',').slice(0, 10);
      const results = {};
      await Promise.all(paths.map(async (p) => {
        try {
          const decoded = decodeURIComponent(p);
          const body = await fetchText(HOST + decoded);
          const code = body.match(/([A-Z]{2,6}-\d+)/);
          if (code) results[p] = code[1];
        } catch {}
      }));
      return sendJSON(res, results);

    // ==================== API: SUKEBEI SEARCH ====================
    } else if (pathname === '/api/sukebei-search') {
      const code = parsed.searchParams.get('code');
      if (!code) return sendJSON(res, { success: false, error: 'Missing code' }, 400);
      try {
        const { execSync } = require('child_process');
        const result = execSync('node ' + path.join(__dirname, '.local', 'bin', 'sukebei-search.js').replace(/'/g, "'\\''") + " '" + code.replace(/'/g, "'\\''") + "'", { timeout: 15000, encoding: 'utf8' });
        const parts = result.trim().split(':');
        if (parts[0] === 'SUCCESS' && parts[2]) {
          return sendJSON(res, { success: true, seeders: parts[1], magnet: parts[2] });
        }
        return sendJSON(res, { success: false, error: parts[1] || 'No results' });
      } catch (e) {
        return sendJSON(res, { success: false, error: e.message }, 500);
      }

    // ==================== PROXY: PLAYLIST M3U8 ====================
    } else if (pathname === '/api/proxy/pl.m3u8') {
      const targetUrl = parsed.searchParams.get('url');
      if (!targetUrl) { res.writeHead(400); return res.end('Missing url'); }
      const raw = await fetchText(targetUrl, HOST + '/');
      const base = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
      const isMaster = raw.includes('#EXT-X-STREAM-INF');
      const outLines = [];

      for (const line of raw.split('\n')) {
        const t = line.trim();
        if (t.startsWith('#') || !t) { outLines.push(line); continue; }
        const abs = t.startsWith('http') ? t : (t.startsWith('/') ? new URL(targetUrl).origin + t : base + t);
        outLines.push(isMaster
          ? `/api/proxy/pl.m3u8?url=${encodeURIComponent(abs)}&s=${site}`
          : `/api/proxy/seg.ts?url=${encodeURIComponent(abs)}&pl=${encodeURIComponent(targetUrl)}&s=${site}`);
      }

      res.writeHead(200, { 'Content-Type': 'application/x-mpegURL', 'Access-Control-Allow-Origin': '*' });
      res.end(outLines.join('\n'));

      // Prefetch nếu là sub-playlist
      if (!isMaster) {
        const urls = [];
        for (const line of raw.split('\n')) {
          const t = line.trim();
          if (!t || t.startsWith('#')) continue;
          urls.push(t.startsWith('http') ? t : (t.startsWith('/') ? new URL(targetUrl).origin + t : base + t));
        }
        if (urls.length) { prefetchToEnd(urls, 0, HOST, targetUrl); console.log(`[PREFETCH] ${urls.length} segments`); }
      }

    // ==================== PROXY: SEGMENT ====================
    } else if (pathname === '/api/proxy/seg.ts') {
      const targetUrl = parsed.searchParams.get('url');
      if (!targetUrl) { res.writeHead(400); return res.end('Missing url'); }
      const plUrl = parsed.searchParams.get('pl');
      const site = parsed.searchParams.get('s');
      const host = site ? getHost(site) : HOST;
      let buf = cacheGet(targetUrl);
      const hit = !!buf;
      if (!buf) { buf = await fetchAndCacheSegment(targetUrl, host); if (!buf) { res.writeHead(502); return res.end('Fetch failed'); } }
      res.writeHead(200, { 'Content-Type': 'video/MP2T', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=86400', 'X-Cache': hit ? 'HIT' : 'MISS' });
      res.end(buf);
      if (hit && plUrl) getPlaylistSegments(plUrl, host).then(u => { const i = u.indexOf(targetUrl); if (i !== -1) prefetchToEnd(u, i, host, plUrl); }).catch(() => {});

    // ==================== API: XÓA CACHE THEO PLAYLIST ====================
    } else if (pathname === '/api/clear-cache') {
      const plUrl = parsed.searchParams.get('pl');
      if (!plUrl) return sendJSON(res, { success: false, error: 'Missing pl' }, 400);
      try {
        const segs = await getPlaylistSegments(plUrl, HOST);
        let deleted = 0, freed = 0;
        for (const u of segs) {
          const cp = cachePath(u);
          try { const s = fs.statSync(cp); freed += s.size; fs.unlinkSync(cp); deleted++; } catch {}
        }
        console.log('[CLEAR] Deleted ' + deleted + '/' + segs.length + ' segments, freed ' + (freed/1e6).toFixed(1) + 'MB');
        return sendJSON(res, { success: true, deleted, total: segs.length, freed });
      } catch (e) {
        return sendJSON(res, { success: false, error: e.message }, 500);
      }

    // ==================== PROXY: VTT ====================
    } else if (pathname === '/api/proxy/vtt') {
      const targetUrl = parsed.searchParams.get('url');
      if (!targetUrl) { res.writeHead(400); return res.end('Missing url'); }
      const data = await fetchText(targetUrl, HOST + '/');
      const base = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
      res.writeHead(200, { 'Content-Type': 'text/vtt', 'Access-Control-Allow-Origin': '*' });
      res.end(data.split('\n').map(l => {
        const t = l.trim();
        if (!t.includes('.jpg') && !t.includes('.png')) return l;
        const [fn, h] = t.split('#');
        const abs = fn.startsWith('http') ? fn : base + fn;
        return `/api/proxy/image?url=${encodeURIComponent(abs)}&site=${site}` + (h ? '#' + h : '');
      }).join('\n'));

    // ==================== PROXY: IMAGE ====================
    } else if (pathname === '/api/proxy/image') {
      const targetUrl = parsed.searchParams.get('url');
      if (!targetUrl) { res.writeHead(400); return res.end('Missing url'); }
      try {
        const buf = await fetchBuffer(targetUrl, HOST + '/');
        const ct = 'image/jpeg';
        res.writeHead(200, { 'Content-Type': ct, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=86400' });
        res.end(buf);
      } catch {
        res.writeHead(502); res.end('Image fetch failed');
      }

    // ==================== PROXY: MP4 (quatvn) ====================
    } else if (pathname === '/api/proxy/mp4') {
      const targetUrl = parsed.searchParams.get('url');
      if (!targetUrl) { res.writeHead(400); return res.end('Missing url'); }

      // Cache key cho MP4
      const cacheKey = 'mp4:' + targetUrl;
      const cached = detailCache.get(cacheKey);
      let buf = null;

      if (cached && cached.buf) {
        buf = cached.buf;
        console.log(`[MP4 CACHE HIT] ${targetUrl.split('/').pop()}`);
      } else {
        try {
          buf = await fetchBuffer(targetUrl, HOST + '/');
          if (buf && buf.length > 1000) {
            detailCache.set(cacheKey, { buf, ts: Date.now() });
          }
        } catch {
          res.writeHead(502); return res.end('MP4 fetch failed');
        }
      }

      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': buf.length,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=86400',
        'Accept-Ranges': 'bytes'
      });
      res.end(buf);

    // ==================== PROXY: JAVTIFUL MP4 (full cache) ====================
    } else if (pathname === '/api/proxy/javtiful.mp4') {
      const targetUrl = parsed.searchParams.get('url');
      if (!targetUrl) { res.writeHead(400); return res.end('Missing url'); }

      // Cache key: hash of URL
      const hash = require('crypto').createHash('md5').update(targetUrl).digest('hex');
      const cacheFile = path.join(CACHE_DIR, hash + '.mp4');
      const tempFile = cacheFile + '.downloading';
      const stat = fs.existsSync(cacheFile) ? fs.statSync(cacheFile) : null;
      const range = req.headers.range || '';
      const urlHash = targetUrl.split('?')[0].split('/').pop();

      console.log(`[JavTiful Cache] ${urlHash} | Range: ${range || 'full'} | Cached: ${stat ? 'YES' : 'NO'}`);

      // Nếu đã cache đầy đủ → serve từ file
      if (stat && stat.size > 0) {
        const fileSize = stat.size;
        if (range) {
          const parts = range.replace(/bytes=/, '').split('-');
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
          const chunkSize = (end - start) + 1;
          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Content-Length': chunkSize,
            'Content-Type': 'video/mp4',
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=86400',
          });
          const stream = fs.createReadStream(cacheFile, { start, end });
          stream.pipe(res);
        } else {
          res.writeHead(200, {
            'Content-Length': fileSize,
            'Content-Type': 'video/mp4',
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=86400',
          });
          fs.createReadStream(cacheFile).pipe(res);
        }
        return;
      }

      // Chưa có cache → download + serve đồng thời
      // Tránh download trùng
      const alreadyDownloading = global.__javtifulDownloads || {};
      const dlKey = hash;

      if (!alreadyDownloading[dlKey]) {
        alreadyDownloading[dlKey] = true;
        global.__javtifulDownloads = alreadyDownloading;

        const urlObj = new URL(targetUrl);
        const mod = urlObj.protocol === 'https:' ? https : http;

        // Tạo temp file để ghi dần
        const writeStream = fs.createWriteStream(tempFile);
        let downloadedBytes = 0;
        let totalSize = 0;

        console.log(`[JavTiful] Bắt đầu download: ${urlHash}`);
        mod.get(targetUrl, {
          headers: { 'User-Agent': UA },
          rejectUnauthorized: false,
          timeout: 600000, // 10 phút
        }, upstream => {
          totalSize = parseInt(upstream.headers['content-length'] || '0', 10);
          console.log(`[JavTiful] Size: ${(totalSize/1e9).toFixed(2)}GB`);

          upstream.on('data', chunk => {
            downloadedBytes += chunk.length;
            writeStream.write(chunk);
          });

          upstream.on('end', () => {
            writeStream.end();
            // Rename temp → cache khi hoàn tất
            fs.renameSync(tempFile, cacheFile);
            console.log(`[JavTiful] ✅ Cache hoàn tất: ${urlHash} (${(downloadedBytes/1e9).toFixed(2)}GB)`);
            delete global.__javtifulDownloads[dlKey];
          });

          upstream.on('error', err => {
            console.log(`[JavTiful] ❌ Download error: ${err.message}`);
            writeStream.end();
            try { fs.unlinkSync(tempFile); } catch {}
            delete global.__javtifulDownloads[dlKey];
          });
        }).on('error', err => {
          console.log(`[JavTiful] ❌ Request error: ${err.message}`);
          writeStream.end();
          try { fs.unlinkSync(tempFile); } catch {}
          delete global.__javtifulDownloads[dlKey];
        });
      } else {
        console.log(`[JavTiful] Đang download bởi request khác: ${urlHash}`);
      }

      // Serve từ temp file nếu có, hoặc stream từ upstream
      const tempStat = fs.existsSync(tempFile) ? fs.statSync(tempFile) : null;
      if (tempStat && tempStat.size > 0) {
        const fileSize = tempStat.size;
        if (range) {
          const parts = range.replace(/bytes=/, '').split('-');
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
          const chunkSize = (end - start) + 1;
          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Content-Length': chunkSize,
            'Content-Type': 'video/mp4',
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=86400',
          });
          const stream = fs.createReadStream(tempFile, { start, end });
          stream.pipe(res);
        } else {
          res.writeHead(200, {
            'Content-Length': fileSize,
            'Content-Type': 'video/mp4',
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=86400',
          });
          fs.createReadStream(tempFile).pipe(res);
        }
      } else {
        // Fallback: stream trực tiếp từ upstream (không cache)
        const urlObj = new URL(targetUrl);
        const mod = urlObj.protocol === 'https:' ? https : http;
        mod.get(targetUrl, {
          headers: { 'User-Agent': UA, ...(range ? { 'Range': range } : {}) },
          rejectUnauthorized: false,
          timeout: 30000,
        }, upstream => {
          const status = range ? 206 : 200;
          const respHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Accept-Ranges': 'bytes',
          };
          if (upstream.headers['content-range']) respHeaders['Content-Range'] = upstream.headers['content-range'];
          if (upstream.headers['content-length']) respHeaders['Content-Length'] = upstream.headers['content-length'];
          if (upstream.headers['content-type']) respHeaders['Content-Type'] = upstream.headers['content-type'];
          else respHeaders['Content-Type'] = 'video/mp4';
          res.writeHead(status, respHeaders);
          upstream.pipe(res);
        }).on('error', () => {
          if (!res.headersSent) res.writeHead(502);
          res.end('Proxy error');
        });
      }

    // ==================== API: RANDOM (javtiful) ====================
    } else if (pathname === '/api/random') {
      (async () => {
        try {
          // Fetch subscriptions list
          const listUrl = `https://javtiful.com/en/collections/subscriptions`;
          const cookieStr = fs.readFileSync(path.join(__dirname, '.javtiful_cookies.txt'), 'utf8').trim();
          const html = await fetchText(listUrl, HOST + '/', { 'Cookie': cookieStr });
          // Parse video paths
          const paths = [...html.matchAll(/href="(\/(?:zh\/)?video\/\d+\/[^"]+)"/g)].map(m => m[1]);
          const unique = [...new Set(paths)];
          if (!unique.length) return sendJSON(res, { success: false, error: 'No videos found' });
          // Pick random
          const randomPath = unique[Math.floor(Math.random() * unique.length)];
          // Get stream URL
          const detailUrl = `http://localhost:${PORT}/api/video-detail?path=${encodeURIComponent(randomPath)}&site=javtiful`;
          const detailResp = await new Promise((resolve, reject) => {
            http.get(detailUrl, r => { const c = []; r.on('data', d => c.push(d)); r.on('end', () => { try { resolve(JSON.parse(Buffer.concat(c).toString())); } catch { resolve(null); } }); }).on('error', reject);
          });
          if (detailResp && detailResp.streamUrl) {
            sendJSON(res, { success: true, path: randomPath, title: detailResp.title, streamUrl: detailResp.streamUrl, proxiedStreamUrl: detailResp.proxiedStreamUrl });
          } else {
            sendJSON(res, { success: false, error: 'Cannot get stream' });
          }
        } catch (e) { sendJSON(res, { success: false, error: e.message }); }
      })();

    // ==================== API: SITES ====================
    } else if (pathname === '/api/sites') {
      return sendJSON(res, {
        success: true,
        sites: Object.fromEntries(Object.entries(SITES).map(([k, v]) => [
          k, { name: k === 'javhdz' ? 'JavHDz' : k === 'vlxx' ? 'VLXX' : k === 'quatvn' ? 'QuatVN' : k === 'sexbjcam' ? 'SexBJCam' : k === 'javtrailers' ? 'JavTrailers' : k === 'javtiful' ? 'JavTiful' : k === '18tube' ? '18Tube' : k, base: v.base }
        ]))
      });

    // ==================== FAVORITES API ====================
    } else if (pathname === '/api/favorites') {
      if (req.method === 'POST') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data.action === 'toggle') {
              let favs = loadFavorites();
              const key = data.site + ':' + data.path;
              const idx = favs.findIndex(f => f.key === key);
              if (idx > -1) { favs.splice(idx, 1); } else { favs.push({ key, site: data.site, path: data.path, title: data.title, thumbnail: data.thumbnail }); }
              saveFavorites(favs);
              return sendJSON(res, { success: true, favorited: idx === -1, count: favs.length });
            }
            if (data.action === 'list') {
              return sendJSON(res, { success: true, favorites: loadFavorites() });
            }
          } catch (e) { sendJSON(res, { success: false, error: e.message }, 400); }
        });
      } else {
        return sendJSON(res, { success: true, favorites: loadFavorites() });
      }

    // ==================== STATIC FILES ====================
    } else {
      let fp = pathname === '/' ? '/index.html' : pathname;
      serveStatic(res, path.join(__dirname, 'public', fp));
    }
  } catch (error) {
    console.error('[ERROR]', error.message);
    if (!res.headersSent) sendJSON(res, { success: false, error: error.message }, 500);
  }
});

// Cache maintenance
setInterval(() => {
  const now = Date.now();
  for (const [url, entry] of playlistCache) { if (now - entry.ts > PLAYLIST_TTL) playlistCache.delete(url); }
  for (const [key, entry] of detailCache) { if (now - entry.ts > 300000) detailCache.delete(key); }
  try {
    let expired = 0, released = 0;
    for (const f of fs.readdirSync(CACHE_DIR)) {
      const fp = path.join(CACHE_DIR, f);
      const s = fs.statSync(fp);
      if (now - s.mtimeMs > SEGMENT_TTL) { fs.unlinkSync(fp); expired++; released += s.size; }
    }
    if (expired) console.log(`[CACHE] Cleaned ${expired} files, released ${(released/1e6).toFixed(1)}MB`);
  } catch {}
}, 30 * 60 * 1000);

server.listen(PORT, '0.0.0.0', () => {
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║     Netflix-Style Proxy Server 🎬         ║');
  console.log(`║     Local: http://localhost:${PORT}          ║`);
  console.log(`║     Cache: ${(MAX_DISK_CACHE/1e9).toFixed(1)}GB · KeepAlive ON     ║`);
  console.log('╚═══════════════════════════════════════════╝');
});

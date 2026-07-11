# JavHDz Local Server

## Chạy server

```bash
cd ~/javhdz
node server.js
# → http://localhost:3000
```

## Sites hỗ trợ

| Site | Ghi chú |
|---|---|
| JavHDz | Cơ bản |
| VLXX | Cơ bản |
| SexBJCam | Embed iframe |
| JavTrailers | Cần Warp (SOCKS5) nếu ISP chặn |
| JavTiful | Cần Warp + cookies để dùng Feed |

> **QuạtVN** đã ngừng hoạt động (`quatvn.lol` NXDOMAIN) — đã xoá khỏi danh sách.

## ISP block bypass (JavTrailers, JavTiful)

Dùng Cloudflare Warp proxy mode:

```bash
warp-cli disconnect
warp-cli mode proxy
warp-cli proxy port 1080
warp-cli connect
```

Server tự động route request qua SOCKS5 `127.0.0.1:1080`.

## JavTiful account

Cookies trong `.javtiful_cookies.txt` (đã có sẵn). Dùng để:
- **Feed** (sidebar → 📺 Feed) — video từ subscriptions
- Xem video (R2 signed URL)

## API endpoints

| Endpoint | Mô tả |
|---|---|
| `GET /api/videos?site=&page=&category=&search=` | Danh sách video |
| `GET /api/video-detail?path=&site=` | Chi tiết + stream URL |
| `GET /api/favorites` | Danh sách yêu thích |
| `POST /api/favorites` | `{action:"toggle", site, path, title, thumbnail}` |
| `GET /api/proxy/pl.m3u8?url=&s=` | Proxy HLS playlist |
| `GET /api/proxy/seg.ts?url=&pl=&s=` | Proxy HLS segment |
| `GET /api/proxy/image?url=&site=` | Proxy ảnh thumbnail |
| `GET /api/proxy/javtiful.mp4?url=` | Proxy MP4 (có cache) |

## Cache

- Thư mục `.video_cache/` — HLS segments, tối đa 20GB, LRU
- Cache manual: bấm **⬇ Cache** trong player → force download segments
- Xoá cache: bấm **🗑 Cache** hoặc `rm -rf .video_cache/`

## Favorites (đồng bộ)

Lưu trong `favorites.json` (server-side). Đồng bộ giữa các thiết bị khi cùng server.
- ♡ trên card / ♥ trong player → thêm/bỏ
- **♥ Random** trên navbar → random từ danh sách yêu thích
- **♥ Tiếp** trong player → next random từ yêu thích

## Config

- `PORT` — mặc định 3000
- Cache 20GB, segment TTL 3h
- Playlist TTL 5 phút

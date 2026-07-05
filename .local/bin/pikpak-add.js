#!/usr/bin/env node
// pikpak-add.js — Thêm magnet vào PikPak bằng refresh token
const https = require('https');
const fs = require('fs');
const path = require('path');

const TOKEN_FILE = path.join(process.env.HOME, '.pikpak_token.json');
const CLIENT_ID = 'YNx4sVwY';
const CLIENT_SECRET = 'Rg3kS3hB';

function post(url, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const d = JSON.stringify(data);
    const req = https.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers }
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { resolve(body); }
      });
    });
    req.on('error', reject);
    req.write(d);
    req.end();
  });
}

async function refreshToken(refreshToken) {
  const r = await post('https://user.mypikpak.com/v1/auth/token', {
    client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
    grant_type: 'refresh_token', refresh_token: refreshToken
  });
  return r;
}

async function offlineDownload(accessToken, magnet) {
  const r = await post('https://api-drive.mypikpak.com/drive/v1/files', {
    kind: 'drive#file', upload_type: 'UPLOAD_TYPE_URL',
    url: { url: magnet }
  }, { Authorization: 'Bearer ' + accessToken });
  return r;
}

(async () => {
  const magnet = process.argv[2];
  if (!magnet) { console.error('Usage: pikpak-add.js MAGNET_URL'); process.exit(1); }

  // Đọc token
  let token;
  try { token = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')); }
  catch { console.error('❌ Chưa login. Chạy: pikpak-login'); process.exit(1); }

  // Refresh token
  console.log('🔄 Refreshing token...');
  const fresh = await refreshToken(token.refresh_token);
  if (!fresh.access_token) {
    console.error('❌ Token expired. Chạy lại: pikpak-login');
    process.exit(1);
  }

  // Lưu token mới
  const newToken = {
    access_token: fresh.access_token,
    refresh_token: fresh.refresh_token || token.refresh_token,
    email: token.email
  };
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(newToken, null, 2));

  // Add magnet
  console.log('📤 Adding to PikPak...');
  const result = await offlineDownload(fresh.access_token, magnet);

  if (result.file && result.file.name) {
    console.log('✅ Added:', result.file.name);
  } else if (result.task && result.task.name) {
    console.log('✅ Task created:', result.task.name);
  } else {
    console.log('❌ Error:', JSON.stringify(result).slice(0, 200));
  }
})().catch(e => console.error('❌', e.message));

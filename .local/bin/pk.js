#!/usr/bin/env node
const https = require('https');
const { execSync } = require('child_process');

const code = process.argv[2];
if (!code) { console.error('Usage: pk JAV-CODE'); process.exit(1); }

// Search + mở tab Brave
https.get('https://sukebei.nyaa.si/?f=0&c=0_0&q=' + encodeURIComponent(code), { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    const rows = [...d.matchAll(/<tr class="(default|success|danger)">[\s\S]*?<a href="(magnet:\?[^"]+)"[^>]*>[\s\S]*?<td class="text-center">(\d+)<[\s\S]*?<td class="text-center">(\d+)<\/td>/g)];
    if (!rows.length) { console.log('❌ No torrents'); return; }
    rows.sort((a, b) => parseInt(b[3]) - parseInt(a[3]));
    const magnet = rows[0][2];
    const seeders = rows[0][3];
    console.log(`🏆 ${code} — ${seeders} seeders`);
    
    // Mở Brave với URL sukebei + code (PikPak button sẽ hiện)
    execSync(`brave --new-tab "https://sukebei.nyaa.si/?f=0&c=0_0&q=${encodeURIComponent(code)}"`, { timeout: 5000, detached: true });
    console.log('✅ Mở tab sukebei + PikPak button!');
  });
});

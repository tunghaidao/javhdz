#!/usr/bin/env node
// sukebei-search.js — Tìm torrent best seeder, copy magnet
const https = require('https');
const { execSync } = require('child_process');

const code = process.argv[2];
const copyToClipboard = process.argv[3] === '--copy';

if (!code) { console.error('Usage: sukebei-search JAV-CODE [--copy]'); process.exit(1); }

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

(async () => {
  const html = await fetch('https://sukebei.nyaa.si/?f=0&c=0_0&q=' + encodeURIComponent(code));
  const rows = [...html.matchAll(/<tr class="(default|success|danger)">[\s\S]*?<a href="(magnet:\?[^"]+)"[^>]*>[\s\S]*?<td class="text-center">(\d+)<[\s\S]*?<td class="text-center">(\d+)<\/td>/g)];

  if (!rows.length) {
    console.log('FAIL: No torrents found');
    return;
  }

  rows.sort((a, b) => parseInt(b[3]) - parseInt(a[3]));
  const magnet = rows[0][2];
  const seeders = rows[0][3];

  console.log('SUCCESS:' + seeders + ':' + magnet);
})().catch(e => console.error('FAIL:' + e.message));

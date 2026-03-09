#!/usr/bin/env node
/**
 * Converts all homepage PNG images to WebP and generates blur placeholders.
 *
 * Usage: node scripts/optimize-images.js
 *
 * Run this after replacing any image in apps/web/public/
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'apps', 'web', 'public');
const IMAGES = [
  'hero-main', 'hero-side',
  'gallery-01', 'gallery-03', 'gallery-04', 'gallery-05', 'gallery-06',
];

(async () => {
  console.log('=== Optimizing images ===\n');

  const blurMap = {};

  for (const name of IMAGES) {
    const png = path.join(DIR, `${name}.png`);
    if (!fs.existsSync(png)) {
      console.log(`⚠ ${name}.png not found, skipping`);
      continue;
    }

    // 1. Convert to WebP
    const webp = path.join(DIR, `${name}.webp`);
    await sharp(png).webp({ quality: 85 }).toFile(webp);
    const s1 = fs.statSync(png).size;
    const s2 = fs.statSync(webp).size;
    console.log(`${name}: ${(s1/1024).toFixed(0)}KB → ${(s2/1024).toFixed(0)}KB (-${((1-s2/s1)*100).toFixed(0)}%)`);

    // 2. Generate blur placeholder
    const buf = await sharp(png).resize(20).blur(2).webp({ quality: 20 }).toBuffer();
    blurMap[name] = `data:image/webp;base64,${buf.toString('base64')}`;
  }

  console.log('\n=== Blur placeholders (copy into HomePage.tsx BLUR constant) ===\n');
  console.log('const BLUR: Record<string, string> = {');
  for (const [k, v] of Object.entries(blurMap)) {
    console.log(`  '${k}': '${v}',`);
  }
  console.log('};');
  console.log('\nDone!');
})();

#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const extensionDir = path.join(rootDir, 'extension');
const distDir = path.join(rootDir, 'dist');

console.log('🚀 Starting Haptix Chrome Extension Packaging...');

// 1. Validate Manifest V3
const manifestPath = path.join(extensionDir, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error('❌ Error: manifest.json not found in extension directory!');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.manifest_version !== 3) {
  console.error(`❌ Error: Expected manifest_version 3, found ${manifest.manifest_version}`);
  process.exit(1);
}

const version = manifest.version || '1.0.0';
console.log(`✅ Manifest V3 validated. Extension: ${manifest.name} v${version}`);

// 2. Check Icons
const requiredIcons = ['16', '48', '128'];
for (const size of requiredIcons) {
  const iconRel = manifest.icons?.[size] || `icons/icon${size}.png`;
  const iconPath = path.join(extensionDir, iconRel);
  if (!fs.existsSync(iconPath)) {
    console.error(`❌ Error: Required icon missing: ${iconRel}`);
    process.exit(1);
  }
}
console.log('✅ Required icons verified (16px, 48px, 128px).');

// 3. Ensure destination directory exists
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

const zipFileName = `haptix-extension-v${version}.zip`;
const zipFilePath = path.join(distDir, zipFileName);

if (fs.existsSync(zipFilePath)) {
  fs.unlinkSync(zipFilePath);
}

// 4. Create ZIP package using zip command
console.log(`📦 Packaging ${zipFileName}...`);
try {
  // Zip extension directory contents, excluding .DS_Store and git metadata
  execSync(
    `cd "${extensionDir}" && zip -r "${zipFilePath}" . -x "*.DS_Store" "*__MACOSX*" "*.git*"`,
    { stdio: 'inherit' }
  );

  const stats = fs.statSync(zipFilePath);
  const sizeKb = (stats.size / 1024).toFixed(1);
  console.log(`\n🎉 Successfully packaged Chrome Extension:`);
  console.log(`   File: ${zipFilePath}`);
  console.log(`   Size: ${sizeKb} KB`);
  console.log(`\nReady for Chrome Web Store Developer Dashboard upload!`);
} catch (err) {
  console.error('❌ Error creating extension zip package:', err);
  process.exit(1);
}

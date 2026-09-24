import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_ASSETS = ['index.html', 'script.js', 'style.css', 'mobile-login.html'];
export const ASSET_DIRECTORIES = ['assets', 'efficiency', 'inspection-logs', 'maintenance', 'mobile', 'mobile-app'];
const EXTENSIONS = new Set(['.html', '.js', '.css', '.json', '.png', '.jpg', '.jpeg', '.svg', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.xlsx', '.pdf']);
// Superseded browser assets: source and historical tests remain in the repository.
export const RETIRED_ASSETS = new Set([
  'mobile-app/mobile-runtime-v13.js',
  'maintenance/cofiring-detail-compact-v5-r1.js',
  'maintenance/morning-meeting-organic-silo-dataparc.js',
  'maintenance/morning-meeting-organic-silo-dataparc.css',
  'maintenance/cofiring-shared-settings-horizontal-v2.js',
  'maintenance/cofiring-detail-compact-v4.css',
  'maintenance/cofiring-organic-excel-auto-v1.js',
  'maintenance/cofiring-organic-storage.js',
  'maintenance/cofiring-draft.js',
  'maintenance/cofiring-section-header-align-v1.css',
  'maintenance/cofiring-detail-redesign-v6.js',
  'maintenance/cofiring-shared-settings-horizontal-v3.css',
  'maintenance/cofiring-detail-compact-v5-r1.css',
  'maintenance/cofiring-manure-storage.js',
  'maintenance/cofiring-shared-settings-horizontal-v1.css',
  'maintenance/cofiring-shared-settings-horizontal-v1.js',
  'maintenance/cofiring-detail-compact-v2.css',
  'maintenance/cofiring-detail-compact-v3.css',
  'maintenance/cofiring-shared-settings-horizontal-v2.css',
  'maintenance/morning-meeting-cofiring-coal-review-popup-v4.js',
  'maintenance/cofiring-detail-redesign-v6-r1.js',
  'maintenance/cofiring-shared-settings-horizontal-v3.js',
  'maintenance/cofiring-draft.css'
]);

export async function collectWebAssets(root) {
  const files = [];
  async function visit(relative) {
    const full = path.join(root, relative);
    const stat = await fs.lstat(full);
    if (stat.isSymbolicLink()) throw new Error(`Symbolic links are not web assets: ${relative}`);
    if (stat.isDirectory()) {
      for (const entry of (await fs.readdir(full)).sort()) {
        if (entry.startsWith('.') || entry === 'node_modules') continue;
        await visit(path.posix.join(relative, entry));
      }
    } else if (stat.isFile() && EXTENSIONS.has(path.extname(relative).toLowerCase()) &&
               !RETIRED_ASSETS.has(relative) && !/\.bak(?:\.|$)|before-|(?:^|\/)ois-session\.json$/.test(relative)) {
      files.push(relative);
    }
  }
  for (const name of [...ROOT_ASSETS, ...ASSET_DIRECTORIES]) await visit(name);
  return files.sort();
}

export async function buildWeb(root, output) {
  root = path.resolve(root); output = path.resolve(output);
  const relativeOutput = path.relative(root, output);
  if (!relativeOutput || ASSET_DIRECTORIES.some(dir => relativeOutput === dir || relativeOutput.startsWith(dir + path.sep))) {
    throw new Error('Output must be a new directory outside the source asset directories.');
  }
  const files = await collectWebAssets(root);
  const allowed = new Set(files);
  // Existing pages rely on extensionless Cloudflare Pages links.
  for (const name of files.filter(name => name.endsWith('.html'))) {
    const html = await fs.readFile(path.join(root, name), 'utf8');
    for (const match of html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/g)) {
      const raw = match[1].replaceAll('&amp;', '&');
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(raw)) continue;
      const pathname = raw.split(/[?#]/)[0];
      if (!pathname || pathname.startsWith('/api/')) continue;
      const target = path.posix.normalize(pathname.startsWith('/') ? pathname.slice(1) : path.posix.join(path.posix.dirname(name), pathname));
      if (![target, target + '.html', path.posix.join(target, 'index.html')].some(item => allowed.has(item))) {
        throw new Error(`Missing web asset from ${name}: ${pathname}`);
      }
    }
  }
  // Refuse to silently retire a file that becomes referenced again.
  for (const name of files.filter(name => /\.(?:js|css|html)$/.test(name))) {
    const content = await fs.readFile(path.join(root, name), 'utf8');
    for (const retired of RETIRED_ASSETS) {
      if (content.includes(path.posix.basename(retired))) throw new Error(`Retired asset is referenced by ${name}: ${retired}`);
    }
  }
  // Never delete or overwrite an existing destination.
  await fs.mkdir(output, { recursive: false });
  let bytes = 0;
  for (const name of files) {
    const destination = path.join(output, name);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(path.join(root, name), destination, 1);
    bytes += (await fs.stat(destination)).size;
  }
  return { directory: output, files: files.length, bytes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const args = process.argv.slice(2);
  if (args.length > 1 || (args[0] && !args[0].startsWith('--out='))) throw new Error('Usage: node scripts/build-web.mjs [--out=NEW_DIRECTORY]');
  const output = args[0] ? path.resolve(args[0].slice(6)) : path.join(root, 'web-dist');
  console.log(JSON.stringify(await buildWeb(root, output), null, 2));
}

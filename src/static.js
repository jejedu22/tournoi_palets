// Fichiers statiques (PWA, styles, scripts) servis depuis public/, chargés en mémoire au démarrage.
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../public/', import.meta.url));
const TYPES = {
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};
const TEXT = new Set(['.css', '.js', '.html', '.webmanifest']);

const raw = new Map(readdirSync(DIR).filter((f) => TYPES[extname(f)]).map((f) => [f, readFileSync(join(DIR, f))]));

// Version = empreinte du contenu : change dès qu'un fichier change, ce qui renouvelle les caches.
const hash = createHash('sha1');
for (const [name, buf] of [...raw].sort(([a], [b]) => a.localeCompare(b))) hash.update(name).update(buf);
export const ASSET_VERSION = hash.digest('hex').slice(0, 10);

const files = new Map([...raw].map(([name, buf]) => {
  const ext = extname(name);
  const body = TEXT.has(ext) ? Buffer.from(buf.toString('utf8').replaceAll('__VERSION__', ASSET_VERSION)) : buf;
  return [name, { body, type: TYPES[ext] }];
}));

/** Fichier statique par nom exact (aucun chemin : pas de traversée possible). */
export const getStatic = (name) => files.get(name) ?? null;

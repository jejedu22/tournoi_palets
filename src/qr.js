// QR code en SVG, généré côté serveur avec qrcode-generator (voir src/vendor/README.md).
import { createRequire } from 'node:module';

const qrcode = createRequire(import.meta.url)('./vendor/qrcode-generator.cjs');

/** SVG autonome (aucun style en ligne, compatible avec la CSP). Niveau de correction M (~15 %). */
export function qrSvg(text, { label = 'QR code' } = {}) {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c},${r}h1v1h-1z`;
  }
  const m = 4; // marge blanche (« quiet zone ») de 4 modules exigée par la norme
  const size = n + 2 * m;
  const safeLabel = label.replace(/[<>&"]/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-m} ${-m} ${size} ${size}" class="qr" role="img" aria-label="${safeLabel}" shape-rendering="crispEdges">`
    + `<rect x="${-m}" y="${-m}" width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

// Améliorations progressives : l'application reste utilisable sans JavaScript.
'use strict';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

// Bouton « Installer l'appli » quand le navigateur le permet
let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  document.querySelectorAll('[data-install]').forEach((b) => { b.hidden = false; });
});
window.addEventListener('appinstalled', () => {
  document.querySelectorAll('[data-install]').forEach((b) => { b.hidden = true; });
});

document.addEventListener('click', (e) => {
  const install = e.target.closest('[data-install]');
  if (install && installEvent) {
    installEvent.prompt();
    installEvent.userChoice.finally(() => { installEvent = null; install.hidden = true; });
  }
  const close = e.target.closest('[data-dismiss]');
  if (close) close.closest('.flash')?.remove();
  if (e.target.closest('[data-reload]')) { e.preventDefault(); location.reload(); }
});

// Confirmation des actions destructrices
document.addEventListener('submit', (e) => {
  const msg = e.target.dataset.confirm;
  if (msg && !window.confirm(msg)) e.preventDefault();
});

// Saisie des scores : tout sélectionner au focus
document.addEventListener('focusin', (e) => {
  if (e.target.matches('.score-form input')) e.target.select();
});

// Aperçu en direct du format, sur le formulaire de création
const form = document.querySelector('[data-tournament-form]');
if (form) {
  const out = form.querySelector('[data-preview]');
  const sizes = (n, p) => Array.from({ length: p }, (_, i) => Math.floor(n / p) + (i < n % p ? 1 : 0));
  const roundName = (m) => ({ 1: 'la finale', 2: 'demi-finales', 4: 'quarts de finale', 8: 'huitièmes de finale', 16: 'seizièmes de finale' }[m] || `tour de ${m * 2}`);
  const update = () => {
    const n = parseInt(form.nb_teams.value, 10);
    const p = parseInt(form.nb_pools.value, 10);
    const k = parseInt(form.querySelector('[name=qualifiers_per_pool]:checked')?.value, 10);
    const fill = form.querySelector('[name=fill_mode]:checked')?.value;
    const cons = form.consolante.checked;
    const items = [];
    let error = null;
    if (!(n >= 2) || !(p >= 1)) error = 'Renseignez le nombre d’équipes et de poules.';
    else if (n < 2 * p) error = 'Il faut au moins 2 équipes par poule.';
    if (!error) {
      const s = sizes(n, p);
      const min = Math.min(...s), max = Math.max(...s);
      const direct = k * p;
      let size = 1; while (size < direct) size *= 2;
      const extra = fill === 'best' ? size - direct : 0;
      const byes = size - direct - extra;
      const eliminated = n - direct - extra;
      if (k >= min) error = `Les plus petites poules ont ${min} équipes : qualifiez-en au plus ${min - 1} par poule.`;
      else if (direct < 2) error = 'Il faut au moins 2 qualifiés : augmentez le nombre de qualifiés par poule.';
      else if (size > 64) error = 'Tableau final trop grand (64 équipes maximum).';
      else if (extra > p) error = `Il faudrait repêcher ${extra} équipes pour ${p} poule(s) : choisissez plutôt les exemptions.`;
      else if (cons && eliminated < 2) error = 'Consolante impossible : il faut au moins 2 équipes éliminées en poule.';
      else {
        const matches = s.reduce((acc, x) => acc + (x * (x - 1)) / 2, 0);
        items.push(`${p} poule${p > 1 ? 's' : ''} de ${min === max ? min : `${min} à ${max}`} équipes · ${matches} matchs de poule`);
        items.push(`${k === 1 ? 'Le 1er' : `Les ${k} premiers`} de chaque poule qualifiés → ${direct} équipes`);
        if (extra) items.push(`+ ${extra} meilleur${extra > 1 ? 's' : ''} ${k + 1}ᵉ repêché${extra > 1 ? 's' : ''} pour compléter le tableau`);
        if (byes) items.push(`${byes} tête${byes > 1 ? 's' : ''} de série exemptée${byes > 1 ? 's' : ''} du premier tour`);
        items.push(`Phase finale à partir des ${roundName(size / 2)} (tableau de ${size})`.replace('des la finale', 'de la finale'));
        if (cons) items.push(`${eliminated} équipes en consolante`);
      }
    }
    out.classList.toggle('bad', Boolean(error));
    out.replaceChildren();
    const title = document.createElement('strong');
    title.textContent = error ? '⚠️ ' + error : '🎯 Votre format';
    out.append(title);
    if (!error) {
      const ul = document.createElement('ul');
      for (const it of items) { const li = document.createElement('li'); li.textContent = it; ul.append(li); }
      out.append(ul);
    }
  };
  form.addEventListener('input', update);
  update();
}

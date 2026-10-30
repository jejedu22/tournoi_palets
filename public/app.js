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
  const update = () => {
    const n = parseInt(form.nb_teams.value, 10);
    const p = parseInt(form.nb_pools.value, 10);
    const rounds = parseInt(form.querySelector('[name=finals_rounds]:checked')?.value, 10);
    const cons = form.consolante.checked;
    const items = [];
    let error = null;
    if (!(n >= 2) || !(p >= 1)) error = 'Renseignez le nombre d’équipes et de poules.';
    else if (n < 2 * p) error = 'Il faut au moins 2 équipes par poule.';
    else if (2 ** rounds > n) error = `Cette phase finale demande ${2 ** rounds} équipes qualifiées : il n’y en a que ${n}.`;
    if (!error) {
      const s = sizes(n, p);
      const q = 2 ** rounds;
      const perPool = Math.floor(q / p);
      const extra = q - perPool * p;
      const matches = s.reduce((acc, k) => acc + (k * (k - 1)) / 2, 0);
      const min = Math.min(...s), max = Math.max(...s);
      if (extra > s.filter((k) => k > perPool).length) error = 'Pas assez d’équipes pour compléter le tableau : réduisez la phase finale.';
      else if (cons && n - q < 2) error = 'Consolante impossible : il faut au moins 2 équipes éliminées en poule.';
      else {
        items.push(`${p} poule${p > 1 ? 's' : ''} de ${min === max ? min : `${min} à ${max}`} équipes`);
        items.push(`${matches} matchs de poule`);
        items.push(`${perPool} qualifié${perPool > 1 ? 's' : ''} par poule${extra ? ` + ${extra} meilleur${extra > 1 ? 's' : ''} ${perPool + 1}ᵉ` : ''} → ${q} en phase finale`);
        if (cons) items.push(`${n - q} équipes en consolante`);
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

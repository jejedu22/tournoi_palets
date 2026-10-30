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
    title.textContent = error || 'Format du tournoi';
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

// Saisie groupée des scores : compte les matchs modifiés, signale les matchs nuls,
// et prévient avant de quitter la page avec des scores non enregistrés.
let unsaved = false;
document.querySelectorAll('form[data-scores]').forEach((scores) => {
  const bar = scores.querySelector('.savebar');
  const text = scores.querySelector('[data-savebar-text]');
  const initialText = text.textContent;
  const refresh = () => {
    let changed = 0, draws = 0;
    scores.querySelectorAll('[data-match]').forEach((m) => {
      const [a, b] = m.querySelectorAll('input');
      const row = m.closest('.match, .bm');
      const isChanged = a.value !== a.defaultValue || b.value !== b.defaultValue;
      const filled = a.value !== '' && b.value !== '';
      const isDraw = isChanged && filled && a.value === b.value;
      if (isChanged && filled && !isDraw) changed++;
      if (isDraw) draws++;
      row?.classList.toggle('dirty', isChanged);
      row?.classList.toggle('draw', isDraw);
    });
    bar.classList.toggle('has-changes', changed + draws > 0);
    const parts = [];
    if (changed) parts.push(`${changed} score${changed > 1 ? 's' : ''} à enregistrer`);
    if (draws) parts.push(`${draws} match${draws > 1 ? 's' : ''} nul${draws > 1 ? 's' : ''} : impossible`);
    text.textContent = parts.length ? parts.join(' · ') : initialText;
    unsaved = [...document.querySelectorAll('form[data-scores] .dirty')].length > 0;
  };
  scores.addEventListener('input', refresh);
  scores.addEventListener('submit', () => { unsaved = false; });
});
window.addEventListener('beforeunload', (e) => {
  if (unsaved) { e.preventDefault(); e.returnValue = ''; }
});

// Saisie des équipes en liste : compteur de lignes
document.querySelectorAll('[data-team-list]').forEach((area) => {
  const hint = area.form.querySelector('[data-team-count]');
  const expected = Number(area.dataset.expected);
  const update = () => {
    const n = area.value.split(/\r?\n/).filter((l) => l.trim()).length;
    hint.textContent = n > expected
      ? `${n} lignes pour ${expected} équipes : retirez-en ${n - expected}.`
      : `${n} / ${expected} équipes${n < expected ? ` — les ${expected - n} suivantes gardent leur nom actuel` : ' ✓'}.`;
    hint.classList.toggle('bad', n > expected);
  };
  area.addEventListener('input', update);
});

// Copier dans le presse-papiers
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  const field = document.querySelector(btn.dataset.copy);
  const label = btn.textContent;
  try {
    await navigator.clipboard.writeText(field.value);
    btn.textContent = 'Copié';
  } catch {
    field.select();
    btn.textContent = 'Ctrl+C pour copier';
  }
  setTimeout(() => { btn.textContent = label; }, 2000);
});

// Page publique : rechargement automatique quand un score change (empreinte de l'état du tournoi)
const live = document.querySelector('main[data-live]');
if (live) {
  const key = `scroll:${location.pathname}`;
  try {
    const y = sessionStorage.getItem(key);
    if (y !== null) { sessionStorage.removeItem(key); window.scrollTo(0, Number(y)); }
  } catch { /* stockage indisponible */ }
  const status = document.querySelector('[data-live-status]');
  const text = document.querySelector('[data-live-text]');
  const time = () => new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  text.textContent = `En direct · à jour à ${time()}`;
  const check = async () => {
    if (document.visibilityState !== 'visible') return;
    try {
      const res = await fetch(live.dataset.live, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const version = (await res.text()).trim();
      status.classList.remove('stale');
      if (version !== live.dataset.version) {
        try { sessionStorage.setItem(key, String(window.scrollY)); } catch { /* ignoré */ }
        location.reload();
        return;
      }
      text.textContent = `En direct · à jour à ${time()}`;
    } catch {
      status.classList.add('stale');
      text.textContent = 'Connexion perdue · nouvel essai dans un instant…';
    }
  };
  setInterval(check, 20000);
  document.addEventListener('visibilitychange', check);
}

// Page publique : « mon équipe » mise en avant, choix mémorisé sur l'appareil
const picker = document.querySelector('[data-my-team]');
if (picker) {
  const box = document.querySelector('[data-my-team-box]');
  const only = document.querySelector('[data-only-mine]');
  const teamKey = `palets-team-${picker.dataset.myTeam}`;
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* ignoré */ } },
  };
  const apply = () => {
    const id = picker.value;
    document.querySelectorAll('.mine').forEach((el) => el.classList.remove('mine'));
    if (id) {
      document.querySelectorAll(`[data-team="${CSS.escape(id)}"], [data-teams~="${CSS.escape(id)}"]`)
        .forEach((el) => el.classList.add('mine'));
    }
    only.disabled = !id;
    document.body.classList.toggle('only-mine', Boolean(id) && only.checked);
  };
  picker.value = store.get(teamKey) ?? '';
  if (picker.value === '') store.set(teamKey, null); // équipe disparue (liste modifiée)
  only.checked = store.get('palets-only-mine') === '1';
  box.hidden = false;
  picker.addEventListener('change', () => { store.set(teamKey, picker.value); apply(); });
  only.addEventListener('change', () => { store.set('palets-only-mine', only.checked ? '1' : null); apply(); });
  apply();
}

// Un lien vers une section repliée (onglet « Poules (terminées) », #poules…) la déplie
const openTarget = () => {
  const id = decodeURIComponent(location.hash.slice(1));
  const el = id ? document.getElementById(id) : null;
  const details = el?.closest('details');
  if (details && !details.open) { details.open = true; el.scrollIntoView(); }
};
window.addEventListener('hashchange', openTarget);
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#"]');
  if (a && a.getAttribute('href') === location.hash) setTimeout(openTarget); // même ancre : pas de hashchange
});
openTarget();

// Affiche : bouton d'impression
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-print]')) window.print();
});

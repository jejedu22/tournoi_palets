import { html, raw } from './html.js';
import { FILL_MODES, MAX_PER_POOL, roundName, tournamentFormat } from './logic.js';
import { ASSET_VERSION } from './static.js';

const asset = (name) => `/static/${name}?v=${ASSET_VERSION}`;
const csrf = (s) => html`<input type="hidden" name="_csrf" value="${s.csrf}">`;
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
const initial = (name) => (name || '?').trim().charAt(0).toUpperCase();

const STATUS = { setup: 'Inscriptions', pools: 'Poules', finals: 'Phases finales' };
const statusSticker = (status) => html`<span class="sticker s-${status}">${STATUS[status]}</span>`;

const formatDate = (iso) => {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso
    : d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
};

export function layout({ title, session, flash, body, nav }) {
  const home = session?.role === 'superadmin' ? '/associations' : '/tournois';
  return html`<!doctype html>
<html lang="fr"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${title} · Palets Bretons</title>
<meta name="description" content="Gestion de tournois de palets bretons : poules, phases finales, consolante.">
<meta name="theme-color" content="#ffd23f">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="${asset('icon.svg')}" type="image/svg+xml">
<link rel="apple-touch-icon" href="${asset('apple-touch-icon.png')}">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Palets">
<link rel="stylesheet" href="${asset('app.css')}">
<script src="${asset('app.js')}" defer></script>
</head>
<body>
<header class="topbar">
  <a class="brand" href="${session ? home : '/'}"><img src="${asset('icon.svg')}" alt="" width="40" height="40">
    <span class="wordmark">Palets</span><span class="sticker tilt">Breizh</span></a>
  ${session ? html`<nav aria-label="Navigation principale">
    <a href="${home}" ${raw(nav === 'home' ? 'aria-current="page"' : '')}>${session.role === 'superadmin' ? '🏛️ Associations' : '🏆 Tournois'}</a>
  </nav>` : ''}
  <span class="spacer"></span>
  <button type="button" class="btn btn-ghost btn-sm install" data-install hidden>📲 Installer l'appli</button>
  ${session ? html`
    <span class="who"><span class="avatar" aria-hidden="true">${initial(session.name)}</span><span class="name">${session.name}</span></span>
    <form method="post" action="/logout">${csrf(session)}<button class="btn btn-ghost btn-sm" aria-label="Déconnexion"><span aria-hidden="true">🚪</span><span class="label">Déconnexion</span></button></form>` : ''}
</header>
<div class="stripes" aria-hidden="true"></div>
<main>
${flash ? html`<div class="flash ${flash.type}" role="${flash.type === 'err' ? 'alert' : 'status'}">
  <span aria-hidden="true">${flash.type === 'err' ? '😬' : '🎉'}</span><p>${flash.message}</p>
  <button type="button" data-dismiss aria-label="Fermer le message">✕</button></div>` : ''}
${body}
</main>
<footer class="page-footer">Fait avec 💛 pour les planches bretonnes · Kenavo !</footer>
</body></html>`;
}

export function errorPage({ session, status, title, message }) {
  return layout({
    title, session,
    body: html`<section class="card empty"><div class="big-emoji" aria-hidden="true">${status === 404 ? '🕳️' : '🙅'}</div>
      <h1>${title}</h1>${message ? html`<p>${message}</p>` : ''}
      <p><a class="btn" href="/">Retour à l'accueil</a></p></section>`,
  });
}

export function authPage({ title, intro, action, fields, submit, flash }) {
  return layout({
    title, flash, session: null,
    body: html`<div class="narrow-wrap"><section class="card auth">
      <div class="big-emoji" aria-hidden="true">🥏</div>
      <h1><span class="hl">${title}</span></h1>${intro ? html`<p class="muted">${intro}</p>` : ''}
      <form method="post" action="${action}">
        ${fields.map((f) => html`<label for="${f.name}">${f.label}</label>
          <input id="${f.name}" name="${f.name}" type="${f.type || 'text'}" autocomplete="${f.autocomplete || 'on'}" ${raw(f.attrs || 'required')}>`)}
        <p><button class="btn-big">${submit} →</button></p>
      </form></section></div>`,
  });
}

// ---------- Super-administrateur ----------

export function associationsPage({ session, flash, associations }) {
  return layout({
    title: 'Associations', session, flash, nav: 'home',
    body: html`<h1>Les <span class="hl">associations</span> 🏛️</h1>
    <p class="muted">Créez une association, puis ajoutez-lui un ou plusieurs administrateurs : ils ne verront que ses tournois.</p>
    <div class="grid">
      <section class="card">
        <h2>➕ Nouvelle association</h2>
        <form method="post" action="/associations">${csrf(session)}
          <label for="name">Nom de l'association</label><input id="name" name="name" required maxlength="100" placeholder="Palet Club de Quimper">
          <p><button>Créer</button></p></form>
      </section>
      ${associations.map((a) => html`<a class="card tile" href="/associations/${a.id}">
        <h3>${a.name}</h3>
        <div class="row"><span class="chip">👤 ${plural(a.admins, 'admin')}</span><span class="chip">🏆 ${plural(a.tournaments, 'tournoi')}</span></div>
        ${a.admins ? '' : html`<span class="sticker">Sans administrateur</span>`}
      </a>`)}
    </div>
    ${associations.length ? '' : html`<p class="muted">Aucune association pour l'instant : créez la première ! 🚀</p>`}`,
  });
}

export function associationPage({ session, flash, association, admins }) {
  return layout({
    title: association.name, session, flash,
    body: html`<a class="back" href="/associations">← Associations</a>
    <h1><span class="hl">${association.name}</span></h1>
    <div class="grid">
      <section class="card">
        <h2>👥 Administrateurs</h2>
        ${admins.length ? html`<ul class="people">${admins.map((u) => html`<li>
          <span class="avatar" aria-hidden="true">${initial(u.name)}</span>
          <span class="grow"><strong>${u.name}</strong><br><span class="muted">${u.email}</span></span>
          <form method="post" action="/associations/${association.id}/admins/${u.id}/supprimer" data-confirm="Supprimer l'administrateur ${u.name} ?">${csrf(session)}
            <button class="btn-danger btn-sm" aria-label="Supprimer ${u.name}">Supprimer</button></form></li>`)}</ul>`
          : html`<p class="muted">Aucun administrateur : ajoutez-en un pour que l'association puisse créer ses tournois.</p>`}
      </section>
      <section class="card">
        <h2>➕ Ajouter un administrateur</h2>
        <form method="post" action="/associations/${association.id}/admins">${csrf(session)}
          <label for="aname">Nom</label><input id="aname" name="name" required maxlength="100" autocomplete="off">
          <label for="aemail">E-mail (identifiant)</label><input id="aemail" name="email" type="email" required autocomplete="off">
          <label for="apw">Mot de passe</label><input id="apw" name="password" type="password" required minlength="8" autocomplete="new-password">
          <p class="hint">8 caractères minimum. Communiquez-le à la personne, elle s'en servira pour se connecter.</p>
          <p><button>Ajouter</button></p></form>
      </section>
    </div>
    <details class="card danger"><summary>⚠️ Zone de danger</summary>
      <form method="post" action="/associations/${association.id}/supprimer" data-confirm="Supprimer l'association, ses administrateurs et tous ses tournois ? C'est définitif.">${csrf(session)}
        <p>Supprime l'association, ses administrateurs et <strong>tous ses tournois</strong>.</p>
        <button class="btn-danger">Supprimer l'association</button></form>
    </details>`,
  });
}

// ---------- Administrateur d'association ----------

export function tournamentsPage({ session, flash, association, tournaments }) {
  return layout({
    title: 'Mes tournois', session, flash, nav: 'home',
    body: html`<div class="hero">
      <div><h1>Les tournois <span class="hl">${association.name}</span></h1>
        <p class="muted">À la planche ! Créez un tournoi, tirez les poules au sort et suivez les scores en direct.</p></div>
      <a class="btn btn-yellow btn-big" href="/tournois/nouveau">➕ Nouveau tournoi</a>
    </div>
    ${tournaments.length ? html`<div class="grid">${tournaments.map((t) => html`<a class="card tile" href="/tournois/${t.id}">
      <div class="row">${statusSticker(t.status)}${t.date ? html`<span class="meta">📅 ${formatDate(t.date)}</span>` : ''}</div>
      <h3>${t.name}</h3>
      <div class="row"><span class="chip">👥 ${t.nb_teams} équipes</span><span class="chip">🎱 ${plural(t.nb_pools, 'poule')}</span>
        ${t.consolante ? html`<span class="chip">🤝 Consolante</span>` : ''}</div>
      ${t.total ? html`<div class="progress"><div class="progress-label"><span>Matchs joués</span><span>${t.played}/${t.total}</span></div>
        <progress max="${t.total}" value="${t.played}">${t.played}/${t.total}</progress></div>` : ''}
    </a>`)}</div>`
      : html`<section class="card empty"><div class="big-emoji" aria-hidden="true">🥏</div>
        <h2>Aucun tournoi pour l'instant</h2><p>Lancez le premier, ça prend une minute.</p>
        <p><a class="btn btn-big" href="/tournois/nouveau">Créer un tournoi</a></p></section>`}`,
  });
}

export function newTournamentPage({ session, flash, values = {} }) {
  const v = { nb_teams: 16, nb_pools: 4, qualifiers_per_pool: 2, fill_mode: 'best', ...values };
  return layout({
    title: 'Nouveau tournoi', session, flash,
    body: html`<a class="back" href="/tournois">← Mes tournois</a>
    <h1>Nouveau <span class="hl">tournoi</span> ✨</h1>
    <form class="card" method="post" action="/tournois" data-tournament-form>${csrf(session)}
      <div class="form-grid">
        <div><label for="name">Nom du tournoi</label><input id="name" name="name" required maxlength="120" value="${v.name || ''}" placeholder="Open de la Saint-Yves"></div>
        <div><label for="date">Date</label><input id="date" name="date" type="date" value="${v.date || ''}"></div>
        <div><label for="nb_teams">Nombre d'équipes</label><input id="nb_teams" name="nb_teams" type="number" inputmode="numeric" min="2" max="128" required value="${v.nb_teams}"></div>
        <div><label for="nb_pools">Nombre de poules</label><input id="nb_pools" name="nb_pools" type="number" inputmode="numeric" min="1" max="32" required value="${v.nb_pools}"></div>
      </div>
      <fieldset><legend>Qualifiés pour la phase finale, dans chaque poule</legend>
        <div class="choices">${Array.from({ length: MAX_PER_POOL }, (_, i) => i + 1).map((k) => html`<label class="choice">
          <input type="radio" name="qualifiers_per_pool" value="${k}" ${raw(Number(v.qualifiers_per_pool) === k ? 'checked' : '')}>
          <span>${k === 1 ? 'Le 1er' : `Les ${k} premiers`}<small>de chaque poule</small></span></label>`)}</div>
      </fieldset>
      <fieldset><legend>Si le tableau final n'est pas complet (6 qualifiés pour 8 places…)</legend>
        <div class="choices">${Object.entries(FILL_MODES).map(([mode, label]) => {
          const [verb, ...rest] = label.split(' ');
          return html`<label class="choice"><input type="radio" name="fill_mode" value="${mode}" ${raw(v.fill_mode === mode ? 'checked' : '')}>
            <span>${verb}<small>${rest.join(' ')}${mode === 'bye' ? ' au 1er tour' : ''}</small></span></label>`;
        })}</div>
      </fieldset>
      <label class="switch"><input type="checkbox" name="consolante" value="1" ${raw(v.consolante ? 'checked' : '')}>
        <span>Organiser une <strong>consolante</strong> avec les équipes éliminées en poule</span></label>
      <div class="preview" data-preview aria-live="polite"></div>
      <p><button class="btn-big">C'est parti ! 🚀</button></p>
    </form>`,
  });
}

function scoreForm(session, t, m, a, b) {
  return html`<form class="score-form" method="post" action="/tournois/${t.id}/matchs/${m.id}">${csrf(session)}
    <input type="number" inputmode="numeric" name="score1" min="0" max="99" required value="${m.score1 ?? ''}" aria-label="Score de ${a}">
    <span class="dash" aria-hidden="true">–</span>
    <input type="number" inputmode="numeric" name="score2" min="0" max="99" required value="${m.score2 ?? ''}" aria-label="Score de ${b}">
    <button aria-label="${m.score1 == null ? 'Valider' : 'Modifier'} le score ${a} contre ${b}">✓</button></form>`;
}

function bracketMatch(session, t, m, names) {
  const side = (id, score) => {
    const name = id ? names.get(id) : null;
    const cls = !name ? 'tbd' : m.winner_id && m.winner_id === id ? 'won' : '';
    return html`<div class="side ${cls}"><span>${name ?? (m.bye ? 'Exempt' : 'À venir')}</span><span>${m.score1 != null ? score : ''}</span></div>`;
  };
  return html`<div class="bm">${side(m.team1_id, m.score1)}${side(m.team2_id, m.score2)}
    ${m.bye || !m.team1_id || !m.team2_id ? ''
      : m.score1 == null ? scoreForm(session, t, m, names.get(m.team1_id), names.get(m.team2_id))
      : html`<details class="edit"><summary>✏️ Corriger</summary>${scoreForm(session, t, m, names.get(m.team1_id), names.get(m.team2_id))}</details>`}</div>`;
}

function bracketView(session, t, all, names) {
  const matches = all.filter((m) => !m.third);
  const third = all.find((m) => m.third);
  const rounds = [...new Set(matches.map((m) => m.round))].sort((x, y) => x - y);
  return html`<div class="bracket-wrap"><div class="bracket">${rounds.map((r) => {
    const ms = matches.filter((m) => m.round === r).sort((x, y) => x.pos - y.pos);
    return html`<div class="col"><h3>${roundName(ms.length)}</h3><div class="col-body">${ms.map((m) => bracketMatch(session, t, m, names))}</div></div>`;
  })}</div></div>
  ${third ? html`<div class="third"><h3>🥉 Petite finale</h3>${bracketMatch(session, t, third, names)}</div>` : ''}`;
}

export function tournamentPage({ session, flash, t, teams, matches, poolTables }) {
  const names = new Map(teams.map((x) => [x.id, x.name]));
  const poolMatches = matches.filter((m) => m.phase === 'pool');
  const main = matches.filter((m) => m.phase === 'main');
  const cons = matches.filter((m) => m.phase === 'consolante');
  const real = matches.filter((m) => !m.bye);
  const played = real.filter((m) => m.score1 != null).length;
  const poolsDone = poolMatches.length > 0 && poolMatches.every((m) => m.score1 != null);
  const finalOf = (ms) => ms.find((m) => !m.third && m.round === Math.max(...ms.map((x) => x.round)));
  const final = main.length ? finalOf(main) : null;
  const champion = final?.winner_id;
  const runnerUp = champion ? (final.team1_id === champion ? final.team2_id : final.team1_id) : null;
  const thirdPlace = main.find((m) => m.third)?.winner_id;
  const consChamp = cons.length ? finalOf(cons)?.winner_id : null;
  const format = tournamentFormat(t);
  const perPool = format.perPool;
  const firstRound = roundName(format.size / 2);
  const qualifLabel = `${perPool === 1 ? '1er' : `${perPool} premiers`} de poule${format.extra ? ` + ${format.extra} repêché${format.extra > 1 ? 's' : ''}` : ''}`;

  const stepIndex = champion ? 3 : { setup: 0, pools: 1, finals: 2 }[t.status];
  const steps = ['Inscriptions', 'Poules', 'Phases finales'];
  const tabs = [['equipes', '👥 Équipes'], ...(t.status !== 'setup' ? [['poules', '🎱 Poules']] : []),
    ...(main.length ? [['tableau', '🏆 Tableau']] : []), ...(cons.length ? [['consolante', '🤝 Consolante']] : [])];

  return layout({
    title: t.name, session, flash,
    body: html`<a class="back" href="/tournois">← Mes tournois</a>
    <section class="hero">
      <div>
        <div class="row">${statusSticker(t.status)}${t.date ? html`<span class="muted">📅 ${formatDate(t.date)}</span>` : ''}</div>
        <h1>${t.name}</h1>
        <div class="row"><span class="chip">👥 ${t.nb_teams} équipes</span><span class="chip">🎱 ${plural(t.nb_pools, 'poule')}</span>
          <span class="chip">✅ ${qualifLabel}</span><span class="chip">🏆 ${firstRound}</span>${t.consolante ? html`<span class="chip">🤝 Consolante</span>` : ''}</div>
      </div>
    </section>
    <ol class="steps" aria-label="Avancement du tournoi">${steps.map((s, i) => html`<li class="${i < stepIndex ? 'done' : i === stepIndex ? 'current' : ''}"
      ${raw(i === stepIndex ? 'aria-current="step"' : '')}>${s}</li>`)}</ol>
    ${real.length ? html`<div class="progress"><div class="progress-label"><span>Matchs joués</span><span>${played}/${real.length}</span></div>
      <progress max="${real.length}" value="${played}">${played}/${real.length}</progress></div>` : ''}

    ${champion ? html`<section class="card"><h2>🎉 Le podium</h2>
      <div class="podium">
        <div class="p2"><div class="who-won">${names.get(runnerUp)}</div><div class="step">🥈</div></div>
        <div class="p1"><div class="who-won">${names.get(champion)}</div><div class="step">🥇</div></div>
        <div class="p3"><div class="who-won">${thirdPlace ? names.get(thirdPlace) : '—'}</div><div class="step">🥉</div></div>
      </div>
      ${consChamp ? html`<p class="cons-winner">🤝 Vainqueur de la consolante : ${names.get(consChamp)}</p>` : ''}</section>` : ''}

    ${tabs.length > 1 ? html`<nav class="tabs" aria-label="Sections du tournoi">${tabs.map(([id, label]) => html`<a href="#${id}">${label}</a>`)}</nav>` : ''}

    <section id="equipes">
      ${t.status === 'setup' ? html`<div class="card">
        <h2>👥 Les équipes</h2>
        <p class="muted">Donnez un nom à chaque équipe, enregistrez, puis lancez le tirage au sort.</p>
        <form method="post" action="/tournois/${t.id}/equipes">${csrf(session)}
          <div class="form-grid">${teams.map((x, i) => html`<div><label for="team${x.id}">Équipe ${i + 1}</label>
            <input id="team${x.id}" name="team_${x.id}" value="${x.name}" required maxlength="80"></div>`)}</div>
          <p><button class="btn-ghost">💾 Enregistrer les noms</button></p></form>
        <form method="post" action="/tournois/${t.id}/poules">${csrf(session)}
          <button class="btn-yellow btn-big">🎲 Tirer au sort les poules</button></form>
      </div>` : html`<details class="card more"><summary>👥 Les équipes (renommer)</summary>
        <form method="post" action="/tournois/${t.id}/equipes">${csrf(session)}
          <div class="form-grid">${teams.map((x, i) => html`<div><label for="team${x.id}">Équipe ${i + 1}</label>
            <input id="team${x.id}" name="team_${x.id}" value="${x.name}" required maxlength="80"></div>`)}</div>
          <p><button class="btn-ghost">💾 Enregistrer les noms</button></p></form></details>`}
    </section>

    ${t.status !== 'setup' ? html`<section id="poules"><h2>🎱 Phase de poules</h2>
      <p class="legend">★ qualifié directement pour la phase finale${format.extra
        ? ` · les ${format.extra} meilleur${format.extra > 1 ? 's' : ''} ${perPool + 1}ᵉ sont repêchés`
        : format.byes ? ` · ${format.byes} exempté${format.byes > 1 ? 's' : ''} du premier tour` : ''}</p>
      <div class="grid">${poolTables.map((p) => html`<article class="card">
        <div class="pool-head"><span class="letter c${p.pool % 6}" aria-hidden="true">${String.fromCharCode(65 + p.pool)}</span>
          <h3>Poule ${String.fromCharCode(65 + p.pool)}</h3></div>
        <table><thead><tr><th>#</th><th>Équipe</th><th class="n"><abbr title="Joués">J</abbr></th><th class="n"><abbr title="Victoires">V</abbr></th><th class="n">Diff</th></tr></thead><tbody>
          ${p.rows.map((r, i) => html`<tr class="${i < perPool ? 'q' : ''}"><td class="rank">${i + 1}</td><td class="name">${names.get(r.id)}</td>
            <td class="n">${r.played}</td><td class="n">${r.wins}</td><td class="n">${r.diff > 0 ? '+' : ''}${r.diff}</td></tr>`)}
        </tbody></table>
        <h3 class="visually-hidden">Matchs de la poule ${String.fromCharCode(65 + p.pool)}</h3>
        <ul class="matches">${p.matches.map((m) => {
          const a = names.get(m.team1_id), b = names.get(m.team2_id);
          return html`<li class="match ${m.score1 != null ? 'played' : ''}">
            <span class="t ${m.winner_id === m.team1_id ? 'win' : ''}">${a}</span>
            ${t.status === 'pools' ? scoreForm(session, t, m, a, b) : html`<span class="final-score">${m.score1} – ${m.score2}</span>`}
            <span class="t right ${m.winner_id === m.team2_id ? 'win' : ''}">${b}</span></li>`;
        })}</ul>
      </article>`)}</div>
      ${t.status === 'pools' ? html`<form class="card" method="post" action="/tournois/${t.id}/finales">${csrf(session)}
        <h3>Et après ?</h3>
        ${poolsDone ? html`<p>Toutes les poules sont terminées. Place au tableau final${t.consolante ? ' et à la consolante' : ''} !</p>`
          : html`<p class="muted">Les phases finales se débloquent quand tous les matchs de poule sont joués
            (${poolMatches.filter((m) => m.score1 == null).length} restant(s)).</p>`}
        <button class="btn-yellow btn-big" ${raw(poolsDone ? '' : 'disabled')}>🏆 Générer les phases finales</button></form>` : ''}
    </section>` : ''}

    ${main.length ? html`<section id="tableau"><h2>🏆 Phase finale</h2><div class="card">${bracketView(session, t, main, names)}</div></section>` : ''}
    ${cons.length ? html`<section id="consolante"><h2>🤝 Consolante</h2><div class="card">${bracketView(session, t, cons, names)}</div></section>` : ''}

    <details class="card danger"><summary>⚠️ Zone de danger</summary>
      <div class="row">
        ${t.status !== 'setup' ? html`<form method="post" action="/tournois/${t.id}/reinitialiser" data-confirm="Effacer le tirage et tous les scores ?">${csrf(session)}
          <button class="btn-ghost">↩️ Réinitialiser le tirage</button></form>` : ''}
        <form method="post" action="/tournois/${t.id}/supprimer" data-confirm="Supprimer définitivement ce tournoi ?">${csrf(session)}
          <button class="btn-danger">🗑️ Supprimer le tournoi</button></form>
      </div>
    </details>`,
  });
}

import { html, raw } from './html.js';
import { ROUND_OPTIONS, roundName } from './logic.js';

const CSS = `
:root{--bg:#f6f4ef;--card:#fff;--ink:#1d2a33;--muted:#667;--brand:#0b4f8a;--accent:#c9a227;--ok:#1f7a3f;--err:#b3261e;--line:#ddd8cc}
@media (prefers-color-scheme:dark){:root{--bg:#14181c;--card:#1d2328;--ink:#e8e6e1;--muted:#9aa;--brand:#6db3f2;--line:#33393f;--ok:#5cc47e;--err:#ff8a80}}
*{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--ink)}
header{background:var(--brand);color:#fff;padding:.7rem 1rem;display:flex;gap:1rem;align-items:center;flex-wrap:wrap}
header a{color:#fff;text-decoration:none}header .brand{font-weight:700;font-size:1.15rem}header .sp{flex:1}
header form{margin:0}header button{background:transparent;border:1px solid #fff8;color:#fff;padding:.25rem .7rem;border-radius:6px}
main{max-width:1100px;margin:0 auto;padding:1rem}
h1{font-size:1.5rem;margin:.5rem 0 1rem}h2{font-size:1.2rem;margin:1.5rem 0 .5rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:1rem;margin-bottom:1rem}
label{display:block;font-weight:600;margin:.6rem 0 .2rem}
input,select{width:100%;max-width:26rem;padding:.5rem;border:1px solid var(--line);border-radius:6px;font:inherit;background:var(--bg);color:var(--ink)}
input[type=checkbox]{width:auto;margin-right:.5rem}input[type=number].score{width:4.2rem}
button,.btn{background:var(--brand);color:#fff;border:0;border-radius:6px;padding:.5rem 1rem;font:inherit;cursor:pointer;text-decoration:none;display:inline-block}
button.danger{background:var(--err)}button.secondary{background:transparent;color:var(--brand);border:1px solid var(--brand)}
table{border-collapse:collapse;width:100%}th,td{padding:.35rem .5rem;border-bottom:1px solid var(--line);text-align:left}
td.n,th.n{text-align:right}.muted{color:var(--muted)}.flash{padding:.6rem 1rem;border-radius:8px;margin-bottom:1rem}
.flash.err{background:#b3261e22;color:var(--err)}.flash.ok{background:#1f7a3f22;color:var(--ok)}
.badge{display:inline-block;padding:0 .5rem;border-radius:99px;background:var(--accent);color:#000;font-size:.8rem}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:1rem}
.match{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;border-bottom:1px solid var(--line);padding:.35rem 0}
.match .t{flex:1;min-width:7rem}.match form{display:flex;gap:.3rem;align-items:center;margin:0}.win{font-weight:700;color:var(--ok)}
.bracket{display:flex;gap:1rem;overflow-x:auto;align-items:stretch;padding-bottom:.5rem}
.bracket .col{min-width:230px;display:flex;flex-direction:column;justify-content:space-around;gap:.6rem}
.bracket .col h3{margin:0;font-size:.95rem;color:var(--muted);text-align:center}
.bracket .bm{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:.4rem .6rem}
.bracket .bm div{display:flex;justify-content:space-between;gap:.5rem}.bracket .bm form{margin:.3rem 0 0;display:flex;gap:.3rem;align-items:center}
.inline{display:inline}.row{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center}
`;

export function layout({ title, session, flash, body }) {
  return html`<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} – Tournois de palets</title><style>${raw(CSS)}</style></head>
<body><header>
  <a class="brand" href="/">🥏 Palets Bretons</a>
  ${session ? html`
    <a href="${session.role === 'superadmin' ? '/associations' : '/tournois'}">${session.role === 'superadmin' ? 'Associations' : 'Mes tournois'}</a>
    <span class="sp"></span><span>${session.name}</span>
    <form method="post" action="/logout"><input type="hidden" name="_csrf" value="${session.csrf}"><button>Déconnexion</button></form>`
    : html`<span class="sp"></span>`}
</header><main>
${flash ? html`<div class="flash ${flash.type}">${flash.message}</div>` : ''}
${body}
</main></body></html>`;
}

const csrf = (s) => html`<input type="hidden" name="_csrf" value="${s.csrf}">`;

export function authPage({ title, intro, action, fields, submit, flash }) {
  return layout({
    title, flash, session: null,
    body: html`<div class="card" style="max-width:30rem;margin:2rem auto">
      <h1>${title}</h1>${intro ? html`<p class="muted">${intro}</p>` : ''}
      <form method="post" action="${action}">
        ${fields.map((f) => html`<label for="${f.name}">${f.label}</label>
          <input id="${f.name}" name="${f.name}" type="${f.type || 'text'}" ${raw(f.attrs || 'required')}>`)}
        <p><button>${submit}</button></p>
      </form></div>`,
  });
}

export function associationsPage({ session, flash, associations }) {
  return layout({
    title: 'Associations', session, flash,
    body: html`<h1>Associations</h1>
    <div class="card"><h2 style="margin-top:0">Nouvelle association</h2>
      <form method="post" action="/associations">${csrf(session)}
        <label for="name">Nom</label><input id="name" name="name" required maxlength="100">
        <p><button>Créer</button></p></form></div>
    <div class="card"><table><thead><tr><th>Association</th><th class="n">Administrateurs</th><th class="n">Tournois</th><th></th></tr></thead><tbody>
      ${associations.map((a) => html`<tr><td>${a.name}</td><td class="n">${a.admins}</td><td class="n">${a.tournaments}</td>
        <td class="n"><a class="btn secondary" href="/associations/${a.id}">Gérer</a></td></tr>`)}
      ${associations.length ? '' : html`<tr><td colspan="4" class="muted">Aucune association pour l'instant.</td></tr>`}
    </tbody></table></div>`,
  });
}

export function associationPage({ session, flash, association, admins }) {
  return layout({
    title: association.name, session, flash,
    body: html`<p><a href="/associations">← Associations</a></p><h1>${association.name}</h1>
    <div class="card"><h2 style="margin-top:0">Administrateurs</h2>
      <table><tbody>${admins.map((u) => html`<tr><td>${u.name}</td><td>${u.email}</td><td class="n">
        <form class="inline" method="post" action="/associations/${association.id}/admins/${u.id}/supprimer"
          onsubmit="return confirm('Supprimer cet administrateur ?')">${csrf(session)}<button class="danger">Supprimer</button></form></td></tr>`)}
      ${admins.length ? '' : html`<tr><td class="muted">Aucun administrateur.</td></tr>`}</tbody></table></div>
    <div class="card"><h2 style="margin-top:0">Ajouter un administrateur</h2>
      <form method="post" action="/associations/${association.id}/admins">${csrf(session)}
        <label for="aname">Nom</label><input id="aname" name="name" required maxlength="100">
        <label for="aemail">E-mail (identifiant)</label><input id="aemail" name="email" type="email" required>
        <label for="apw">Mot de passe (8 caractères min.)</label><input id="apw" name="password" type="password" required minlength="8">
        <p><button>Ajouter</button></p></form></div>
    <div class="card"><form method="post" action="/associations/${association.id}/supprimer"
      onsubmit="return confirm('Supprimer l\\'association, ses administrateurs et tous ses tournois ?')">${csrf(session)}
      <button class="danger">Supprimer l'association</button></form></div>`,
  });
}

const STATUS = { setup: 'Inscriptions', pools: 'Phase de poules', finals: 'Phases finales' };

export function tournamentsPage({ session, flash, association, tournaments }) {
  return layout({
    title: 'Mes tournois', session, flash,
    body: html`<h1>Tournois – ${association.name}</h1>
    <p><a class="btn" href="/tournois/nouveau">+ Nouveau tournoi</a></p>
    <div class="card"><table><thead><tr><th>Tournoi</th><th>Date</th><th class="n">Équipes</th><th class="n">Poules</th><th>État</th><th></th></tr></thead><tbody>
      ${tournaments.map((t) => html`<tr><td>${t.name}</td><td>${t.date || ''}</td><td class="n">${t.nb_teams}</td><td class="n">${t.nb_pools}</td>
        <td><span class="badge">${STATUS[t.status]}</span></td><td class="n"><a class="btn secondary" href="/tournois/${t.id}">Ouvrir</a></td></tr>`)}
      ${tournaments.length ? '' : html`<tr><td colspan="6" class="muted">Aucun tournoi. Créez le premier !</td></tr>`}
    </tbody></table></div>`,
  });
}

export function newTournamentPage({ session, flash, values = {} }) {
  const v = { nb_teams: 16, nb_pools: 4, finals_rounds: 2, ...values };
  return layout({
    title: 'Nouveau tournoi', session, flash,
    body: html`<p><a href="/tournois">← Mes tournois</a></p><h1>Nouveau tournoi</h1>
    <div class="card"><form method="post" action="/tournois">${csrf(session)}
      <label for="name">Nom du tournoi</label><input id="name" name="name" required maxlength="120" value="${v.name || ''}">
      <label for="date">Date</label><input id="date" name="date" type="date" value="${v.date || ''}">
      <label for="nb_teams">Nombre d'équipes</label><input id="nb_teams" name="nb_teams" type="number" min="2" max="128" required value="${v.nb_teams}">
      <label for="nb_pools">Nombre de poules</label><input id="nb_pools" name="nb_pools" type="number" min="1" max="32" required value="${v.nb_pools}">
      <label for="finals_rounds">Phase finale (premier tour)</label>
      <select id="finals_rounds" name="finals_rounds">${ROUND_OPTIONS.map((o) =>
        html`<option value="${o.value}" ${raw(Number(v.finals_rounds) === o.value ? 'selected' : '')}>${o.label}</option>`)}</select>
      <label><input type="checkbox" name="consolante" value="1" ${raw(v.consolante ? 'checked' : '')}>
        Organiser une consolante (avec les équipes éliminées en poule)</label>
      <p><button>Créer le tournoi</button></p></form></div>`,
  });
}

function scoreForm(session, t, m, a, b) {
  return html`<form method="post" action="/tournois/${t.id}/matchs/${m.id}">${csrf(session)}
    <input class="score" type="number" name="score1" min="0" max="99" required value="${m.score1 ?? ''}" aria-label="Score ${a}">
    <span>-</span>
    <input class="score" type="number" name="score2" min="0" max="99" required value="${m.score2 ?? ''}" aria-label="Score ${b}">
    <button>${m.score1 == null ? 'Valider' : 'Modifier'}</button></form>`;
}

function bracketView(session, t, matches, names, editable) {
  const rounds = [...new Set(matches.map((m) => m.round))].sort((x, y) => x - y);
  return html`<div class="bracket">${rounds.map((r) => {
    const ms = matches.filter((m) => m.round === r).sort((x, y) => x.pos - y.pos);
    return html`<div class="col"><h3>${roundName(ms.length)}</h3>${ms.map((m) => {
      const n1 = m.team1_id ? names.get(m.team1_id) : null;
      const n2 = m.team2_id ? names.get(m.team2_id) : null;
      const played = m.score1 != null;
      return html`<div class="bm">
        <div class="${m.winner_id && m.winner_id === m.team1_id ? 'win' : ''}"><span>${n1 ?? (m.bye ? 'Exempt' : '…')}</span><span>${played ? m.score1 : ''}</span></div>
        <div class="${m.winner_id && m.winner_id === m.team2_id ? 'win' : ''}"><span>${n2 ?? (m.bye ? 'Exempt' : '…')}</span><span>${played ? m.score2 : ''}</span></div>
        ${editable && !m.bye && m.team1_id && m.team2_id ? scoreForm(session, t, m, n1, n2) : ''}
      </div>`;
    })}</div>`;
  })}</div>`;
}

export function tournamentPage({ session, flash, t, teams, matches, poolTables }) {
  const names = new Map(teams.map((x) => [x.id, x.name]));
  const poolMatches = matches.filter((m) => m.phase === 'pool');
  const main = matches.filter((m) => m.phase === 'main');
  const cons = matches.filter((m) => m.phase === 'consolante');
  const poolsDone = poolMatches.length > 0 && poolMatches.every((m) => m.score1 != null);
  const champion = main.find((m) => m.round === Math.max(...main.map((x) => x.round)))?.winner_id;
  const consChamp = cons.length ? cons.find((m) => m.round === Math.max(...cons.map((x) => x.round)))?.winner_id : null;

  return layout({
    title: t.name, session, flash,
    body: html`<p><a href="/tournois">← Mes tournois</a></p>
    <h1>${t.name} <span class="badge">${STATUS[t.status]}</span></h1>
    <p class="muted">${t.date || ''} · ${t.nb_teams} équipes · ${t.nb_pools} poule(s) · phase finale dès
      ${ROUND_OPTIONS.find((o) => o.value === t.finals_rounds).label.split(' (')[0].toLowerCase()}
      · consolante : ${t.consolante ? 'oui' : 'non'}</p>

    ${champion ? html`<div class="card">🏆 <strong>Vainqueur :</strong> ${names.get(champion)}
      ${consChamp ? html` · 🥈 <strong>Vainqueur consolante :</strong> ${names.get(consChamp)}` : ''}</div>` : ''}

    <div class="card"><h2 style="margin-top:0">Équipes</h2>
      <form method="post" action="/tournois/${t.id}/equipes">${csrf(session)}
        <div class="grid">${teams.map((x) => html`<div><label for="team${x.id}">Équipe ${teams.indexOf(x) + 1}</label>
          <input id="team${x.id}" name="team_${x.id}" value="${x.name}" required maxlength="80"></div>`)}</div>
        <p><button class="secondary">Enregistrer les noms</button></p></form>
      ${t.status === 'setup' ? html`<form method="post" action="/tournois/${t.id}/poules">${csrf(session)}
        <button>🎲 Tirer au sort les poules</button></form>` : html`<form method="post" action="/tournois/${t.id}/reinitialiser"
        onsubmit="return confirm('Effacer le tirage et tous les scores ?')">${csrf(session)}<button class="danger">Réinitialiser le tirage</button></form>`}
    </div>

    ${t.status !== 'setup' ? html`<h2>Phase de poules</h2><div class="grid">${poolTables.map((p) => html`
      <div class="card"><h3 style="margin-top:0">Poule ${String.fromCharCode(65 + p.pool)}</h3>
        <table><thead><tr><th>#</th><th>Équipe</th><th class="n">J</th><th class="n">V</th><th class="n">Diff</th></tr></thead><tbody>
          ${p.rows.map((r, i) => html`<tr><td>${i + 1}</td><td>${names.get(r.id)}</td><td class="n">${r.played}</td><td class="n">${r.wins}</td><td class="n">${r.diff > 0 ? '+' : ''}${r.diff}</td></tr>`)}
        </tbody></table>
        ${p.matches.map((m) => html`<div class="match"><span class="t ${m.winner_id === m.team1_id ? 'win' : ''}">${names.get(m.team1_id)}</span>
          ${t.status === 'pools' ? scoreForm(session, t, m, names.get(m.team1_id), names.get(m.team2_id))
            : html`<strong>${m.score1} - ${m.score2}</strong>`}
          <span class="t ${m.winner_id === m.team2_id ? 'win' : ''}" style="text-align:right">${names.get(m.team2_id)}</span></div>`)}
      </div>`)}</div>
      ${t.status === 'pools' ? html`<form method="post" action="/tournois/${t.id}/finales">${csrf(session)}
        <button ${raw(poolsDone ? '' : 'disabled')}>Générer les phases finales${t.consolante ? ' et la consolante' : ''}</button>
        ${poolsDone ? '' : html` <span class="muted">Tous les matchs de poule doivent être joués.</span>`}</form>` : ''}` : ''}

    ${main.length ? html`<h2>Phase finale</h2><div class="card">${bracketView(session, t, main, names, true)}</div>` : ''}
    ${cons.length ? html`<h2>Consolante</h2><div class="card">${bracketView(session, t, cons, names, true)}</div>` : ''}

    <div class="card"><form method="post" action="/tournois/${t.id}/supprimer"
      onsubmit="return confirm('Supprimer définitivement ce tournoi ?')">${csrf(session)}<button class="danger">Supprimer le tournoi</button></form></div>`,
  });
}

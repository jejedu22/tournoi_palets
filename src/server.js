import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { hashPassword, verifyPassword, createSession, getSession, destroySession } from './auth.js';
import { validateConfig, drawPools, roundRobin, standings, selectQualifiers, buildBracket } from './logic.js';
import * as v from './views.js';
import { html } from './html.js';

const DUMMY_HASH = hashPassword('dummy-password');
const MAX_BODY = 100 * 1024;

export function createApp(db) {
  const routes = [];
  const route = (method, pattern, role, handler) =>
    routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), role, handler });

  const failures = new Map(); // ip -> [timestamps] : limitation simple des essais de connexion
  const tooManyFailures = (ip) => {
    const recent = (failures.get(ip) || []).filter((t) => Date.now() - t < 15 * 60_000);
    failures.set(ip, recent);
    return recent.length >= 10;
  };

  const hasUsers = () => db.prepare('SELECT 1 FROM users LIMIT 1').get() !== undefined;
  const redirect = (res, to, extra = {}) => {
    res.writeHead(303, { Location: to, ...extra });
    res.end();
  };
  const back = (res, path, type, message) => redirect(res, `${path}?${type}=${encodeURIComponent(message)}`);
  const send = (res, status, page) => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page.toString());
  };
  const flashOf = (url) => {
    const ok = url.searchParams.get('ok');
    const err = url.searchParams.get('err');
    return ok ? { type: 'ok', message: ok } : err ? { type: 'err', message: err } : null;
  };
  const notFound = (res, session) =>
    send(res, 404, v.layout({ title: 'Introuvable', session, body: html`<h1>Page introuvable</h1><p><a href="/">Accueil</a></p>` }));

  const tx = (fn) => {
    db.exec('BEGIN');
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
  };

  // Un tournoi n'est jamais lu sans filtre sur l'association de l'utilisateur connecté.
  const loadTournament = (session, id) =>
    db.prepare('SELECT * FROM tournaments WHERE id = ? AND association_id = ?').get(Number(id), session.association_id);

  // ---------- Premier lancement / connexion ----------
  route('GET', '/setup', null, ({ res, url }) => {
    if (hasUsers()) return redirect(res, '/login');
    send(res, 200, v.authPage({
      title: 'Création du super-administrateur',
      intro: "Ce compte crée les associations et leurs administrateurs.",
      action: '/setup', submit: 'Créer le compte', flash: flashOf(url),
      fields: [{ name: 'name', label: 'Nom' }, { name: 'email', label: 'E-mail', type: 'email' },
        { name: 'password', label: 'Mot de passe (8 caractères min.)', type: 'password', attrs: 'required minlength="8"' }],
    }));
  });
  route('POST', '/setup', null, ({ res, body }) => {
    if (hasUsers()) return redirect(res, '/login');
    if (!body.name?.trim() || !body.email?.trim() || (body.password || '').length < 8) return back(res, '/setup', 'err', 'Tous les champs sont requis (mot de passe : 8 caractères min.).');
    db.prepare("INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, 'superadmin')")
      .run(body.email.trim().toLowerCase(), body.name.trim(), hashPassword(body.password));
    back(res, '/login', 'ok', 'Compte créé, vous pouvez vous connecter.');
  });

  route('GET', '/login', null, ({ res, url, session }) => {
    if (!hasUsers()) return redirect(res, '/setup');
    if (session) return redirect(res, '/');
    send(res, 200, v.authPage({
      title: 'Connexion', action: '/login', submit: 'Se connecter', flash: flashOf(url),
      fields: [{ name: 'email', label: 'E-mail', type: 'email' }, { name: 'password', label: 'Mot de passe', type: 'password' }],
    }));
  });
  route('POST', '/login', null, ({ req, res, body, secure }) => {
    const ip = req.socket.remoteAddress;
    if (tooManyFailures(ip)) return back(res, '/login', 'err', 'Trop de tentatives, réessayez dans quelques minutes.');
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get((body.email || '').trim().toLowerCase());
    const ok = verifyPassword(body.password || '', (user ?? { password_hash: DUMMY_HASH }).password_hash) && user;
    if (!ok) {
      failures.get(ip).push(Date.now());
      return back(res, '/login', 'err', 'Identifiants incorrects.');
    }
    const token = createSession(db, user.id);
    redirect(res, '/', { 'Set-Cookie': `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${secure ? '; Secure' : ''}` });
  });
  route('POST', '/logout', 'any', ({ res, session }) => {
    destroySession(db, session.token);
    redirect(res, '/login', { 'Set-Cookie': 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
  });
  route('GET', '/', 'any', ({ res, session }) => redirect(res, session.role === 'superadmin' ? '/associations' : '/tournois'));

  // ---------- Super-administrateur : associations ----------
  route('GET', '/associations', 'superadmin', ({ res, url, session }) => {
    const associations = db.prepare(`SELECT a.id, a.name,
      (SELECT COUNT(*) FROM users u WHERE u.association_id = a.id) AS admins,
      (SELECT COUNT(*) FROM tournaments t WHERE t.association_id = a.id) AS tournaments
      FROM associations a ORDER BY a.name`).all();
    send(res, 200, v.associationsPage({ session, flash: flashOf(url), associations }));
  });
  route('POST', '/associations', 'superadmin', ({ res, body }) => {
    const name = (body.name || '').trim();
    if (!name) return back(res, '/associations', 'err', 'Le nom est requis.');
    try {
      const { lastInsertRowid } = db.prepare('INSERT INTO associations (name) VALUES (?)').run(name);
      back(res, `/associations/${lastInsertRowid}`, 'ok', 'Association créée. Ajoutez maintenant un administrateur.');
    } catch { back(res, '/associations', 'err', 'Une association porte déjà ce nom.'); }
  });
  const loadAssociation = (id) => db.prepare('SELECT * FROM associations WHERE id = ?').get(Number(id));
  route('GET', '/associations/:id', 'superadmin', ({ res, url, session, params }) => {
    const association = loadAssociation(params.id);
    if (!association) return notFound(res, session);
    const admins = db.prepare('SELECT id, name, email FROM users WHERE association_id = ? ORDER BY name').all(association.id);
    send(res, 200, v.associationPage({ session, flash: flashOf(url), association, admins }));
  });
  route('POST', '/associations/:id/admins', 'superadmin', ({ res, session, params, body }) => {
    const association = loadAssociation(params.id);
    if (!association) return notFound(res, session);
    const path = `/associations/${association.id}`;
    const email = (body.email || '').trim().toLowerCase();
    if (!body.name?.trim() || !email || (body.password || '').length < 8) return back(res, path, 'err', 'Nom, e-mail et mot de passe (8 caractères min.) sont requis.');
    try {
      db.prepare("INSERT INTO users (email, name, password_hash, role, association_id) VALUES (?, ?, ?, 'admin', ?)")
        .run(email, body.name.trim(), hashPassword(body.password), association.id);
      back(res, path, 'ok', 'Administrateur ajouté.');
    } catch { back(res, path, 'err', 'Cet e-mail est déjà utilisé.'); }
  });
  route('POST', '/associations/:id/admins/:uid/supprimer', 'superadmin', ({ res, params }) => {
    db.prepare("DELETE FROM users WHERE id = ? AND association_id = ? AND role = 'admin'").run(Number(params.uid), Number(params.id));
    back(res, `/associations/${params.id}`, 'ok', 'Administrateur supprimé.');
  });
  route('POST', '/associations/:id/supprimer', 'superadmin', ({ res, params }) => {
    db.prepare('DELETE FROM associations WHERE id = ?').run(Number(params.id));
    back(res, '/associations', 'ok', 'Association supprimée.');
  });

  // ---------- Administrateur d'association : tournois ----------
  route('GET', '/tournois', 'admin', ({ res, url, session }) => {
    const association = db.prepare('SELECT * FROM associations WHERE id = ?').get(session.association_id);
    const tournaments = db.prepare('SELECT * FROM tournaments WHERE association_id = ? ORDER BY COALESCE(date, created_at) DESC, id DESC').all(session.association_id);
    send(res, 200, v.tournamentsPage({ session, flash: flashOf(url), association, tournaments }));
  });
  route('GET', '/tournois/nouveau', 'admin', ({ res, url, session }) =>
    send(res, 200, v.newTournamentPage({ session, flash: flashOf(url) })));
  route('POST', '/tournois', 'admin', ({ res, session, body }) => {
    const cfg = {
      nbTeams: Number(body.nb_teams), nbPools: Number(body.nb_pools),
      finalsRounds: Number(body.finals_rounds), consolante: body.consolante === '1',
    };
    const name = (body.name || '').trim();
    const error = !name ? 'Le nom du tournoi est requis.' : validateConfig(cfg);
    if (error) {
      return send(res, 400, v.newTournamentPage({
        session, flash: { type: 'err', message: error },
        values: { name, date: body.date, nb_teams: body.nb_teams, nb_pools: body.nb_pools, finals_rounds: body.finals_rounds, consolante: cfg.consolante },
      }));
    }
    const id = tx(() => {
      const { lastInsertRowid } = db.prepare(`INSERT INTO tournaments (association_id, name, date, nb_teams, nb_pools, finals_rounds, consolante)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(session.association_id, name, body.date || null, cfg.nbTeams, cfg.nbPools, cfg.finalsRounds, cfg.consolante ? 1 : 0);
      const ins = db.prepare('INSERT INTO teams (tournament_id, name) VALUES (?, ?)');
      for (let i = 1; i <= cfg.nbTeams; i++) ins.run(lastInsertRowid, `Équipe ${i}`);
      return lastInsertRowid;
    });
    back(res, `/tournois/${id}`, 'ok', 'Tournoi créé. Renommez les équipes puis lancez le tirage au sort.');
  });

  route('GET', '/tournois/:id', 'admin', ({ res, url, session, params }) => {
    const t = loadTournament(session, params.id);
    if (!t) return notFound(res, session);
    const teams = db.prepare('SELECT * FROM teams WHERE tournament_id = ? ORDER BY id').all(t.id);
    const matches = db.prepare('SELECT * FROM matches WHERE tournament_id = ? ORDER BY phase, round, pos, id').all(t.id);
    const poolTables = [];
    for (let p = 0; p < t.nb_pools && t.status !== 'setup'; p++) {
      const ids = teams.filter((x) => x.pool === p).map((x) => x.id);
      const pm = matches.filter((m) => m.phase === 'pool' && m.pool === p);
      poolTables.push({ pool: p, rows: standings(ids, pm), matches: pm });
    }
    send(res, 200, v.tournamentPage({ session, flash: flashOf(url), t, teams, matches, poolTables }));
  });

  route('POST', '/tournois/:id/equipes', 'admin', ({ res, session, params, body }) => {
    const t = loadTournament(session, params.id);
    if (!t) return notFound(res, session);
    const upd = db.prepare('UPDATE teams SET name = ? WHERE id = ? AND tournament_id = ?');
    tx(() => {
      for (const team of db.prepare('SELECT id FROM teams WHERE tournament_id = ?').all(t.id)) {
        const name = (body[`team_${team.id}`] || '').trim().slice(0, 80);
        if (name) upd.run(name, team.id, t.id);
      }
    });
    back(res, `/tournois/${t.id}`, 'ok', 'Noms des équipes enregistrés.');
  });

  route('POST', '/tournois/:id/poules', 'admin', ({ res, session, params }) => {
    const t = loadTournament(session, params.id);
    if (!t) return notFound(res, session);
    if (t.status !== 'setup') return back(res, `/tournois/${t.id}`, 'err', 'Le tirage a déjà été effectué.');
    const ids = db.prepare('SELECT id FROM teams WHERE tournament_id = ?').all(t.id).map((x) => x.id);
    const pools = drawPools(ids, t.nb_pools);
    tx(() => {
      const setPool = db.prepare('UPDATE teams SET pool = ? WHERE id = ?');
      const addMatch = db.prepare("INSERT INTO matches (tournament_id, phase, pool, round, team1_id, team2_id) VALUES (?, 'pool', ?, ?, ?, ?)");
      pools.forEach((members, p) => {
        members.forEach((id) => setPool.run(p, id));
        for (const m of roundRobin(members)) addMatch.run(t.id, p, m.round, m.a, m.b);
      });
      db.prepare("UPDATE tournaments SET status = 'pools' WHERE id = ?").run(t.id);
    });
    back(res, `/tournois/${t.id}`, 'ok', 'Poules tirées au sort. Saisissez les scores.');
  });

  route('POST', '/tournois/:id/reinitialiser', 'admin', ({ res, session, params }) => {
    const t = loadTournament(session, params.id);
    if (!t) return notFound(res, session);
    tx(() => {
      db.prepare('DELETE FROM matches WHERE tournament_id = ?').run(t.id);
      db.prepare('UPDATE teams SET pool = NULL WHERE tournament_id = ?').run(t.id);
      db.prepare("UPDATE tournaments SET status = 'setup' WHERE id = ?").run(t.id);
    });
    back(res, `/tournois/${t.id}`, 'ok', 'Tirage réinitialisé.');
  });

  route('POST', '/tournois/:id/finales', 'admin', ({ res, session, params }) => {
    const t = loadTournament(session, params.id);
    if (!t) return notFound(res, session);
    const path = `/tournois/${t.id}`;
    if (t.status !== 'pools') return back(res, path, 'err', 'Les phases finales ne peuvent pas être générées maintenant.');
    const poolMatches = db.prepare("SELECT * FROM matches WHERE tournament_id = ? AND phase = 'pool'").all(t.id);
    if (poolMatches.some((m) => m.score1 == null)) return back(res, path, 'err', 'Tous les matchs de poule doivent être joués.');
    const teams = db.prepare('SELECT * FROM teams WHERE tournament_id = ?').all(t.id);
    const tables = Array.from({ length: t.nb_pools }, (_, p) =>
      standings(teams.filter((x) => x.pool === p).map((x) => x.id), poolMatches.filter((m) => m.pool === p)));
    const { qualified, eliminated } = selectQualifiers(tables, 2 ** t.finals_rounds);

    tx(() => {
      const add = db.prepare(`INSERT INTO matches (tournament_id, phase, round, pos, team1_id, team2_id, winner_id, bye, third)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const insertBracket = (phase, seeds) => {
        for (const m of buildBracket(seeds)) add.run(t.id, phase, m.round, m.pos, m.team1, m.team2, m.winner, m.bye ? 1 : 0, m.third ? 1 : 0);
      };
      insertBracket('main', qualified);
      if (t.consolante && eliminated.length >= 2) insertBracket('consolante', eliminated);
      db.prepare("UPDATE tournaments SET status = 'finals' WHERE id = ?").run(t.id);
    });
    back(res, path, 'ok', 'Phases finales générées.');
  });

  route('POST', '/tournois/:id/matchs/:mid', 'admin', ({ res, session, params, body }) => {
    const t = loadTournament(session, params.id);
    if (!t) return notFound(res, session);
    const path = `/tournois/${t.id}`;
    const m = db.prepare('SELECT * FROM matches WHERE id = ? AND tournament_id = ?').get(Number(params.mid), t.id);
    if (!m) return notFound(res, session);

    const s1 = Number(body.score1), s2 = Number(body.score2);
    if (!Number.isInteger(s1) || !Number.isInteger(s2) || s1 < 0 || s2 < 0 || s1 > 99 || s2 > 99 || body.score1 === '' || body.score2 === '') return back(res, path, 'err', 'Scores invalides.');
    if (s1 === s2) return back(res, path, 'err', 'Pas de match nul : un vainqueur est nécessaire.');
    const winner = s1 > s2 ? m.team1_id : m.team2_id;

    if (m.phase === 'pool') {
      if (t.status !== 'pools') return back(res, path, 'err', 'Les scores de poule ne sont plus modifiables.');
    } else {
      if (m.bye || !m.team1_id || !m.team2_id) return back(res, path, 'err', 'Ce match ne peut pas encore être joué.');
    }

    // Tour suivant (vainqueur) et, pour une demi-finale, petite finale (perdant)
    let next = null, thirdMatch = null;
    if (m.phase !== 'pool' && !m.third) {
      const find = (round, pos, third) => db.prepare(
        'SELECT * FROM matches WHERE tournament_id = ? AND phase = ? AND round = ? AND pos = ? AND third = ?')
        .get(t.id, m.phase, round, pos, third);
      next = find(m.round + 1, Math.floor(m.pos / 2), 0);
      if (next) thirdMatch = find(next.round, 0, 1) ?? null;
      const loserFeedsThird = thirdMatch && thirdMatch.round === m.round + 1;
      if (!loserFeedsThird) thirdMatch = null;
      if (m.winner_id !== winner && ((next && next.score1 != null) || (thirdMatch && thirdMatch.score1 != null))) {
        return back(res, path, 'err', 'Le tour suivant a déjà été joué : impossible de changer le vainqueur.');
      }
    }
    const loser = winner === m.team1_id ? m.team2_id : m.team1_id;
    tx(() => {
      db.prepare('UPDATE matches SET score1 = ?, score2 = ?, winner_id = ? WHERE id = ?').run(s1, s2, winner, m.id);
      const col = m.pos % 2 === 0 ? 'team1_id' : 'team2_id';
      if (next) db.prepare(`UPDATE matches SET ${col} = ? WHERE id = ?`).run(winner, next.id);
      if (thirdMatch) db.prepare(`UPDATE matches SET ${col} = ? WHERE id = ?`).run(loser, thirdMatch.id);
    });
    back(res, path, 'ok', 'Score enregistré.');
  });

  route('POST', '/tournois/:id/supprimer', 'admin', ({ res, session, params }) => {
    const t = loadTournament(session, params.id);
    if (!t) return notFound(res, session);
    db.prepare('DELETE FROM tournaments WHERE id = ?').run(t.id);
    back(res, '/tournois', 'ok', 'Tournoi supprimé.');
  });

  // ---------- Dispatch ----------
  const parseCookies = (h = '') => Object.fromEntries(h.split(';').map((c) => c.trim().split('=')).filter((p) => p[0]));
  const readBody = (req) => new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString()))));
    req.on('error', reject);
  });
  const safeEqual = (a = '', b = '') => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

  return async function handler(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname.length > 1 ? url.pathname.replace(/\/$/, '') : url.pathname;
      const session = getSession(db, parseCookies(req.headers.cookie).sid);

      for (const r of routes) {
        const match = r.method === req.method && r.re.exec(path);
        if (!match) continue;
        if (r.role) {
          if (!session) return redirect(res, hasUsers() ? '/login' : '/setup');
          if (r.role !== 'any' && session.role !== r.role) return send(res, 403, v.layout({ title: 'Accès refusé', session, body: html`<h1>Accès refusé</h1>` }));
        }
        const body = req.method === 'POST' ? await readBody(req) : {};
        if (req.method === 'POST' && session && !safeEqual(body._csrf, session.csrf)) {
          return send(res, 403, v.layout({ title: 'Requête refusée', session, body: html`<h1>Requête refusée</h1><p>Jeton de sécurité invalide, rechargez la page.</p>` }));
        }
        const secure = req.headers['x-forwarded-proto'] === 'https' || process.env.COOKIE_SECURE === '1';
        return await r.handler({ req, res, url, session, params: match.groups ?? {}, body, secure });
      }
      notFound(res, session);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) send(res, 500, v.layout({ title: 'Erreur', body: html`<h1>Erreur interne</h1>` }));
    }
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  createServer(createApp(openDb())).listen(port, () => console.log(`Tournois de palets : http://localhost:${port}`));
}

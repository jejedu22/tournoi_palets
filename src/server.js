import { createServer } from 'node:http';
import { timingSafeEqual, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb, newPublicToken } from './db.js';
import { hashPassword, verifyPassword, createSession, getSession, destroySession } from './auth.js';
import { validateConfig, finalsFormat, tournamentFormat, drawPools, roundRobin, standings, selectQualifiers, buildBracket } from './logic.js';
import * as v from './views.js';
import { getStatic } from './static.js';
import { qrSvg } from './qr.js';

const DUMMY_HASH = hashPassword('dummy-password');
const MAX_BODY = 100 * 1024;
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:",
  "manifest-src 'self'", "worker-src 'self'", "connect-src 'self'",
  "form-action 'self'", "frame-ancestors 'none'", "base-uri 'none'", "object-src 'none'",
].join('; ');

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

  // Derrière Traefik (TRUST_PROXY=1) : Traefik ajoute l'IP réelle en dernière position de X-Forwarded-For.
  const clientIp = (req) => {
    if (process.env.TRUST_PROXY === '1') {
      const last = String(req.headers['x-forwarded-for'] || '').split(',').pop().trim();
      if (last) return last;
    }
    return req.socket.remoteAddress;
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
    send(res, 404, v.errorPage({ session, status: 404, title: 'Page introuvable', message: "Cette page n'existe pas ou a été déplacée." }));

  const tx = (fn) => {
    db.exec('BEGIN');
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
  };

  // Un tournoi n'est jamais lu sans filtre sur l'association de l'utilisateur connecté.
  const loadTournament = (session, id) =>
    db.prepare('SELECT * FROM tournaments WHERE id = ? AND association_id = ?').get(Number(id), session.association_id);

  route('GET', '/healthz', null, ({ res }) => {
    db.prepare('SELECT 1').get();
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  });

  // ---------- Premier lancement / connexion ----------
  route('GET', '/setup', null, ({ res, url }) => {
    if (hasUsers()) return redirect(res, '/login');
    send(res, 200, v.authPage({
      title: 'Création du super-administrateur',
      intro: "Ce compte crée les associations et leurs administrateurs.",
      action: '/setup', submit: 'Créer le compte', flash: flashOf(url),
      fields: [{ name: 'name', label: 'Nom', autocomplete: 'name' }, { name: 'email', label: 'E-mail', type: 'email', autocomplete: 'username' },
        { name: 'password', label: 'Mot de passe (8 caractères min.)', type: 'password', autocomplete: 'new-password', attrs: 'required minlength="8"' }],
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
      fields: [{ name: 'email', label: 'E-mail', type: 'email', autocomplete: 'username' },
        { name: 'password', label: 'Mot de passe', type: 'password', autocomplete: 'current-password' }],
    }));
  });
  route('POST', '/login', null, ({ req, res, body, secure }) => {
    const ip = clientIp(req);
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
    const tournaments = db.prepare(`SELECT t.*,
      (SELECT COUNT(*) FROM matches m WHERE m.tournament_id = t.id AND m.bye = 0) AS total,
      (SELECT COUNT(*) FROM matches m WHERE m.tournament_id = t.id AND m.bye = 0 AND m.score1 IS NOT NULL) AS played
      FROM tournaments t WHERE t.association_id = ? ORDER BY COALESCE(t.date, t.created_at) DESC, t.id DESC`).all(session.association_id);
    send(res, 200, v.tournamentsPage({ session, flash: flashOf(url), association, tournaments }));
  });
  route('GET', '/tournois/nouveau', 'admin', ({ res, url, session }) =>
    send(res, 200, v.newTournamentPage({ session, flash: flashOf(url) })));
  route('POST', '/tournois', 'admin', ({ res, session, body }) => {
    const cfg = {
      nbTeams: Number(body.nb_teams), nbPools: Number(body.nb_pools),
      perPool: Number(body.qualifiers_per_pool), fill: body.fill_mode, consolante: body.consolante === '1',
    };
    const name = (body.name || '').trim();
    const error = !name ? 'Le nom du tournoi est requis.' : validateConfig(cfg);
    if (error) {
      return send(res, 400, v.newTournamentPage({
        session, flash: { type: 'err', message: error },
        values: { name, date: body.date, nb_teams: body.nb_teams, nb_pools: body.nb_pools,
          qualifiers_per_pool: body.qualifiers_per_pool, fill_mode: body.fill_mode, consolante: cfg.consolante },
      }));
    }
    const id = tx(() => {
      const { rounds } = finalsFormat(cfg);
      const { lastInsertRowid } = db.prepare(`INSERT INTO tournaments
        (association_id, name, date, nb_teams, nb_pools, finals_rounds, qualifiers_per_pool, fill_mode, consolante, public_token)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(session.association_id, name, body.date || null, cfg.nbTeams, cfg.nbPools,
        rounds, cfg.perPool, cfg.fill, cfg.consolante ? 1 : 0, newPublicToken());
      const ins = db.prepare('INSERT INTO teams (tournament_id, name) VALUES (?, ?)');
      for (let i = 1; i <= cfg.nbTeams; i++) ins.run(lastInsertRowid, `Équipe ${i}`);
      return lastInsertRowid;
    });
    back(res, `/tournois/${id}`, 'ok', 'Tournoi créé. Renommez les équipes puis lancez le tirage au sort.');
  });

  // Équipes, matchs et classements d'un tournoi (page d'administration comme page publique)
  const tournamentData = (t) => {
    const teams = db.prepare('SELECT * FROM teams WHERE tournament_id = ? ORDER BY id').all(t.id);
    const matches = db.prepare('SELECT * FROM matches WHERE tournament_id = ? ORDER BY phase, round, pos, id').all(t.id);
    const poolTables = [];
    for (let p = 0; p < t.nb_pools && t.status !== 'setup'; p++) {
      const ids = teams.filter((x) => x.pool === p).map((x) => x.id);
      const pm = matches.filter((m) => m.phase === 'pool' && m.pool === p);
      poolTables.push({ pool: p, rows: standings(ids, pm), matches: pm });
    }
    return { teams, matches, poolTables };
  };

  // Empreinte de tout ce qu'affiche la page publique : elle change dès qu'un score ou un nom change.
  const versionOf = (t, { teams, matches }) => createHash('sha1')
    .update(JSON.stringify([t.name, t.date, t.status, teams.map((x) => [x.id, x.name, x.pool]),
      matches.map((m) => [m.id, m.team1_id, m.team2_id, m.score1, m.score2])]))
    .digest('hex').slice(0, 12);

  const publicUrl = (secure, req, t) =>
    `${process.env.PUBLIC_URL?.replace(/\/$/, '') || `${secure ? 'https' : 'http'}://${req.headers.host}`}/r/${t.public_token}`;

  route('GET', '/tournois/:id', 'admin', ({ req, res, url, session, params, secure }) => {
    const t = loadTournament(session, params.id);
    if (!t) return notFound(res, session);
    const publicLink = publicUrl(secure, req, t);
    send(res, 200, v.tournamentPage({ session, flash: flashOf(url), t, ...tournamentData(t), publicLink,
      publicQr: t.public_enabled ? qrSvg(publicLink, { label: `QR code des résultats de ${t.name}` }) : null }));
  });

  // Affiche A4 à imprimer : QR code géant vers la page publique
  route('GET', '/tournois/:id/affiche', 'admin', ({ req, res, session, params, secure }) => {
    const t = loadTournament(session, params.id);
    if (!t) return notFound(res, session);
    if (!t.public_enabled) return back(res, `/tournois/${t.id}`, 'err', "Activez d'abord la page publique pour imprimer l'affiche.");
    const association = db.prepare('SELECT name FROM associations WHERE id = ?').get(t.association_id);
    const publicLink = publicUrl(secure, req, t);
    send(res, 200, v.posterPage({ session, t, association, publicLink,
      qr: qrSvg(publicLink, { label: `QR code des résultats de ${t.name}` }) }));
  });

  route('POST', '/tournois/:id/public', 'admin', ({ res, session, params, body }) => {
    const t = loadTournament(session, params.id);
    if (!t) return notFound(res, session);
    const path = `/tournois/${t.id}#partage`;
    if (body.action === 'enable' || body.action === 'disable') {
      db.prepare('UPDATE tournaments SET public_enabled = ? WHERE id = ?').run(body.action === 'enable' ? 1 : 0, t.id);
      return back(res, `/tournois/${t.id}`, 'ok', body.action === 'enable' ? 'Page publique activée.' : 'Page publique désactivée : le lien ne fonctionne plus.');
    }
    if (body.action === 'regenerate') {
      db.prepare('UPDATE tournaments SET public_token = ? WHERE id = ?').run(newPublicToken(), t.id);
      return back(res, `/tournois/${t.id}`, 'ok', "Nouveau lien public créé : l'ancien ne fonctionne plus.");
    }
    redirect(res, path);
  });

  // ---------- Page publique des résultats (sans connexion) ----------
  const loadPublic = (token) => db.prepare(`SELECT t.*, a.name AS association_name FROM tournaments t
    JOIN associations a ON a.id = t.association_id WHERE t.public_token = ? AND t.public_enabled = 1`).get(String(token));

  route('GET', '/r/:token', null, ({ req, res, session, params, secure }) => {
    const t = loadPublic(params.token);
    if (!t) return send(res, 404, v.errorPage({ status: 404, title: 'Résultats introuvables', message: "Ce lien n'existe pas ou a été désactivé par l'organisateur." }));
    const data = tournamentData(t);
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Cache-Control', 'no-store');
    const publicLink = publicUrl(secure, req, t);
    send(res, 200, v.publicPage({ t, ...data, version: versionOf(t, data), isAdmin: session?.association_id === t.association_id,
      publicLink, qr: qrSvg(publicLink, { label: `QR code de cette page` }) }));
  });

  route('GET', '/r/:token/version', null, ({ res, params }) => {
    const t = loadPublic(params.token);
    if (!t) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end(''); }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    res.end(versionOf(t, tournamentData(t)));
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

  // Saisie en une fois : une équipe par ligne, dans l'ordre (numérotation « 1. », « 2) », puces… ignorées)
  route('POST', '/tournois/:id/equipes/liste', 'admin', ({ res, session, params, body }) => {
    const t = loadTournament(session, params.id);
    if (!t) return notFound(res, session);
    const path = `/tournois/${t.id}`;
    const lines = String(body.liste || '').split(/\r?\n/)
      .map((l) => l.replace(/^\s*(?:\d+\s*[.):-]|[-*•])\s*/, '').trim().slice(0, 80))
      .filter(Boolean);
    const teams = db.prepare('SELECT id FROM teams WHERE tournament_id = ? ORDER BY id').all(t.id);
    if (!lines.length) return back(res, path, 'err', 'La liste est vide : saisissez une équipe par ligne.');
    if (lines.length > teams.length) {
      return back(res, path, 'err', `${lines.length} noms pour ${teams.length} équipes : retirez ${lines.length - teams.length} ligne(s) ou recréez le tournoi avec plus d'équipes.`);
    }
    const upd = db.prepare('UPDATE teams SET name = ? WHERE id = ?');
    tx(() => lines.forEach((name, i) => upd.run(name, teams[i].id)));
    const rest = teams.length - lines.length;
    back(res, path, 'ok', rest
      ? `${lines.length} équipes renommées ; ${rest} gardent leur nom actuel.`
      : `Les ${lines.length} équipes sont enregistrées.`);
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
    const format = tournamentFormat(t);
    const { qualified, eliminated } = selectQualifiers(tables, format.perPool, format.extra);

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

  /**
   * Enregistre le score d'un match (relu en base, car un score précédent peut avoir rempli ses équipes).
   * Retourne { error } ou { changed }. Pour un match de tableau, qualifie le vainqueur pour le tour suivant
   * et, en demi-finale, envoie le perdant en petite finale.
   */
  const recordScore = (t, matchId, raw1, raw2) => {
    const m = db.prepare('SELECT * FROM matches WHERE id = ? AND tournament_id = ?').get(matchId, t.id);
    if (!m) return { error: 'Match introuvable.' };
    const s1 = Number(raw1), s2 = Number(raw2);
    if (raw1 === '' || raw2 === '' || raw1 == null || raw2 == null) return { error: 'Score incomplet.' };
    if (!Number.isInteger(s1) || !Number.isInteger(s2) || s1 < 0 || s2 < 0 || s1 > 99 || s2 > 99) return { error: 'Scores invalides.' };
    if (s1 === s2) return { error: 'Pas de match nul : un vainqueur est nécessaire.' };
    if (m.score1 === s1 && m.score2 === s2) return { changed: false };
    const winner = s1 > s2 ? m.team1_id : m.team2_id;

    if (m.phase === 'pool') {
      if (t.status !== 'pools') return { error: 'Les scores de poule ne sont plus modifiables.' };
    } else if (m.bye || !m.team1_id || !m.team2_id) {
      return { error: 'Ce match ne peut pas encore être joué.' };
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
        return { error: 'Le tour suivant a déjà été joué : impossible de changer le vainqueur.' };
      }
    }
    const loser = winner === m.team1_id ? m.team2_id : m.team1_id;
    tx(() => {
      db.prepare('UPDATE matches SET score1 = ?, score2 = ?, winner_id = ? WHERE id = ?').run(s1, s2, winner, m.id);
      const col = m.pos % 2 === 0 ? 'team1_id' : 'team2_id';
      if (next) db.prepare(`UPDATE matches SET ${col} = ? WHERE id = ?`).run(winner, next.id);
      if (thirdMatch) db.prepare(`UPDATE matches SET ${col} = ? WHERE id = ?`).run(loser, thirdMatch.id);
    });
    return { changed: true };
  };

  route('POST', '/tournois/:id/matchs/:mid', 'admin', ({ res, session, params, body }) => {
    const t = loadTournament(session, params.id);
    if (!t) return notFound(res, session);
    const r = recordScore(t, Number(params.mid), body.score1, body.score2);
    if (r.error === 'Match introuvable.') return notFound(res, session);
    if (r.error) return back(res, `/tournois/${t.id}`, 'err', r.error);
    back(res, `/tournois/${t.id}`, 'ok', 'Score enregistré.');
  });

  // Saisie groupée : champs s1_<id> / s2_<id>. Les lignes vides sont ignorées, chaque score est validé
  // séparément ; les scores valides sont enregistrés même si d'autres sont en erreur.
  route('POST', '/tournois/:id/scores', 'admin', ({ res, session, params, body }) => {
    const t = loadTournament(session, params.id);
    if (!t) return notFound(res, session);
    const path = `/tournois/${t.id}`;
    const submitted = new Set(Object.keys(body).map((k) => /^s1_(\d+)$/.exec(k)?.[1]).filter(Boolean).map(Number));
    // Poules d'abord, puis tableaux tour par tour : un vainqueur saisi qualifie l'équipe pour le tour suivant
    const ordered = db.prepare(`SELECT id, team1_id, team2_id FROM matches WHERE tournament_id = ?
      ORDER BY phase = 'pool' DESC, phase, round, third, pos`).all(t.id).filter((m) => submitted.has(m.id));
    const names = new Map(db.prepare('SELECT id, name FROM teams WHERE tournament_id = ?').all(t.id).map((x) => [x.id, x.name]));

    let saved = 0;
    const errors = [];
    for (const m of ordered) {
      const raw1 = (body[`s1_${m.id}`] ?? '').trim(), raw2 = (body[`s2_${m.id}`] ?? '').trim();
      if (raw1 === '' && raw2 === '') continue;
      const r = recordScore(t, m.id, raw1, raw2);
      if (r.error) errors.push(`${names.get(m.team1_id) ?? '?'} – ${names.get(m.team2_id) ?? '?'} : ${r.error}`);
      else if (r.changed) saved++;
    }
    const done = saved ? `${saved} score${saved > 1 ? 's' : ''} enregistré${saved > 1 ? 's' : ''}.` : 'Aucun score modifié.';
    if (errors.length) return back(res, path, 'err', `${saved ? done + ' ' : ''}À corriger → ${errors.join(' · ')}`);
    back(res, path, 'ok', done);
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
  // PWA : /sw.js, le manifeste et la page hors-ligne sont à la racine (portée du service worker),
  // le reste sous /static/. Les URL /static/ portent ?v=<empreinte>, d'où un cache long.
  const ROOT_FILES = { '/sw.js': 'sw.js', '/manifest.webmanifest': 'manifest.webmanifest', '/offline.html': 'offline.html' };
  const serveStatic = (req, res, path) => {
    if (path === '/favicon.ico') {
      redirect(res, '/static/icon.svg');
      return true;
    }
    const name = ROOT_FILES[path] ?? (path.startsWith('/static/') ? path.slice(8) : null);
    const file = name && getStatic(name);
    if (!file) return false;
    const versioned = path.startsWith('/static/') && new URL(req.url, 'http://x').searchParams.has('v');
    res.writeHead(200, {
      'Content-Type': file.type,
      'Content-Length': file.body.length,
      'Cache-Control': versioned ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : file.body);
    return true;
  };

  const safeEqual = (a = '', b = '') => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

  return async function handler(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', CSP);
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname.length > 1 ? url.pathname.replace(/\/$/, '') : url.pathname;
      if ((req.method === 'GET' || req.method === 'HEAD') && serveStatic(req, res, path)) return;
      const session = getSession(db, parseCookies(req.headers.cookie).sid);

      for (const r of routes) {
        const match = r.method === req.method && r.re.exec(path);
        if (!match) continue;
        if (r.role) {
          if (!session) return redirect(res, hasUsers() ? '/login' : '/setup');
          if (r.role !== 'any' && session.role !== r.role) return send(res, 403, v.errorPage({ session, status: 403, title: 'Accès refusé' }));
        }
        const body = req.method === 'POST' ? await readBody(req) : {};
        if (req.method === 'POST' && session && !safeEqual(body._csrf, session.csrf)) {
          return send(res, 403, v.errorPage({ session, status: 403, title: 'Requête refusée', message: 'Jeton de sécurité invalide : rechargez la page et recommencez.' }));
        }
        const secure = req.headers['x-forwarded-proto'] === 'https' || process.env.COOKIE_SECURE === '1';
        return await r.handler({ req, res, url, session, params: match.groups ?? {}, body, secure });
      }
      notFound(res, session);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) send(res, 500, v.errorPage({ status: 500, title: 'Erreur interne', message: 'Une erreur est survenue, réessayez dans un instant.' }));
    }
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  createServer(createApp(openDb())).listen(port, () => console.log(`Tournois de palets : http://localhost:${port}`));
}

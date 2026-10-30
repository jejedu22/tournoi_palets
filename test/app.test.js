import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { openDb } from '../src/db.js';
import { createApp } from '../src/server.js';

// Client HTTP minimal avec cookie + jeton CSRF
async function boot() {
  const db = openDb(':memory:');
  const server = createServer(createApp(db));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    const call = async (method, path, form) => {
      const res = await fetch(base + path, {
        method, redirect: 'manual',
        headers: { cookie, ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
        body: form ? new URLSearchParams(form) : undefined,
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: res.status, location: res.headers.get('location'), text: await res.text() };
    };
    const token = async (path) => /name="_csrf" value="([0-9a-f]+)"/.exec((await call('GET', path)).text)?.[1];
    return { call, token };
  };
  return { db, server, client, close: () => server.close() };
}

test('parcours complet + isolation entre associations', async () => {
  const { db, client, close } = await boot();
  try {
    const root = client();
    assert.equal((await root.call('GET', '/login')).location, '/setup');
    await root.call('POST', '/setup', { name: 'Root', email: 'root@x.fr', password: 'motdepasse1' });
    assert.equal((await root.call('POST', '/login', { email: 'root@x.fr', password: 'motdepasse1' })).location, '/');

    let t = await root.token('/associations');
    await root.call('POST', '/associations', { _csrf: t, name: 'Palet Club A' });
    await root.call('POST', '/associations', { _csrf: t, name: 'Palet Club B' });
    const [a, b] = db.prepare('SELECT id FROM associations ORDER BY id').all().map((x) => x.id);
    t = await root.token(`/associations/${a}`);
    await root.call('POST', `/associations/${a}/admins`, { _csrf: t, name: 'Adm A', email: 'a@x.fr', password: 'motdepasse1' });
    await root.call('POST', `/associations/${b}/admins`, { _csrf: t, name: 'Adm B', email: 'b@x.fr', password: 'motdepasse1' });

    const admA = client(), admB = client();
    await admA.call('POST', '/login', { email: 'a@x.fr', password: 'motdepasse1' });
    await admB.call('POST', '/login', { email: 'b@x.fr', password: 'motdepasse1' });

    // un admin d'association ne peut pas gérer les associations
    assert.equal((await admA.call('GET', '/associations')).status, 403);

    // création d'un tournoi : 8 équipes, 2 poules, demi-finales, consolante
    t = await admA.token('/tournois/nouveau');
    const bad = await admA.call('POST', '/tournois', { _csrf: t, name: 'X', nb_teams: 4, nb_pools: 2, finals_rounds: 3 });
    assert.equal(bad.status, 400);
    const created = await admA.call('POST', '/tournois', { _csrf: t, name: 'Open de Brest', date: '2026-11-01', nb_teams: 8, nb_pools: 2, finals_rounds: 2, consolante: '1' });
    const tid = /\/tournois\/(\d+)/.exec(created.location)[1];

    // isolation : l'association B ne voit ni ne modifie le tournoi de A
    assert.equal((await admB.call('GET', `/tournois/${tid}`)).status, 404);
    assert.ok(!(await admB.call('GET', '/tournois')).text.includes('Open de Brest'));
    t = await admB.token('/tournois');
    assert.equal((await admB.call('POST', `/tournois/${tid}/supprimer`, { _csrf: t })).status, 404);
    // CSRF requis
    assert.equal((await admA.call('POST', `/tournois/${tid}/poules`, { _csrf: 'faux' })).status, 403);

    t = await admA.token(`/tournois/${tid}`);
    await admA.call('POST', `/tournois/${tid}/poules`, { _csrf: t });
    const pm = db.prepare("SELECT id FROM matches WHERE tournament_id = ? AND phase = 'pool'").all(Number(tid));
    assert.equal(pm.length, 12); // 2 poules de 4 : 6 matchs chacune

    // finales refusées tant que les poules ne sont pas terminées
    t = await admA.token(`/tournois/${tid}`);
    await admA.call('POST', `/tournois/${tid}/finales`, { _csrf: t });
    assert.equal(db.prepare('SELECT status FROM tournaments WHERE id = ?').get(Number(tid)).status, 'pools');

    // nul refusé, puis on joue tout (équipe 1 du match gagne 13-x)
    const first = pm[0].id;
    await admA.call('POST', `/tournois/${tid}/matchs/${first}`, { _csrf: t, score1: 5, score2: 5 });
    assert.equal(db.prepare('SELECT score1 FROM matches WHERE id = ?').get(first).score1, null);
    for (const m of pm) await admA.call('POST', `/tournois/${tid}/matchs/${m.id}`, { _csrf: t, score1: 13, score2: m.id % 12 });

    await admA.call('POST', `/tournois/${tid}/finales`, { _csrf: t });
    const count = (phase) => db.prepare('SELECT COUNT(*) c FROM matches WHERE tournament_id = ? AND phase = ?').get(Number(tid), phase).c;
    assert.equal(count('main'), 4);       // 2 demies + finale + petite finale
    assert.equal(count('consolante'), 4); // 4 éliminés : idem

    // petite finale : vide tant que les demies ne sont pas jouées
    const thirdMatch = () => db.prepare("SELECT * FROM matches WHERE tournament_id = ? AND phase = 'main' AND third = 1").get(Number(tid));
    assert.equal(thirdMatch().team1_id, null);
    const semis = db.prepare("SELECT * FROM matches WHERE tournament_id = ? AND phase = 'main' AND round = 1 ORDER BY pos").all(Number(tid));
    await admA.call('POST', `/tournois/${tid}/matchs/${semis[0].id}`, { _csrf: t, score1: 13, score2: 2 });
    await admA.call('POST', `/tournois/${tid}/matchs/${semis[1].id}`, { _csrf: t, score1: 3, score2: 13 });
    const s0 = db.prepare('SELECT * FROM matches WHERE id = ?').get(semis[0].id);
    const s1 = db.prepare('SELECT * FROM matches WHERE id = ?').get(semis[1].id);
    assert.equal(thirdMatch().team1_id, s0.team2_id); // perdants des demies
    assert.equal(thirdMatch().team2_id, s1.team1_id);

    // on joue le tableau principal jusqu'au bout
    for (const phase of ['main', 'consolante']) {
      for (let round = 1; round <= 2; round++) {
        const ms = db.prepare('SELECT id FROM matches WHERE tournament_id = ? AND phase = ? AND round = ?').all(Number(tid), phase, round);
        for (const m of ms) await admA.call('POST', `/tournois/${tid}/matchs/${m.id}`, { _csrf: t, score1: 13, score2: 4 });
      }
    }
    const final = db.prepare("SELECT * FROM matches WHERE tournament_id = ? AND phase = 'main' AND round = 2 AND third = 0").get(Number(tid));
    assert.ok(final.winner_id);
    assert.equal(thirdMatch().winner_id, thirdMatch().team1_id); // 13-4 pour la première équipe
    // modifier une demi-finale alors que la finale est jouée avec un autre vainqueur est refusé
    const semi = db.prepare("SELECT * FROM matches WHERE tournament_id = ? AND phase = 'main' AND round = 1 AND pos = 0").get(Number(tid));
    await admA.call('POST', `/tournois/${tid}/matchs/${semi.id}`, { _csrf: t, score1: 1, score2: 13 });
    assert.equal(db.prepare('SELECT score1 FROM matches WHERE id = ?').get(semi.id).score1, 13);

    const page = await admA.call('GET', `/tournois/${tid}`);
    assert.ok(page.text.includes('Vainqueur'));
  } finally { close(); }
});

test('échappement HTML des noms', async () => {
  const { db, client, close } = await boot();
  try {
    const root = client();
    await root.call('POST', '/setup', { name: 'R', email: 'r@x.fr', password: 'motdepasse1' });
    await root.call('POST', '/login', { email: 'r@x.fr', password: 'motdepasse1' });
    const t = await root.token('/associations');
    await root.call('POST', '/associations', { _csrf: t, name: '<script>alert(1)</script>' });
    const page = await root.call('GET', '/associations');
    assert.ok(!page.text.includes('<script>alert(1)'));
    assert.ok(page.text.includes('&lt;script&gt;'));
  } finally { close(); }
});

test('healthz et limitation des connexions par IP derrière un proxy', async () => {
  const { server, client, close } = await boot();
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const c = client();
    const r = await c.call('GET', '/healthz');
    assert.equal(r.status, 200);
    assert.equal(r.text, 'ok');

    await c.call('POST', '/setup', { name: 'R', email: 'r@x.fr', password: 'motdepasse1' });
    process.env.TRUST_PROXY = '1';
    const login = (ip, password) => fetch(`${base}/login`, {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': `9.9.9.9, ${ip}` },
      body: new URLSearchParams({ email: 'r@x.fr', password }),
    }).then((x) => decodeURIComponent(x.headers.get('location')));
    for (let i = 0; i < 10; i++) assert.match(await login('1.1.1.1', 'mauvais'), /incorrects/);
    assert.match(await login('1.1.1.1', 'motdepasse1'), /Trop de tentatives/); // IP bloquée
    assert.equal(await login('2.2.2.2', 'motdepasse1'), '/');                  // une autre IP n'est pas touchée
  } finally { delete process.env.TRUST_PROXY; close(); }
});

test('PWA : manifeste, service worker, fichiers statiques et CSP', async () => {
  const { server, close } = await boot();
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const login = await fetch(`${base}/login`, { redirect: 'manual' });
    assert.match(login.headers.get('content-security-policy'), /script-src 'self'/);

    const setup = await (await fetch(`${base}/setup`)).text();
    assert.match(setup, /<link rel="manifest" href="\/manifest.webmanifest">/);
    const css = /href="(\/static\/app\.css\?v=[0-9a-f]+)"/.exec(setup)[1];

    const manifest = await fetch(`${base}/manifest.webmanifest`);
    assert.equal(manifest.headers.get('content-type'), 'application/manifest+json');
    const m = await manifest.json();
    assert.equal(m.display, 'standalone');
    assert.ok(m.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'));
    assert.ok(!JSON.stringify(m).includes('__VERSION__'));
    for (const icon of m.icons) assert.equal((await fetch(base + icon.src)).status, 200, icon.src);

    const sw = await fetch(`${base}/sw.js`);
    assert.equal(sw.headers.get('cache-control'), 'no-cache');
    assert.match(sw.headers.get('content-type'), /javascript/);
    assert.ok(!(await sw.text()).includes('__VERSION__'));

    const cssRes = await fetch(base + css);
    assert.equal(cssRes.status, 200);
    assert.match(cssRes.headers.get('cache-control'), /immutable/);
    assert.equal((await fetch(`${base}/offline.html`)).status, 200);

    assert.equal((await fetch(`${base}/static/inconnu.js`, { redirect: 'manual' })).status, 404);
    assert.notEqual((await fetch(`${base}/static/..%2Fpackage.json`, { redirect: 'manual' })).status, 200);
  } finally { close(); }
});

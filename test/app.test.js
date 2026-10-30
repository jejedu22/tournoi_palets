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
    assert.equal(count('main'), 3);       // 2 demies + finale
    assert.equal(count('consolante'), 3); // 4 éliminés : 2 demies + finale

    // on joue le tableau principal jusqu'au bout
    for (const phase of ['main', 'consolante']) {
      for (let round = 1; round <= 2; round++) {
        const ms = db.prepare('SELECT id FROM matches WHERE tournament_id = ? AND phase = ? AND round = ?').all(Number(tid), phase, round);
        for (const m of ms) await admA.call('POST', `/tournois/${tid}/matchs/${m.id}`, { _csrf: t, score1: 13, score2: 4 });
      }
    }
    const final = db.prepare("SELECT * FROM matches WHERE tournament_id = ? AND phase = 'main' AND round = 2").get(Number(tid));
    assert.ok(final.winner_id);
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

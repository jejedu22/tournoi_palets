import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, finalsFormat, tournamentFormat, poolSizes, drawPools, roundRobin, standings, selectQualifiers, seedOrder, buildBracket } from '../src/logic.js';

test('validateConfig', () => {
  const cfg = (o) => validateConfig({ nbTeams: 16, nbPools: 4, perPool: 2, fill: 'best', consolante: true, ...o });
  assert.equal(cfg({}), null);
  assert.match(cfg({ nbTeams: 7 }), /2 équipes par poule/);
  assert.match(cfg({ perPool: 4 }), /au plus 3 par poule/);       // poules de 4 : impossible de qualifier tout le monde
  assert.match(cfg({ perPool: 0 }), /entre 1 et 4/);
  assert.match(cfg({ fill: 'autre' }), /compléter le tableau/);
  assert.equal(cfg({ nbTeams: 6, nbPools: 2, perPool: 2 }), null);                    // 4 qualifiés, 2 en consolante
  assert.match(cfg({ nbTeams: 4, nbPools: 1, perPool: 3 }), /Consolante impossible/); // 3 + 1 repêché : personne en consolante
  assert.equal(cfg({ nbTeams: 4, nbPools: 1, perPool: 3, consolante: false }), null);
  assert.match(cfg({ nbTeams: 2, nbPools: 1, perPool: 1 }), /au moins 2 équipes qualifiées/);
  // 3 poules × 3 = 9 → tableau de 16 : 7 repêchés pour 3 poules, impossible ; les exemptions fonctionnent
  assert.match(cfg({ nbTeams: 15, nbPools: 3, perPool: 3 }), /exemptions/);
  assert.equal(cfg({ nbTeams: 15, nbPools: 3, perPool: 3, fill: 'bye' }), null);
});

test('finalsFormat : 16 équipes, 4 poules, 2 premiers → quarts de finale', () => {
  const f = finalsFormat({ nbTeams: 16, nbPools: 4, perPool: 2, fill: 'best' });
  assert.deepEqual([f.direct, f.size, f.rounds, f.extra, f.byes, f.eliminated], [8, 8, 3, 0, 0, 8]);
  // 3 poules × 2 = 6 qualifiés pour un tableau de 8
  const best = finalsFormat({ nbTeams: 12, nbPools: 3, perPool: 2, fill: 'best' });
  assert.deepEqual([best.size, best.extra, best.byes, best.qualified, best.eliminated], [8, 2, 0, 8, 4]);
  const bye = finalsFormat({ nbTeams: 12, nbPools: 3, perPool: 2, fill: 'bye' });
  assert.deepEqual([bye.size, bye.extra, bye.byes, bye.qualified, bye.eliminated], [8, 0, 2, 6, 6]);
  // tournoi créé avant le choix des qualifiés (seulement finals_rounds) : ancien calcul conservé
  const legacy = tournamentFormat({ nb_teams: 16, nb_pools: 4, finals_rounds: 2, qualifiers_per_pool: null });
  assert.deepEqual([legacy.perPool, legacy.extra, legacy.size], [1, 0, 4]);
});

test('poolSizes / drawPools', () => {
  assert.deepEqual(poolSizes(10, 3), [4, 3, 3]);
  const pools = drawPools([1, 2, 3, 4, 5, 6, 7], 2, () => 0.3);
  assert.deepEqual(pools.map((p) => p.length), [4, 3]);
  assert.deepEqual(pools.flat().sort(), [1, 2, 3, 4, 5, 6, 7]);
});

test('roundRobin : chaque paire se rencontre une seule fois', () => {
  for (const n of [2, 3, 4, 5, 6]) {
    const ids = Array.from({ length: n }, (_, i) => i + 1);
    const ms = roundRobin(ids);
    assert.equal(ms.length, (n * (n - 1)) / 2);
    assert.equal(new Set(ms.map((m) => [m.a, m.b].sort().join('-'))).size, ms.length);
  }
});

test('standings : victoires égales, départage à la différence de points', () => {
  const ms = [
    { team1_id: 1, team2_id: 2, score1: 13, score2: 5 },
    { team1_id: 1, team2_id: 3, score1: 6, score2: 13 },
    { team1_id: 2, team2_id: 3, score1: 13, score2: 12 },
  ];
  // Tous à 1 victoire : diff équipe 3 = +6, équipe 1 = +1, équipe 2 = -7
  const rows = standings([1, 2, 3], ms);
  assert.deepEqual(rows.map((r) => r.id), [3, 1, 2]);
  assert.deepEqual(rows.map((r) => r.diff), [6, 1, -7]);
});

test('selectQualifiers : k par poule + meilleurs suivants', () => {
  const row = (id, wins, diff = 0) => ({ id, wins, diff, pf: 0 });
  const A = [row(1, 3), row(2, 2), row(3, 1), row(4, 0)];
  const B = [row(5, 3), row(6, 2), row(7, 0)];
  const C = [row(8, 3), row(9, 2), row(10, 1)];
  // 8 qualifiés, 3 poules : 2 par poule + 2 meilleurs 3es (3 et 10 ont 1 victoire, 7 a 0)
  const { qualified, eliminated } = selectQualifiers([A, B, C], 2, 2);
  assert.equal(qualified.length, 8);
  assert.deepEqual(qualified.slice(0, 3).sort(), [1, 5, 8]);
  assert.ok(qualified.includes(3) && qualified.includes(10) && !qualified.includes(7));
  assert.deepEqual([...qualified, ...eliminated].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  // sans repêchage : seulement les 2 premiers de chaque poule
  const noExtra = selectQualifiers([A, B, C], 2);
  assert.deepEqual(noExtra.qualified.slice().sort((a, b) => a - b), [1, 2, 5, 6, 8, 9]);
});

test('seedOrder / buildBracket', () => {
  assert.deepEqual(seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
  const full = buildBracket([1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(full.length, 8); // 7 matchs + petite finale
  const third = full.filter((m) => m.third);
  assert.equal(third.length, 1);
  assert.equal(third[0].round, 3);
  assert.ok(full.filter((m) => m.round === 1).every((m) => m.team1 && m.team2 && !m.bye));
  // 6 équipes : têtes de série 1 et 2 exemptées, propagées en demi-finale
  const six = buildBracket([1, 2, 3, 4, 5, 6]);
  const byes = six.filter((m) => m.bye);
  assert.deepEqual(byes.map((m) => m.winner).sort(), [1, 2]);
  const semi = six.filter((m) => m.round === 2).sort((x, y) => x.pos - y.pos);
  assert.deepEqual(semi.map((m) => [m.team1, m.team2]), [[1, null], [2, null]]);
  assert.equal(buildBracket([1, 2, 3, 4]).filter((m) => m.third).length, 1);
  // 3 équipes : une demi-finale est une exemption, donc pas de petite finale ; 2 équipes : la finale seule
  assert.equal(buildBracket([1, 2, 3]).filter((m) => m.third).length, 0);
  assert.equal(buildBracket([1, 2]).length, 1);
  assert.throws(() => buildBracket([1]));
});

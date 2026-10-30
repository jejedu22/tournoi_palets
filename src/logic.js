// Logique pure des tournois : poules, classements, tableaux à élimination directe.
// Aucune dépendance à la base ni au serveur, pour être facile à tester.

export const ROUND_OPTIONS = [
  { value: 1, label: 'Finale uniquement (2 équipes)' },
  { value: 2, label: 'Demi-finales (4 équipes)' },
  { value: 3, label: 'Quarts de finale (8 équipes)' },
  { value: 4, label: 'Huitièmes de finale (16 équipes)' },
  { value: 5, label: 'Seizièmes de finale (32 équipes)' },
];

export function roundName(matchesInRound) {
  switch (matchesInRound) {
    case 1: return 'Finale';
    case 2: return 'Demi-finales';
    case 4: return 'Quarts de finale';
    case 8: return 'Huitièmes de finale';
    case 16: return 'Seizièmes de finale';
    default: return `Tour de ${matchesInRound * 2}`;
  }
}

/** Taille des poules : répartit nbTeams sur nbPools (écart max 1). */
export function poolSizes(nbTeams, nbPools) {
  const base = Math.floor(nbTeams / nbPools);
  const extra = nbTeams % nbPools;
  return Array.from({ length: nbPools }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * Vérifie la configuration d'un tournoi. Retourne un message d'erreur (fr) ou null.
 */
export function validateConfig({ nbTeams, nbPools, finalsRounds, consolante }) {
  if (![nbTeams, nbPools, finalsRounds].every(Number.isInteger)) return 'Valeurs numériques invalides.';
  if (nbTeams < 2 || nbTeams > 128) return "Le nombre d'équipes doit être compris entre 2 et 128.";
  if (nbPools < 1 || nbPools > 32) return 'Le nombre de poules doit être compris entre 1 et 32.';
  if (nbTeams < nbPools * 2) return 'Il faut au moins 2 équipes par poule.';
  if (finalsRounds < 1 || finalsRounds > 5) return 'Phase finale invalide.';

  const qualified = 2 ** finalsRounds;
  if (qualified > nbTeams) {
    return `La phase finale choisie nécessite ${qualified} équipes qualifiées, mais il n'y a que ${nbTeams} équipes.`;
  }
  const sizes = poolSizes(nbTeams, nbPools);
  const perPool = Math.floor(qualified / nbPools);
  const remainder = qualified - perPool * nbPools;
  if (sizes.some((s) => s < perPool)) return 'Certaines poules sont trop petites pour le nombre de qualifiés requis.';
  if (remainder > sizes.filter((s) => s > perPool).length) {
    return 'Impossible de désigner les meilleurs suivants : réduisez la phase finale ou le nombre de poules.';
  }
  if (consolante && nbTeams - qualified < 2) {
    return 'Consolante impossible : il faut au moins 2 équipes éliminées en poule (réduisez la phase finale).';
  }
  return null;
}

/** Tirage au sort : mélange (Fisher-Yates) puis distribution en poules. */
export function drawPools(teamIds, nbPools, rng = Math.random) {
  const ids = [...teamIds];
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const sizes = poolSizes(ids.length, nbPools);
  const pools = [];
  let k = 0;
  for (const size of sizes) {
    pools.push(ids.slice(k, k + size));
    k += size;
  }
  return pools;
}

/** Toutes les rencontres d'une poule (méthode du cercle) : [{round, a, b}] */
export function roundRobin(teamIds) {
  const list = [...teamIds];
  if (list.length % 2 === 1) list.push(null);
  const n = list.length;
  const out = [];
  for (let r = 0; r < n - 1; r++) {
    for (let i = 0; i < n / 2; i++) {
      const a = list[i];
      const b = list[n - 1 - i];
      if (a !== null && b !== null) out.push({ round: r + 1, a, b });
    }
    list.splice(1, 0, list.pop());
  }
  return out;
}

/**
 * Classement d'une poule. matches : [{team1_id, team2_id, score1, score2}] (score null = non joué)
 * Tri : victoires, différence de points, points marqués, puis confrontation directe, puis id.
 */
export function standings(teamIds, matches) {
  const rows = new Map(teamIds.map((id) => [id, { id, played: 0, wins: 0, losses: 0, pf: 0, pa: 0, diff: 0 }]));
  for (const m of matches) {
    if (m.score1 == null || m.score2 == null) continue;
    const a = rows.get(m.team1_id);
    const b = rows.get(m.team2_id);
    if (!a || !b) continue;
    a.played++; b.played++;
    a.pf += m.score1; a.pa += m.score2;
    b.pf += m.score2; b.pa += m.score1;
    if (m.score1 > m.score2) { a.wins++; b.losses++; } else { b.wins++; a.losses++; }
  }
  for (const r of rows.values()) r.diff = r.pf - r.pa;

  const headToHead = (x, y) => {
    const m = matches.find((q) => q.score1 != null &&
      ((q.team1_id === x.id && q.team2_id === y.id) || (q.team1_id === y.id && q.team2_id === x.id)));
    if (!m) return 0;
    const xWon = (m.team1_id === x.id) === (m.score1 > m.score2);
    return xWon ? -1 : 1;
  };
  return [...rows.values()].sort((x, y) =>
    y.wins - x.wins || y.diff - x.diff || y.pf - x.pf || headToHead(x, y) || x.id - y.id);
}

const compareRows = (x, y) => y.wins - x.wins || y.diff - x.diff || y.pf - x.pf || x.id - y.id;

/**
 * À partir des classements de chaque poule (tableaux de lignes triées), retourne
 * { qualified: [ids ordonnés par tête de série], eliminated: [ids ordonnés par force] }.
 * On prend les k premiers de chaque poule puis, s'il manque des places, les meilleurs (k+1)ᵉ.
 */
export function selectQualifiers(poolStandings, count) {
  const nbPools = poolStandings.length;
  const perPool = Math.floor(count / nbPools);
  const remainder = count - perPool * nbPools;

  const bestThirds = poolStandings
    .map((p) => p[perPool])
    .filter(Boolean)
    .sort(compareRows)
    .slice(0, remainder);
  const extraIds = new Set(bestThirds.map((r) => r.id));

  const order = (filterFn) => {
    const maxLen = Math.max(...poolStandings.map((p) => p.length));
    const out = [];
    for (let rank = 0; rank < maxLen; rank++) {
      const group = poolStandings.map((p) => p[rank]).filter((r) => r && filterFn(r, rank));
      out.push(...group.sort(compareRows).map((r) => r.id));
    }
    return out;
  };
  const isQualified = (r, rank) => rank < perPool || extraIds.has(r.id);
  return {
    qualified: order(isQualified),
    eliminated: order((r, rank) => !isQualified(r, rank)),
  };
}

/** Ordre standard des têtes de série dans un tableau de `size` places (puissance de 2). */
export function seedOrder(size) {
  let order = [1];
  while (order.length < size) {
    const total = order.length * 2;
    order = order.flatMap((s) => [s, total + 1 - s]);
  }
  return order;
}

/**
 * Construit un tableau à élimination directe pour des équipes classées par tête de série.
 * Les têtes de série les mieux classées sont exemptées si le nombre n'est pas une puissance de 2.
 * Retourne [{round, pos, team1, team2, winner, bye}] ; les vainqueurs d'exemptions sont déjà propagés.
 */
export function buildBracket(seeds) {
  const n = seeds.length;
  if (n < 2) throw new Error('Un tableau nécessite au moins 2 équipes.');
  let size = 1;
  while (size < n) size *= 2;
  const rounds = Math.log2(size);

  const grid = [];
  for (let r = 1; r <= rounds; r++) {
    grid[r] = Array.from({ length: size / 2 ** r }, (_, pos) => ({
      round: r, pos, team1: null, team2: null, winner: null, bye: false,
    }));
  }
  const order = seedOrder(size);
  grid[1].forEach((m, pos) => {
    m.team1 = seeds[order[2 * pos] - 1] ?? null;
    m.team2 = seeds[order[2 * pos + 1] - 1] ?? null;
    if (m.team1 === null || m.team2 === null) {
      m.bye = true;
      m.winner = m.team1 ?? m.team2;
      const next = grid[2]?.[Math.floor(pos / 2)];
      if (next) next[pos % 2 === 0 ? 'team1' : 'team2'] = m.winner;
    }
  });
  return grid.slice(1).flat();
}

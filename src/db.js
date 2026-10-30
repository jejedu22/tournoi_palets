import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

/** Jeton du lien public d'un tournoi : non devinable, sans rapport avec l'identifiant interne. */
export const newPublicToken = () => randomBytes(12).toString('base64url');

export function openDb(path = process.env.DB_PATH || 'data/tournoi.db') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS associations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('superadmin', 'admin')),
      association_id INTEGER REFERENCES associations(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      csrf TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tournaments (
      id INTEGER PRIMARY KEY,
      association_id INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      date TEXT,
      nb_teams INTEGER NOT NULL,
      nb_pools INTEGER NOT NULL,
      finals_rounds INTEGER NOT NULL,
      consolante INTEGER NOT NULL DEFAULT 0,
      qualifiers_per_pool INTEGER,
      fill_mode TEXT CHECK (fill_mode IN ('best', 'bye')),
      public_token TEXT,
      public_enabled INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'setup' CHECK (status IN ('setup', 'pools', 'finals')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY,
      tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      pool INTEGER
    );
    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY,
      tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      phase TEXT NOT NULL CHECK (phase IN ('pool', 'main', 'consolante')),
      pool INTEGER,
      round INTEGER NOT NULL,
      pos INTEGER NOT NULL DEFAULT 0,
      team1_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
      team2_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
      score1 INTEGER,
      score2 INTEGER,
      winner_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
      bye INTEGER NOT NULL DEFAULT 0,
      third INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS password_resets (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tournaments_assoc ON tournaments(association_id);
    CREATE INDEX IF NOT EXISTS idx_matches_tournament ON matches(tournament_id);
  `);
  // Migrations des bases existantes (colonnes ajoutées après coup)
  const addColumn = (table, column, definition) => {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  };
  addColumn('matches', 'third', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('tournaments', 'qualifiers_per_pool', 'INTEGER');
  addColumn('tournaments', 'fill_mode', "TEXT CHECK (fill_mode IN ('best', 'bye'))");
  addColumn('tournaments', 'public_token', 'TEXT');
  addColumn('tournaments', 'public_enabled', 'INTEGER NOT NULL DEFAULT 1');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_tournaments_public_token ON tournaments(public_token)');
  const setToken = db.prepare('UPDATE tournaments SET public_token = ? WHERE id = ?');
  for (const { id } of db.prepare('SELECT id FROM tournaments WHERE public_token IS NULL').all()) setToken.run(newPublicToken(), id);
  return db;
}

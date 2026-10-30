import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(':');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

export function createSession(db, userId) {
  const token = randomBytes(32).toString('hex');
  const csrf = randomBytes(16).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, csrf, expires_at) VALUES (?, ?, ?, ?)')
    .run(token, userId, csrf, Date.now() + SESSION_TTL_MS);
  return token;
}

export function getSession(db, token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT s.token, s.csrf, s.expires_at, u.id AS user_id, u.email, u.name, u.role, u.association_id
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`).get(token);
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    destroySession(db, token);
    return null;
  }
  return row;
}

export function destroySession(db, token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

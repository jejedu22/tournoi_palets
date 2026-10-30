import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

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

// ---------- Réinitialisation du mot de passe ----------
// Seule l'empreinte du jeton est stockée : une fuite de la base ne permet pas de réinitialiser un compte.

export const RESET_TTL_EMAIL_MS = 60 * 60 * 1000;        // lien envoyé par e-mail : 1 heure
export const RESET_TTL_MANUAL_MS = 24 * 60 * 60 * 1000;  // lien transmis par le super-administrateur : 24 heures

const digest = (token) => createHash('sha256').update(String(token)).digest('hex');

export function createResetToken(db, userId, ttlMs) {
  const token = randomBytes(32).toString('base64url');
  db.prepare('DELETE FROM password_resets WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(digest(token), userId, Date.now() + ttlMs);
  return token;
}

/** Utilisateur associé à un jeton valide (non expiré), ou null. */
export function findResetUser(db, token) {
  const row = db.prepare(`SELECT u.id, u.email, u.name FROM password_resets r JOIN users u ON u.id = r.user_id
    WHERE r.token_hash = ? AND r.expires_at >= ?`).get(digest(token), Date.now());
  return row ?? null;
}

/** Change le mot de passe, invalide tous les jetons et toutes les sessions du compte. */
export function resetPassword(db, userId, password) {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), userId);
  db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

/** Changement par l'utilisateur connecté : ses autres sessions sont fermées, la session en cours est conservée. */
export function changePassword(db, userId, password, currentSessionToken) {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), userId);
  db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(userId, currentSessionToken);
}

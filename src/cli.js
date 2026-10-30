// Commandes d'administration, à lancer sur le serveur (par exemple : docker compose exec palets node src/cli.js …).
import { openDb } from './db.js';
import { createResetToken, RESET_TTL_MANUAL_MS } from './auth.js';

const [command, email] = process.argv.slice(2);

if (command === 'lien-reinitialisation' && email) {
  const db = openDb();
  const user = db.prepare('SELECT id, name FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (!user) {
    console.error(`Aucun compte avec l'adresse ${email}.`);
    process.exit(1);
  }
  const token = createResetToken(db, user.id, RESET_TTL_MANUAL_MS);
  const base = process.env.PUBLIC_URL?.replace(/\/$/, '') || `http://localhost:${process.env.PORT || 3000}`;
  console.log(`Lien de réinitialisation pour ${user.name} (valable 24 heures, utilisable une fois) :`);
  console.log(`${base}/reinitialiser/${token}`);
} else {
  console.log('Usage : node src/cli.js lien-reinitialisation <e-mail>');
  process.exit(command ? 1 : 0);
}

import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.js';
import { createApp } from '../src/server.js';
import { hashPassword, findResetUser } from '../src/auth.js';
import { sendMail } from '../src/mail.js';

// Faux serveur SMTP : accepte tout ; next() rend le prochain message non encore lu
async function fakeSmtp() {
  const unread = [];
  const waiters = [];
  const server = net.createServer((sock) => {
    let buf = '', inData = false, data = '', current = {};
    sock.write('220 faux-smtp ESMTP\r\n');
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            const mail = { ...current, data };
            const waiter = waiters.shift();
            if (waiter) waiter(mail); else unread.push(mail);
            current = {}; data = '';
            sock.write('250 OK reçu\r\n');
          } else data += `${line.replace(/^\.\./, '.')}\r\n`;
          continue;
        }
        const [cmd] = line.split(' ');
        if (cmd === 'EHLO') sock.write('250-faux-smtp\r\n250 AUTH PLAIN\r\n');
        else if (cmd === 'AUTH') { current.auth = Buffer.from(line.split(' ')[2], 'base64').toString('utf8').split('\0'); sock.write('235 OK\r\n'); }
        else if (cmd === 'MAIL') { current.from = line; sock.write('250 OK\r\n'); }
        else if (cmd === 'RCPT') { current.to = line; sock.write('250 OK\r\n'); }
        else if (cmd === 'DATA') { inData = true; sock.write('354 Allez-y\r\n'); }
        else if (cmd === 'QUIT') { sock.end('221 Au revoir\r\n'); }
        else sock.write('502 Inconnu\r\n');
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: server.address().port,
    next: (ms = 3000) => new Promise((resolve, reject) => {
      if (unread.length) return resolve(unread.shift());
      const waiter = (m) => { clearTimeout(t); resolve(m); };
      // à l'expiration, l'attente est retirée pour ne pas capter le message suivant
      const t = setTimeout(() => { waiters.splice(waiters.indexOf(waiter), 1); reject(new Error('aucun e-mail reçu')); }, ms);
      waiters.push(waiter);
    }),
    close: () => server.close(),
  };
}

const decodeBody = (data) => Buffer.from(data.split('\r\n\r\n').slice(1).join('').replace(/\s/g, ''), 'base64').toString('utf8');
const header = (data, name) => new RegExp(`^${name}: (.*)$`, 'mi').exec(data)?.[1];

async function boot() {
  const db = openDb(':memory:');
  const server = createServer(createApp(db));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    const call = async (method, path, form, headers = {}) => {
      const res = await fetch(base + path, {
        method, redirect: 'manual',
        headers: { cookie, ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), ...headers },
        body: form ? new URLSearchParams(form) : undefined,
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: res.status, location: res.headers.get('location'), text: await res.text() };
    };
    const token = async (path) => /name="_csrf" value="([0-9a-f]+)"/.exec((await call('GET', path)).text)?.[1];
    return { call, token };
  };
  // un super-administrateur, une association et son administrateur
  db.prepare("INSERT INTO users (email, name, password_hash, role) VALUES ('root@x.fr', 'Root', ?, 'superadmin')").run(hashPassword('motdepasse1'));
  db.prepare("INSERT INTO associations (name) VALUES ('Club A'), ('Club B')").run();
  db.prepare("INSERT INTO users (email, name, password_hash, role, association_id) VALUES ('maiwenn@x.fr', 'Maïwenn', ?, 'admin', 1)").run(hashPassword('ancienmotdepasse'));
  return { db, base, client, close: () => server.close() };
}

const ENV = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_SECURE', 'MAIL_FROM', 'PUBLIC_URL'];
const withEnv = async (values, fn) => {
  const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  Object.assign(process.env, values);
  try { return await fn(); } finally {
    for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
};

test('mot de passe oublié sans e-mail configuré : renvoie vers le super-administrateur', async () => {
  const { client, close } = await boot();
  try {
    await withEnv({}, async () => {
      const c = client();
      assert.match((await c.call('GET', '/login')).text, /href="\/mot-de-passe-oublie"/);
      const page = await c.call('GET', '/mot-de-passe-oublie');
      assert.match(page.text, /pas configuré/);
      assert.ok(!page.text.includes('name="email"'));
      // même avec SMTP mais sans PUBLIC_URL : désactivé (pas de lien construit depuis l'en-tête Host)
      process.env.SMTP_HOST = '127.0.0.1'; process.env.MAIL_FROM = 'x@palets.test';
      assert.match((await c.call('GET', '/mot-de-passe-oublie')).text, /pas configuré/);
    });
  } finally { close(); }
});

test('mot de passe oublié par e-mail : parcours complet', async () => {
  const smtp = await fakeSmtp();
  const { db, client, close } = await boot();
  try {
    await withEnv({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port), SMTP_USER: 'compte', SMTP_PASS: 'secret',
      MAIL_FROM: 'Palets Bretons <noreply@palets.test>', PUBLIC_URL: 'https://palets.test/' }, async () => {
      const visitor = client();
      const form = await visitor.call('GET', '/mot-de-passe-oublie');
      assert.ok(form.text.includes('name="email"'));

      // adresse inconnue : même réponse, aucun e-mail
      const unknown = await visitor.call('POST', '/mot-de-passe-oublie', { email: 'inconnu@x.fr' });
      assert.equal(unknown.status, 200);
      await assert.rejects(smtp.next(400));

      // adresse connue (casse et espaces ignorés), en-tête Host piégé : le lien utilise PUBLIC_URL
      const known = await visitor.call('POST', '/mot-de-passe-oublie', { email: '  Maiwenn@X.fr ' }, { host: 'attaquant.example' });
      assert.equal(known.status, 200);
      assert.equal(known.text, unknown.text); // réponses identiques
      const mail = await smtp.next();
      assert.deepEqual(mail.auth, ['', 'compte', 'secret']);
      assert.equal(mail.from, 'MAIL FROM:<noreply@palets.test>');
      assert.equal(mail.to, 'RCPT TO:<maiwenn@x.fr>');
      assert.equal(header(mail.data, 'Subject'), `=?UTF-8?B?${Buffer.from('Réinitialisation de votre mot de passe – Palets Bretons').toString('base64')}?=`);
      const body = decodeBody(mail.data);
      assert.match(body, /Bonjour Maïwenn/);
      const link = /https:\/\/palets\.test\/reinitialiser\/([\w-]{43})/.exec(body);
      assert.ok(link, body);
      const token = link[1];
      assert.ok(!body.includes('attaquant'));
      // seule l'empreinte du jeton est stockée
      assert.equal(db.prepare('SELECT COUNT(*) c FROM password_resets WHERE token_hash = ?').get(token).c, 0);

      // une session ouverte avant la réinitialisation sera fermée
      const other = client();
      assert.equal((await other.call('POST', '/login', { email: 'maiwenn@x.fr', password: 'ancienmotdepasse' })).location, '/');
      assert.equal((await other.call('GET', '/tournois')).status, 200);

      const page = await visitor.call('GET', `/reinitialiser/${token}`);
      assert.equal(page.status, 200);
      assert.match(page.text, /maiwenn@x\.fr/);
      const mismatch = await visitor.call('POST', `/reinitialiser/${token}`, { password: 'nouveaumotdepasse', confirm: 'autre-chose' });
      assert.match(decodeURIComponent(mismatch.location), /ne correspondent pas/);
      const short = await visitor.call('POST', `/reinitialiser/${token}`, { password: 'court', confirm: 'court' });
      assert.match(decodeURIComponent(short.location), /au moins 8 caractères/);

      const done = await visitor.call('POST', `/reinitialiser/${token}`, { password: 'nouveaumotdepasse', confirm: 'nouveaumotdepasse' });
      assert.match(decodeURIComponent(done.location), /\/login\?ok=Mot de passe modifié/);
      assert.equal((await other.call('GET', '/tournois')).location, '/login');            // session fermée
      assert.equal((await visitor.call('GET', `/reinitialiser/${token}`)).status, 410);   // lien à usage unique
      assert.equal((await visitor.call('POST', `/reinitialiser/${token}`, { password: 'encoreunautre', confirm: 'encoreunautre' })).status, 410);
      assert.match(decodeURIComponent((await client().call('POST', '/login', { email: 'maiwenn@x.fr', password: 'ancienmotdepasse' })).location), /incorrects/);
      assert.equal((await client().call('POST', '/login', { email: 'maiwenn@x.fr', password: 'nouveaumotdepasse' })).location, '/');

      // lien expiré
      await visitor.call('POST', '/mot-de-passe-oublie', { email: 'maiwenn@x.fr' });
      const token2 = /reinitialiser\/([\w-]{43})/.exec(decodeBody((await smtp.next()).data))[1];
      db.prepare('UPDATE password_resets SET expires_at = ?').run(Date.now() - 1);
      assert.equal((await visitor.call('GET', `/reinitialiser/${token2}`)).status, 410);

      // au plus 3 e-mails par heure pour une même adresse (2 déjà envoyés)
      await visitor.call('POST', '/mot-de-passe-oublie', { email: 'maiwenn@x.fr' });
      await smtp.next();
      await visitor.call('POST', '/mot-de-passe-oublie', { email: 'maiwenn@x.fr' });
      await assert.rejects(smtp.next(400));
      // au plus 5 demandes par quart d'heure depuis une même IP (5 déjà faites)
      assert.equal((await visitor.call('POST', '/mot-de-passe-oublie', { email: 'x@x.fr' })).status, 429);
    });
  } finally { close(); smtp.close(); }
});

test('lien de réinitialisation créé par le super-administrateur', async () => {
  const { db, client, close } = await boot();
  try {
    await withEnv({}, async () => {
      const root = client();
      await root.call('POST', '/login', { email: 'root@x.fr', password: 'motdepasse1' });
      const t = await root.token('/associations/1');
      const page = await root.call('POST', '/associations/1/admins/2/lien', { _csrf: t });
      assert.equal(page.status, 200);
      const token = /\/reinitialiser\/([\w-]{43})/.exec(page.text)[1];
      assert.equal(findResetUser(db, token).email, 'maiwenn@x.fr');
      // association qui ne correspond pas à l'administrateur
      assert.equal((await root.call('POST', '/associations/2/admins/2/lien', { _csrf: t })).status, 404);
      // un administrateur d'association ne peut pas créer de lien
      const adm = client();
      await adm.call('POST', '/login', { email: 'maiwenn@x.fr', password: 'ancienmotdepasse' });
      const ta = await adm.token('/tournois');
      assert.equal((await adm.call('POST', '/associations/1/admins/2/lien', { _csrf: ta })).status, 403);
      // le lien fonctionne, même ouvert par quelqu'un de connecté (jeton CSRF inclus)
      const form = await root.call('GET', `/reinitialiser/${token}`);
      const csrf = /name="_csrf" value="([0-9a-f]+)"/.exec(form.text)[1];
      const done = await root.call('POST', `/reinitialiser/${token}`, { _csrf: csrf, password: 'motdepasseneuf', confirm: 'motdepasseneuf' });
      assert.match(decodeURIComponent(done.location), /Mot de passe modifié/);
    });
  } finally { close(); }
});

test('commande lien-reinitialisation (secours du super-administrateur)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'palets-'));
  try {
    const file = join(dir, 'base.db');
    const db = openDb(file);
    db.prepare("INSERT INTO users (email, name, password_hash, role) VALUES ('root@x.fr', 'Root', ?, 'superadmin')").run(hashPassword('motdepasse1'));
    const run = (...args) => spawnSync(process.execPath, ['--no-warnings', 'src/cli.js', ...args],
      { env: { ...process.env, DB_PATH: file, PUBLIC_URL: 'https://palets.test' }, encoding: 'utf8' });
    const ok = run('lien-reinitialisation', 'ROOT@x.fr');
    assert.equal(ok.status, 0, ok.stderr);
    const token = /https:\/\/palets\.test\/reinitialiser\/([\w-]{43})/.exec(ok.stdout)[1];
    assert.equal(findResetUser(db, token).email, 'root@x.fr');
    const missing = run('lien-reinitialisation', 'personne@x.fr');
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /Aucun compte/);
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('sendMail refuse les en-têtes et adresses invalides', async () => {
  await withEnv({ SMTP_HOST: '127.0.0.1', SMTP_PORT: '1', MAIL_FROM: 'noreply@palets.test' }, async () => {
    await assert.rejects(sendMail({ to: 'a@b.fr\r\nBcc: x@y.fr', subject: 'x', text: 'x' }), /Adresse e-mail invalide/);
    await assert.rejects(sendMail({ to: 'a@b.fr', subject: 'x\r\nBcc: x@y.fr', text: 'x' }), /En-tête invalide/);
    await assert.rejects(sendMail({ to: 'pas-une-adresse', subject: 'x', text: 'x' }), /Adresse e-mail invalide/);
  });
  await withEnv({}, async () => {
    await assert.rejects(sendMail({ to: 'a@b.fr', subject: 'x', text: 'x' }), /SMTP non configuré/);
  });
});

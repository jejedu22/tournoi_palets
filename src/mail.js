// Envoi d'e-mails par SMTP, sans dépendance (TLS direct ou STARTTLS, authentification PLAIN).
// Configuration par variables d'environnement : voir .env.exemple.
import net from 'node:net';
import tls from 'node:tls';
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';

const TIMEOUT_MS = 20_000;
const ADDRESS = /^[^\s<>@"]+@[^\s<>@"]+\.[^\s<>@"]+$/;

export const mailConfigured = () => Boolean(process.env.SMTP_HOST && process.env.MAIL_FROM);

function config() {
  const secure = process.env.SMTP_SECURE === '1';
  return {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || (secure ? 465 : 587),
    secure,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM,
    // Uniquement pour un serveur de test au certificat auto-signé
    rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== '0',
  };
}

/** Adresse seule à partir de « Nom <adresse> » ou « adresse ». */
const addressOf = (value) => (/<([^<>]+)>\s*$/.exec(value)?.[1] ?? value).trim();

const encodeHeader = (value) => (/^[\x20-\x7e]*$/.test(value)
  ? value
  : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`);

function buildMessage({ from, to, subject, text }) {
  const domain = addressOf(from).split('@')[1];
  const body = Buffer.from(text.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomBytes(12).toString('hex')}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n');
}

/** Lecture des réponses SMTP (éventuellement multi-lignes : « 250-… » puis « 250 … »). */
class Replies {
  constructor() { this.queue = []; this.waiters = []; this.partial = []; this.buf = ''; this.error = null; }

  attach(socket) {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error('délai dépassé')));
    socket.on('data', (chunk) => this.feed(chunk));
    socket.on('error', (err) => this.fail(err));
    socket.on('close', () => this.fail(new Error('connexion fermée par le serveur')));
  }

  // Laisse un écouteur d'erreur neutre : une erreur tardive ne doit pas faire planter le serveur
  detach() {
    this.socket.removeAllListeners('data').removeAllListeners('error').removeAllListeners('close').on('error', () => {});
    this.socket.setTimeout(0);
  }

  feed(chunk) {
    this.buf += chunk;
    let i;
    while ((i = this.buf.indexOf('\r\n')) >= 0) {
      const line = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 2);
      this.partial.push(line.slice(4));
      if (line[3] !== '-') {
        const reply = { code: Number(line.slice(0, 3)), lines: this.partial };
        this.partial = [];
        const waiter = this.waiters.shift();
        if (waiter) waiter.resolve(reply); else this.queue.push(reply);
      }
    }
  }

  fail(err) {
    this.error ??= err;
    for (const w of this.waiters.splice(0)) w.reject(err);
  }

  next() {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    if (this.error) return Promise.reject(this.error);
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }
}

/** Envoie un e-mail texte. Rejette avec une erreur explicite si le serveur refuse une étape. */
export async function sendMail({ to, subject, text }) {
  const cfg = config();
  if (!cfg.host || !cfg.from) throw new Error('SMTP non configuré (SMTP_HOST et MAIL_FROM requis)');
  if (!ADDRESS.test(to) || !ADDRESS.test(addressOf(cfg.from))) throw new Error('Adresse e-mail invalide');
  if (/[\r\n]/.test(subject + cfg.from)) throw new Error('En-tête invalide');

  const replies = new Replies();
  const connect = () => new Promise((resolve, reject) => {
    const opts = { host: cfg.host, port: cfg.port };
    const socket = cfg.secure
      ? tls.connect({ ...opts, servername: cfg.host, rejectUnauthorized: cfg.rejectUnauthorized }, () => resolve(socket))
      : net.connect(opts, () => resolve(socket));
    socket.once('error', reject);
  });
  let socket = await connect();
  replies.attach(socket);

  const send = (line) => socket.write(`${line}\r\n`);
  const expect = async (codes, step) => {
    const reply = await replies.next();
    if (!codes.includes(reply.code)) throw new Error(`SMTP ${step} : ${reply.code} ${reply.lines.join(' ')}`);
    return reply;
  };
  const command = async (line, codes, step) => { send(line); return expect(codes, step ?? line.split(' ')[0]); };

  try {
    await expect([220], 'accueil');
    const helo = hostname() || 'localhost';
    let ehlo = await command(`EHLO ${helo}`, [250], 'EHLO');
    let encrypted = cfg.secure;

    if (!encrypted && ehlo.lines.some((l) => /^STARTTLS\b/i.test(l))) {
      await command('STARTTLS', [220]);
      replies.detach();
      socket = await new Promise((resolve, reject) => {
        const secured = tls.connect({ socket, servername: cfg.host, rejectUnauthorized: cfg.rejectUnauthorized }, () => resolve(secured));
        secured.once('error', reject);
      });
      replies.attach(socket);
      encrypted = true;
      ehlo = await command(`EHLO ${helo}`, [250], 'EHLO');
    }

    if (cfg.user) {
      const local = ['localhost', '127.0.0.1', '::1'].includes(cfg.host);
      if (!encrypted && !local) throw new Error('SMTP : le serveur ne propose pas de chiffrement, identifiants non envoyés');
      const token = Buffer.from(`\0${cfg.user}\0${cfg.pass}`, 'utf8').toString('base64');
      await command(`AUTH PLAIN ${token}`, [235], 'AUTH');
    }

    await command(`MAIL FROM:<${addressOf(cfg.from)}>`, [250], 'MAIL FROM');
    await command(`RCPT TO:<${to}>`, [250, 251], 'RCPT TO');
    await command('DATA', [354]);
    const data = buildMessage({ from: cfg.from, to, subject, text }).replace(/^\./gm, '..');
    socket.write(`${data}\r\n.\r\n`);
    await expect([250], 'envoi du message');
    send('QUIT');
  } finally {
    replies.detach();
    socket.end();
  }
}

'use strict';

// Durcissement HTTP : liste blanche CORS, en-tetes helmet, limitation des
// tentatives de connexion. Les tests montent un Express ephemere et emettent de
// vraies requetes HTTP, sans base ni dependance externe.

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const CHEMIN_SECURITE = require.resolve('../src/config/securite');

/** Recharge le module apres modification des variables d environnement. */
function rechargerSecurite() {
  delete require.cache[CHEMIN_SECURITE];
  return require('../src/config/securite');
}

/** Demarre un serveur sur un port libre et renvoie de quoi l appeler. */
async function demarrer(app) {
  const serveur = app.listen(0);
  await new Promise((resolve) => serveur.once('listening', resolve));
  const base = `http://127.0.0.1:${serveur.address().port}`;
  return {
    base,
    appeler: (chemin, options) => fetch(base + chemin, options),
    fermer: () => new Promise((resolve) => serveur.close(resolve)),
  };
}

// ─── originesAutorisees ───────────────────────────────────────────────────

test('sans CORS_ORIGINS, les deux frontends locaux sont autorises', () => {
  delete process.env.CORS_ORIGINS;
  const { originesAutorisees } = rechargerSecurite();
  const liste = originesAutorisees();
  for (const attendue of [
    'http://localhost:5173', 'http://localhost:5174',
    'http://127.0.0.1:5173', 'http://127.0.0.1:5174',
  ]) {
    assert.ok(liste.includes(attendue), `${attendue} doit etre autorisee par defaut`);
  }
});

test('sans CORS_ORIGINS, la liste n est jamais un joker', () => {
  delete process.env.CORS_ORIGINS;
  const { originesAutorisees } = rechargerSecurite();
  const liste = originesAutorisees();
  assert.ok(!liste.includes('*'), 'aucun joker ne doit apparaitre');
  assert.ok(liste.every((o) => o.startsWith('http')), 'chaque entree doit etre une origine');
});

test('CORS_ORIGINS remplace la liste et tolere les espaces', () => {
  process.env.CORS_ORIGINS = ' https://a.exemple.ma , https://b.exemple.ma ';
  const { originesAutorisees } = rechargerSecurite();
  assert.deepStrictEqual(originesAutorisees(), ['https://a.exemple.ma', 'https://b.exemple.ma']);
  delete process.env.CORS_ORIGINS;
});

test('une CORS_ORIGINS vide ou remplie de virgules retombe sur les defauts', () => {
  for (const valeur of ['', '   ', ',,,']) {
    process.env.CORS_ORIGINS = valeur;
    const { originesAutorisees, ORIGINES_DEV } = rechargerSecurite();
    assert.deepStrictEqual(originesAutorisees(), ORIGINES_DEV, `valeur testee : "${valeur}"`);
  }
  delete process.env.CORS_ORIGINS;
});

// ─── CORS en conditions reelles ───────────────────────────────────────────

test('CORS : une origine de la liste est acceptee, une origine inconnue est refusee', async () => {
  process.env.CORS_ORIGINS = 'http://localhost:5174';
  const { optionsCors } = rechargerSecurite();

  const app = express();
  app.use(cors(optionsCors));
  app.get('/ping', (_req, res) => res.json({ ok: true }));
  const s = await demarrer(app);

  try {
    const autorisee = await s.appeler('/ping', { headers: { Origin: 'http://localhost:5174' } });
    assert.strictEqual(
      autorisee.headers.get('access-control-allow-origin'), 'http://localhost:5174',
      "l origine de la liste doit etre renvoyee dans l en-tete"
    );

    const refusee = await s.appeler('/ping', { headers: { Origin: 'https://pirate.exemple' } });
    assert.strictEqual(
      refusee.headers.get('access-control-allow-origin'), null,
      "aucun en-tete d autorisation ne doit etre renvoye a une origine inconnue"
    );
  } finally {
    await s.fermer();
    delete process.env.CORS_ORIGINS;
  }
});

test('CORS : une requete sans en-tete Origin passe, pour curl et le healthcheck', async () => {
  delete process.env.CORS_ORIGINS;
  const { optionsCors } = rechargerSecurite();

  const app = express();
  app.use(cors(optionsCors));
  app.get('/ping', (_req, res) => res.json({ ok: true }));
  const s = await demarrer(app);

  try {
    const r = await s.appeler('/ping');
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(await r.json(), { ok: true });
  } finally {
    await s.fermer();
  }
});

// ─── helmet ───────────────────────────────────────────────────────────────

test('helmet pose ses en-tetes sans bloquer le service de fichiers cross-origin', async () => {
  const { optionsHelmet } = rechargerSecurite();

  const app = express();
  app.use(helmet(optionsHelmet));
  app.get('/fichier', (_req, res) => res.type('text/plain').send('contenu'));
  const s = await demarrer(app);

  try {
    const r = await s.appeler('/fichier');
    assert.strictEqual(r.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(r.headers.get('x-frame-options'), 'X-Frame-Options doit etre pose');
    // Le frontend est servi depuis une autre origine que l API : une politique
    // same-origin ferait bloquer la reponse par le navigateur.
    assert.strictEqual(r.headers.get('cross-origin-resource-policy'), 'cross-origin');
    assert.strictEqual(await r.text(), 'contenu', 'le contenu doit rester servi');
  } finally {
    await s.fermer();
  }
});

// ─── limitation des tentatives de connexion ───────────────────────────────

test('connexion : la N+1e tentative est refusee en 429', async () => {
  process.env.LOGIN_RATE_LIMIT_MAX = '3';
  process.env.LOGIN_RATE_LIMIT_WINDOW_MINUTES = '15';
  const { creerLimiteurConnexion } = rechargerSecurite();

  const app = express();
  app.post('/login', creerLimiteurConnexion(), (_req, res) =>
    res.status(401).json({ success: false, message: 'Identifiants invalides.' })
  );
  const s = await demarrer(app);

  try {
    const codes = [];
    for (let i = 0; i < 4; i++) {
      codes.push((await s.appeler('/login', { method: 'POST' })).status);
    }
    assert.deepStrictEqual(codes, [401, 401, 401, 429], 'les 3 premieres passent, la 4e est bloquee');

    const bloquee = await s.appeler('/login', { method: 'POST' });
    const corps = await bloquee.json();
    assert.strictEqual(corps.success, false);
    assert.match(corps.message, /Trop de tentatives/);
  } finally {
    await s.fermer();
    delete process.env.LOGIN_RATE_LIMIT_MAX;
    delete process.env.LOGIN_RATE_LIMIT_WINDOW_MINUTES;
  }
});

test('connexion : LOGIN_RATE_LIMIT_MAX=0 desactive la limitation', async () => {
  process.env.LOGIN_RATE_LIMIT_MAX = '0';
  const { creerLimiteurConnexion } = rechargerSecurite();

  const app = express();
  app.post('/login', creerLimiteurConnexion(), (_req, res) => res.status(401).json({ success: false }));
  const s = await demarrer(app);

  try {
    const codes = [];
    for (let i = 0; i < 25; i++) {
      codes.push((await s.appeler('/login', { method: 'POST' })).status);
    }
    assert.ok(codes.every((c) => c === 401), 'aucune requete ne doit etre bloquee');
  } finally {
    await s.fermer();
    delete process.env.LOGIN_RATE_LIMIT_MAX;
  }
});

test('connexion : une valeur illisible retombe sur le defaut de 20', async () => {
  process.env.LOGIN_RATE_LIMIT_MAX = 'beaucoup';
  const { creerLimiteurConnexion } = rechargerSecurite();

  const app = express();
  app.post('/login', creerLimiteurConnexion(), (_req, res) => res.status(401).json({ success: false }));
  const s = await demarrer(app);

  try {
    const codes = [];
    for (let i = 0; i < 21; i++) {
      codes.push((await s.appeler('/login', { method: 'POST' })).status);
    }
    assert.strictEqual(codes.filter((c) => c === 401).length, 20, '20 tentatives acceptees');
    assert.strictEqual(codes[20], 429, 'la 21e est bloquee');
  } finally {
    await s.fermer();
    delete process.env.LOGIN_RATE_LIMIT_MAX;
  }
});

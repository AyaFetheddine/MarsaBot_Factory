'use strict';

// Forme du jeton emis a la connexion. Le claim role est ajoute pour aligner
// MarsaBot sur MarsaTrack AI ; ce test fige la forme documentee au README, de
// sorte qu'une divergence entre les deux services se voie ici.

const test = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const CHEMIN_DB = require.resolve('../src/config/db');
const CHEMIN_ADMIN = require.resolve('../src/controllers/adminController');

const SECRET = 'secret-de-test-jeton';
const MOT_DE_PASSE = 'motdepasse-de-test';

function chargerAdminController(admin) {
  require.cache[CHEMIN_DB] = {
    id: CHEMIN_DB, filename: CHEMIN_DB, loaded: true,
    exports: { pool: { async execute() { return [admin ? [admin] : []]; } }, testConnection: async () => {} },
  };
  delete require.cache[CHEMIN_ADMIN];
  return require('../src/controllers/adminController');
}

function creerReponse() {
  return {
    code: 200, corps: null,
    status(c) { this.code = c; return this; },
    json(o) { this.corps = o; return this; },
  };
}

async function obtenirJeton() {
  process.env.JWT_SECRET = SECRET;
  const admin = {
    id: 42,
    matricule: 'admin',
    nom: 'Administrateur',
    password_hash: await bcrypt.hash(MOT_DE_PASSE, 4),
  };
  const { login } = chargerAdminController(admin);
  const res = creerReponse();
  await login({ body: { matricule: admin.matricule, password: MOT_DE_PASSE } }, res);
  return res;
}

test('le jeton emis porte les claims documentes, role compris', async () => {
  const res = await obtenirJeton();

  assert.strictEqual(res.corps.success, true, 'la connexion doit reussir');
  const charge = jwt.verify(res.corps.token, SECRET);

  assert.strictEqual(charge.id, 42);
  assert.strictEqual(charge.matricule, 'admin');
  assert.strictEqual(charge.nom, 'Administrateur');
  assert.strictEqual(charge.role, 'Admin', 'le role doit etre nomme comme celui de MarsaTrack');
});

test('le jeton expire au bout de huit heures', async () => {
  const res = await obtenirJeton();
  const charge = jwt.verify(res.corps.token, SECRET);

  const dureeHeures = (charge.exp - charge.iat) / 3600;
  assert.strictEqual(dureeHeures, 8);
});

test('le jeton ne contient aucun secret', async () => {
  const res = await obtenirJeton();
  const charge = jwt.verify(res.corps.token, SECRET);

  assert.strictEqual(charge.password_hash, undefined, 'l empreinte du mot de passe ne doit pas fuir');
  const serialise = JSON.stringify(charge);
  assert.ok(!serialise.includes(MOT_DE_PASSE));
  assert.ok(!serialise.includes(SECRET));
});

test('un mot de passe errone ne produit aucun jeton', async () => {
  process.env.JWT_SECRET = SECRET;
  const admin = {
    id: 42, matricule: 'admin', nom: 'Administrateur',
    password_hash: await bcrypt.hash(MOT_DE_PASSE, 4),
  };
  const { login } = chargerAdminController(admin);
  const res = creerReponse();
  await login({ body: { matricule: admin.matricule, password: 'mauvais' } }, res);

  assert.strictEqual(res.code, 401);
  assert.strictEqual(res.corps.token, undefined);
});

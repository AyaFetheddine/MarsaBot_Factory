'use strict';

// Depuis la fusion, MarsaBot et MarsaTrack AI signent avec le meme secret : le
// portail transmet son jeton a la console encadree, evitant une seconde
// authentification. La signature devient donc valide pour TOUS les jetons
// MarsaTrack, y compris ceux d'un Portiqueur. Ces tests figent la seule barriere
// qui reste : le role.

const test = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'secret-de-test-middleware';
const SECRET = process.env.JWT_SECRET;

const authMiddleware = require('../src/middlewares/authMiddleware');

/** Rejoue une requete a travers le middleware et rapporte ce qui s'est passe. */
function appeler(entete) {
  const resultat = { code: null, corps: null, suivant: false, admin: undefined };
  const req = { headers: entete ? { authorization: entete } : {} };
  const res = {
    status(c) { resultat.code = c; return this; },
    json(p) { resultat.corps = p; return this; },
  };
  authMiddleware(req, res, () => { resultat.suivant = true; });
  resultat.admin = req.admin;
  return resultat;
}

const jetonAvec = (charge) => `Bearer ${jwt.sign(charge, SECRET, { expiresIn: '5m' })}`;

// ─── Acces accorde ───────────────────────────────────────────────────────

test('un jeton MarsaTrack d Admin ouvre la console', () => {
  // Forme exacte emise par MarsaTrack AI : id, matricule, role.
  const r = appeler(jetonAvec({ id: 1, matricule: 'admin', role: 'Admin' }));
  assert.strictEqual(r.suivant, true);
  assert.strictEqual(r.code, null);
  assert.strictEqual(r.admin.matricule, 'admin');
});

test('un jeton emis par la console elle-meme reste accepte', () => {
  // Forme emise par MarsaBot : id, email, nom, role.
  const r = appeler(jetonAvec({ id: 1, email: 'admin@marsamaroc.ma', nom: 'Admin', role: 'Admin' }));
  assert.strictEqual(r.suivant, true);
});

// ─── Acces refuse ────────────────────────────────────────────────────────

test('un jeton MarsaTrack authentique mais non Admin est refuse en 403', () => {
  // Le point critique du partage de secret : la signature est valide, seul le
  // role empeche un Portiqueur de gerer les assistants.
  for (const role of ['Portiqueur', 'Chef_Equipe', 'Chef_Services', 'Responsable_Exploitation']) {
    const r = appeler(jetonAvec({ id: 4, matricule: 'x', role }));
    assert.strictEqual(r.suivant, false, `${role} ne doit pas passer`);
    assert.strictEqual(r.code, 403, `${role} doit recevoir 403, pas 401`);
    assert.match(r.corps.message, /administrateurs/i);
  }
});

test('un jeton sans claim role est refuse', () => {
  // Un jeton ancien, emis avant l alignement des deux services, ne doit pas
  // valoir laissez-passer par defaut.
  const r = appeler(jetonAvec({ id: 1, email: 'admin@marsamaroc.ma' }));
  assert.strictEqual(r.suivant, false);
  assert.strictEqual(r.code, 403);
});

test('un role approchant ne suffit pas', () => {
  for (const role of ['admin', 'ADMIN', 'Administrateur', 'Admin ', '']) {
    const r = appeler(jetonAvec({ id: 1, role }));
    assert.strictEqual(r.suivant, false, `« ${role} » ne doit pas passer`);
  }
});

test('un jeton signe avec un autre secret est refuse en 401', () => {
  const etranger = `Bearer ${jwt.sign({ id: 1, role: 'Admin' }, 'un-autre-secret')}`;
  const r = appeler(etranger);
  assert.strictEqual(r.suivant, false);
  assert.strictEqual(r.code, 401);
});

test('un jeton expire est refuse en 401', () => {
  const perime = `Bearer ${jwt.sign({ id: 1, role: 'Admin' }, SECRET, { expiresIn: -10 })}`;
  const r = appeler(perime);
  assert.strictEqual(r.code, 401);
});

test('un en-tete absent ou malforme est refuse en 401', () => {
  assert.strictEqual(appeler(null).code, 401);
  assert.strictEqual(appeler('Basic abc').code, 401);
  assert.strictEqual(appeler('Bearer ').code, 401);
});

// ─── Distinction 401 / 403 ───────────────────────────────────────────────

test('401 et 403 ne disent pas la meme chose', () => {
  // L interface se reconnecte sur 401 et s arrete sur 403 : les confondre
  // enverrait un Portiqueur dans une boucle de reconnexion sans fin.
  const sansDroit = appeler(jetonAvec({ id: 4, role: 'Portiqueur' }));
  const perime = `Bearer ${jwt.sign({ id: 1, role: 'Admin' }, SECRET, { expiresIn: -10 })}`;
  assert.strictEqual(sansDroit.code, 403);
  assert.strictEqual(appeler(perime).code, 401);
});

'use strict';

// La creation du compte initial ne peut pas exiger de jeton : aucun compte
// n'existe encore. Elle est donc restreinte a la machine elle-meme. Ces tests
// figent cette barriere, et surtout le fait qu'elle ne se laisse pas contourner
// par un en-tete.

const test = require('node:test');
const assert = require('node:assert');

const bouclageLocal = require('../src/middlewares/bouclageLocal');
const { estAdresseLocale } = bouclageLocal;

/** Rejoue une requete a travers le middleware et rapporte ce qui s'est passe. */
function appeler(adresse, entetes = {}) {
  const resultat = { code: null, corps: null, suivant: false };
  const req = { socket: { remoteAddress: adresse }, headers: entetes, ip: entetes['x-forwarded-for'] };
  const res = {
    status(c) { resultat.code = c; return this; },
    json(p) { resultat.corps = p; return this; },
  };
  bouclageLocal(req, res, () => { resultat.suivant = true; });
  return resultat;
}

// ─── Acces accorde ───────────────────────────────────────────────────────

test('la boucle locale passe, dans ses trois formes', () => {
  for (const adresse of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    const r = appeler(adresse);
    assert.strictEqual(r.suivant, true, `${adresse} devrait passer`);
    assert.strictEqual(r.code, null);
  }
});

// ─── Acces refuse ────────────────────────────────────────────────────────

test('une adresse du reseau local est refusee', () => {
  // Etre sur le meme reseau ne suffit pas : la fenetre a fermer est celle d'un
  // tiers qui atteint le port avant l'exploitant.
  for (const adresse of ['192.168.1.20', '10.0.0.5', '172.17.0.1', '::ffff:192.168.1.20']) {
    const r = appeler(adresse);
    assert.strictEqual(r.suivant, false, `${adresse} ne devrait pas passer`);
    assert.strictEqual(r.code, 404);
  }
});

test('une adresse publique est refusee', () => {
  const r = appeler('41.77.12.9');
  assert.strictEqual(r.suivant, false);
  assert.strictEqual(r.code, 404);
});

test('la reponse ne revele pas l existence de la route', () => {
  // 404 et non 403 : un appelant distant n'apprend rien.
  const r = appeler('192.168.1.20');
  assert.strictEqual(r.code, 404);
  assert.match(r.corps.message, /introuvable/i);
  assert.ok(!/setup|admin|local/i.test(r.corps.message), 'le message ne doit rien devoiler');
});

// ─── Le point critique : aucun en-tete ne doit pouvoir mentir ────────────

test('X-Forwarded-For ne permet pas de se declarer local', () => {
  // L'adresse est lue sur le socket, jamais dans un en-tete fourni par
  // l'appelant. C'est ce qui distingue ce garde d'une verification sur req.ip.
  const r = appeler('41.77.12.9', {
    'x-forwarded-for': '127.0.0.1',
    'x-real-ip': '127.0.0.1',
    host: 'localhost:3000',
  });
  assert.strictEqual(r.suivant, false, 'un en-tete ne doit jamais ouvrir la route');
  assert.strictEqual(r.code, 404);
});

test('une adresse absente ou invalide est refusee', () => {
  // Socket ferme, valeur inattendue : on refuse par defaut plutot que de
  // laisser passer ce qu'on ne sait pas interpreter.
  for (const adresse of [undefined, null, '', 'localhost', '127.0.0.1 ', 0, {}]) {
    const r = appeler(adresse);
    assert.strictEqual(r.suivant, false, `${JSON.stringify(adresse)} ne devrait pas passer`);
  }
});

test('une requete sans socket est refusee', () => {
  const resultat = { suivant: false, code: null };
  const res = {
    status(c) { resultat.code = c; return this; },
    json() { return this; },
  };
  bouclageLocal({ headers: {} }, res, () => { resultat.suivant = true; });
  assert.strictEqual(resultat.suivant, false);
  assert.strictEqual(resultat.code, 404);
});

// ─── Fonction pure ───────────────────────────────────────────────────────

test('estAdresseLocale distingue les adresses locales des autres', () => {
  assert.strictEqual(estAdresseLocale('127.0.0.1'), true);
  assert.strictEqual(estAdresseLocale('::1'), true);
  assert.strictEqual(estAdresseLocale('::ffff:127.0.0.1'), true);
  // 127.0.0.2 appartient au bloc de bouclage mais n'est pas produite par Node
  // dans ce contexte : on reste sur une liste explicite plutot qu'un prefixe.
  assert.strictEqual(estAdresseLocale('127.0.0.2'), false);
  assert.strictEqual(estAdresseLocale('192.168.1.1'), false);
});

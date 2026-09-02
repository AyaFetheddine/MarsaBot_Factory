'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  verifierUrlSource,
  verifierRedirection,
  estAdressePrivee,
} = require('../src/utils/urlGuard');

/**
 * Ces tests n'ont besoin ni de réseau, ni de base de données, ni d'Ollama.
 * Les cas « acceptés » utilisent une adresse IP publique écrite en clair
 * (8.8.8.8) plutôt qu'un nom de domaine, pour éviter toute résolution DNS
 * sortante et rester déterministes hors ligne.
 */

// Chaque test part d'une liste d'exceptions vide, sauf mention contraire.
test.beforeEach(() => {
  process.env.ALLOWED_INTERNAL_HOSTS = '';
});

/** Vérifie qu'une URL est refusée, et renvoie le message d'erreur. */
async function refus(url) {
  try {
    await verifierUrlSource(url);
  } catch (err) {
    assert.strictEqual(err.status, 400, 'une URL refusée doit porter status 400');
    return err.message;
  }
  assert.fail(`l'URL aurait dû être refusée : ${url}`);
}

test('estAdressePrivee reconnaît les plages non routables', () => {
  for (const ip of [
    '10.0.0.5', '127.0.0.1', '169.254.169.254', '172.16.0.1',
    '172.31.255.255', '192.168.1.1', '0.0.0.0', '224.0.0.1',
    '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1',
  ]) {
    assert.strictEqual(estAdressePrivee(ip), true, `${ip} devrait être privée`);
  }
});

test('estAdressePrivee laisse passer les adresses publiques', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '193.0.6.139', '2001:4860:4860::8888']) {
    assert.strictEqual(estAdressePrivee(ip), false, `${ip} devrait être publique`);
  }
});

test('estAdressePrivee refuse ce qui n\'est pas une adresse IP', () => {
  for (const valeur of ['', 'pas-une-ip', '999.999.999.999', null, undefined]) {
    assert.strictEqual(estAdressePrivee(valeur), true, 'le doute doit profiter au refus');
  }
});

test('seuls http et https sont acceptés', async () => {
  assert.match(await refus('file:///etc/passwd'), /Protocole non autorisé/);
  assert.match(await refus('ftp://8.8.8.8/x'), /Protocole non autorisé/);
  assert.match(await refus('gopher://8.8.8.8/'), /Protocole non autorisé/);
});

test('une chaîne qui n\'est pas une URL est refusée', async () => {
  assert.match(await refus('pas-une-url'), /URL invalide/);
  assert.match(await refus(''), /URL invalide/);
});

test('les adresses internes écrites en clair sont refusées', async () => {
  assert.match(await refus('http://169.254.169.254/latest/meta-data/'), /Adresse interne refusée/);
  assert.match(await refus('http://127.0.0.1:3001/api'), /Adresse interne refusée/);
  assert.match(await refus('http://192.168.1.10/admin'), /Adresse interne refusée/);
  assert.match(await refus('http://10.0.0.5/'), /Adresse interne refusée/);
  assert.match(await refus('http://172.16.0.1/'), /Adresse interne refusée/);
  assert.match(await refus('http://[::1]:3001/'), /Adresse interne refusée/);
});

test('un nom résolvant vers une adresse interne est refusé', async () => {
  // localhost est résolu par le fichier hosts, sans requête réseau sortante.
  assert.match(await refus('http://localhost:3001/api'), /pointe vers une adresse interne/);
});

test('une adresse publique est acceptée', async () => {
  const url = await verifierUrlSource('https://8.8.8.8/api/tracking');
  assert.strictEqual(url.hostname, '8.8.8.8');
  assert.strictEqual(url.protocol, 'https:');
});

test('ALLOWED_INTERNAL_HOSTS ouvre une exception ciblée', async () => {
  process.env.ALLOWED_INTERNAL_HOSTS = 'localhost:3001';

  // L'hôte déclaré passe — c'est la voie d'intégration avec MarsaTrack AI.
  const url = await verifierUrlSource('http://localhost:3001/api/operations');
  assert.strictEqual(url.port, '3001');

  // Un autre port du même hôte reste refusé : l'exception est bien ciblée.
  assert.match(await refus('http://localhost:3002/api'), /pointe vers une adresse interne/);

  // Une autre écriture du même service n'est pas couverte implicitement.
  assert.match(await refus('http://127.0.0.1:3001/api'), /Adresse interne refusée/);
});

test('ALLOWED_INTERNAL_HOSTS accepte plusieurs hôtes séparés par des virgules', async () => {
  process.env.ALLOWED_INTERNAL_HOSTS = ' localhost:3001 , 10.0.0.5 ';
  await verifierUrlSource('http://localhost:3001/x');
  await verifierUrlSource('http://10.0.0.5/y');
  assert.match(await refus('http://10.0.0.6/y'), /Adresse interne refusée/);
});

test('verifierRedirection bloque les sauts vers une adresse interne', () => {
  assert.throws(() => verifierRedirection('http:', '169.254.169.254'), /adresse interne/);
  assert.throws(() => verifierRedirection('http:', '127.0.0.1', 3001), /adresse interne/);
  assert.throws(() => verifierRedirection('file:', '8.8.8.8'), /protocole/);
});

test('verifierRedirection laisse passer un saut légitime', () => {
  assert.doesNotThrow(() => verifierRedirection('https:', '8.8.8.8'));
  // Les exports Google Sheets redirigent : le saut doit rester possible.
  assert.doesNotThrow(() => verifierRedirection('https:', 'doc-0s-1c.googleusercontent.com'));
});

test('verifierRedirection respecte la liste d\'exceptions', () => {
  process.env.ALLOWED_INTERNAL_HOSTS = 'localhost:3001';
  assert.doesNotThrow(() => verifierRedirection('http:', 'localhost', 3001));
});

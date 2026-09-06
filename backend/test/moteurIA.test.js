'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  filtrerModelesConversationnels,
  verifierUrlMoteur,
  resoudreNomModele,
} = require('../src/services/ollamaService');

// ─── filtrerModelesConversationnels ──────────────────────────────────────

// Reponse reelle de /api/tags sur la machine de developpement, reduite aux
// champs utilises.
const REPONSE_OLLAMA = [
  { name: 'qwen2.5:7b', size: 4683087332, details: { parameter_size: '7.6B' } },
  { name: 'nomic-embed-text:latest', size: 274302450, details: { parameter_size: '137M' } },
  { name: 'llama3.2:latest', size: 2019393189, details: { parameter_size: '3.2B' } },
];

test('le modele d embedding est exclu de la liste proposee', () => {
  const modeles = filtrerModelesConversationnels(REPONSE_OLLAMA);
  const noms = modeles.map((m) => m.nom);
  assert.ok(!noms.includes('nomic-embed-text:latest'),
    "nomic-embed-text ne sait pas converser : le proposer rendrait les bots muets");
  assert.deepStrictEqual(noms, ['llama3.2:latest', 'qwen2.5:7b']);
});

test('les autres familles de modeles d embedding sont aussi exclues', () => {
  const modeles = filtrerModelesConversationnels([
    { name: 'mxbai-embed-large' },
    { name: 'all-minilm-embedding' },
    { name: 'mistral' },
  ]);
  assert.deepStrictEqual(modeles.map((m) => m.nom), ['mistral']);
});

test('la taille est convertie en Go et les parametres conserves', () => {
  const [premier] = filtrerModelesConversationnels(REPONSE_OLLAMA);
  assert.strictEqual(premier.nom, 'llama3.2:latest');
  assert.strictEqual(premier.taille_go, 2.02);
  assert.strictEqual(premier.parametres, '3.2B');
});

test('une reponse absente ou malformee ne fait pas echouer la page', () => {
  assert.deepStrictEqual(filtrerModelesConversationnels(undefined), []);
  assert.deepStrictEqual(filtrerModelesConversationnels(null), []);
  assert.deepStrictEqual(filtrerModelesConversationnels('pas un tableau'), []);
  assert.deepStrictEqual(filtrerModelesConversationnels([null, {}, { name: '   ' }]), []);
});

// ─── verifierUrlMoteur ───────────────────────────────────────────────────

test('une adresse locale est acceptee', () => {
  // Contrairement aux sources API externes, la boucle locale est legitime ici :
  // Ollama tourne le plus souvent sur la meme machine que le backend.
  const r = verifierUrlMoteur('http://localhost:11434');
  assert.strictEqual(r.valide, true);
  assert.strictEqual(r.url, 'http://localhost:11434');
});

test('la barre oblique finale est retiree', () => {
  assert.strictEqual(verifierUrlMoteur('http://localhost:11434/').url, 'http://localhost:11434');
  assert.strictEqual(verifierUrlMoteur('http://localhost:11434///').url, 'http://localhost:11434');
});

test('une adresse vide est refusee', () => {
  for (const valeur of ['', '   ', null, undefined]) {
    assert.strictEqual(verifierUrlMoteur(valeur).valide, false);
  }
});

test('une adresse sans protocole est completee au lieu d etre refusee', () => {
  // C'est la faute de frappe la plus probable d'un administrateur non
  // developpeur, et new URL() l'accepte en lisant « localhost: » comme un
  // protocole : sans traitement, le message d'erreur etait incomprehensible.
  const r = verifierUrlMoteur('localhost:11434');
  assert.strictEqual(r.valide, true);
  assert.strictEqual(r.url, 'http://localhost:11434');

  const ip = verifierUrlMoteur('192.168.1.10:11434');
  assert.strictEqual(ip.valide, true);
  assert.strictEqual(ip.url, 'http://192.168.1.10:11434');
});

test('un protocole autre que http ou https est refuse', () => {
  for (const url of ['ftp://serveur/x', 'file:///etc/passwd', 'javascript:alert(1)']) {
    assert.strictEqual(verifierUrlMoteur(url).valide, false, `${url} devrait etre refusee`);
  }
});

test('une adresse https distante est acceptee', () => {
  // Le moteur peut legitimement tourner sur un autre serveur du reseau.
  assert.strictEqual(verifierUrlMoteur('https://ia.marsamaroc.local:11434').valide, true);
});

// ─── resoudreNomModele ───────────────────────────────────────────────────

const DISPONIBLES = ['llama3.2:latest', 'qwen2.5:7b'];

test('un nom sans etiquette est resolu vers :latest', () => {
  // « llama3.2 » est la valeur par defaut du projet (settingModel,
  // agentService) alors qu'Ollama publie « llama3.2:latest ». Sans cette
  // equivalence, une installation neuve annoncerait un modele absent.
  assert.strictEqual(resoudreNomModele('llama3.2', DISPONIBLES), 'llama3.2:latest');
});

test('un nom deja complet est renvoye tel quel', () => {
  assert.strictEqual(resoudreNomModele('llama3.2:latest', DISPONIBLES), 'llama3.2:latest');
  assert.strictEqual(resoudreNomModele('qwen2.5:7b', DISPONIBLES), 'qwen2.5:7b');
});

test('une etiquette explicite n est jamais remplacee par :latest', () => {
  // Demander qwen2.5:14b quand seul le 7b est installe doit echouer, pas
  // retomber silencieusement sur une autre taille de modele.
  assert.strictEqual(resoudreNomModele('qwen2.5:14b', DISPONIBLES), null);
});

test('un modele absent est signale', () => {
  assert.strictEqual(resoudreNomModele('llama3.5', DISPONIBLES), null);
  assert.strictEqual(resoudreNomModele('', DISPONIBLES), null);
  assert.strictEqual(resoudreNomModele('llama3.2', []), null);
  assert.strictEqual(resoudreNomModele('llama3.2', null), null);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { chunkText, cosineSimilarity } = require('../src/services/vectorService');
const { pool } = require('../src/config/db');

/**
 * chunkText et cosineSimilarity sont des fonctions pures : ces tests ne
 * touchent ni la base, ni Ollama. Le module importe toutefois le pool MySQL,
 * qui doit être fermé pour que le processus de test se termine.
 */
test.after(async () => {
  await pool.end().catch(() => { /* aucune connexion ouverte */ });
});

const NL = String.fromCharCode(10);

// ─── chunkText ───────────────────────────────────────────────────────────

test('chunkText gère les entrées vides', () => {
  assert.deepStrictEqual(chunkText(''), []);
  assert.deepStrictEqual(chunkText(null), []);
  assert.deepStrictEqual(chunkText(undefined), []);
});

test('chunkText renvoie un seul chunk pour un texte court', () => {
  const chunks = chunkText('Le poste de nuit commence a 22h15.');
  assert.strictEqual(chunks.length, 1);
  assert.strictEqual(chunks[0], 'Le poste de nuit commence a 22h15.');
});

test('chunkText ne coupe jamais une ligne en deux', () => {
  // Neuf enregistrements de type CSV, largement au-delà d'un chunk de 200.
  const lignes = Array.from({ length: 9 }, (_, i) =>
    `ID_Equipement: EQ-${String(i).padStart(3, '0')}, Type: Portique de quai, ` +
    `Zone: Quai Nord, Statut: ${i % 2 ? 'En panne' : 'En service'}`
  );
  const source = lignes.join(NL);
  const chunks = chunkText(source, 200, 40);

  assert.ok(chunks.length > 1, 'le corpus doit produire plusieurs chunks');
  for (const ligne of lignes) {
    assert.ok(
      chunks.some((c) => c.includes(ligne)),
      `la ligne suivante a été coupée entre deux chunks : ${ligne}`
    );
  }
});

test('chunkText garde identifiant et statut dans le même chunk', () => {
  const lignes = [
    'ID_Equipement: PQ-CASA-002, Zone: Quai Nord, Statut: En panne',
    'ID_Equipement: RTG-CASA-012, Zone: Parc A, Statut: Maintenance preventive',
    'ID_Equipement: CAV-CASA-046, Zone: Parc C, Statut: En panne',
  ];
  const chunks = chunkText(lignes.join(NL), 80, 10);

  for (const id of ['PQ-CASA-002', 'RTG-CASA-012', 'CAV-CASA-046']) {
    const porteur = chunks.find((c) => c.includes(id));
    assert.ok(porteur, `${id} est absent de tous les chunks`);
    assert.match(porteur, /Statut: /, `le statut de ${id} a été separé de son identifiant`);
  }
});

test('chunkText applique un recouvrement entre chunks consécutifs', () => {
  const lignes = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'];
  const chunks = chunkText(lignes.join(NL), 20, 12);

  assert.ok(chunks.length > 1);
  const premieresLignesDuSuivant = chunks[1].split(NL);
  const dernieresLignesDuPremier = chunks[0].split(NL);
  assert.ok(
    premieresLignesDuSuivant.some((l) => dernieresLignesDuPremier.includes(l)),
    'le chunk suivant doit reprendre au moins une ligne du precedent'
  );
});

test('chunkText découpe une ligne isolée trop longue', () => {
  const chunks = chunkText('x'.repeat(2500), 1000, 200);
  // Pas de 800 : indices 0, 800, 1600, 2400
  assert.strictEqual(chunks.length, 4);
  assert.strictEqual(chunks[0].length, 1000);
  assert.ok(chunks.every((c) => c.length <= 1000));
});

test('chunkText ne perd aucun caractère d\'une ligne trop longue', () => {
  const source = 'abcdefghij'.repeat(250); // 2500 caractères
  const chunks = chunkText(source, 1000, 200);
  const reconstitue = chunks.map((c, i) => (i === 0 ? c : c.slice(200))).join('');
  assert.strictEqual(reconstitue, source);
});

test('chunkText ne boucle pas si le recouvrement dépasse la taille', () => {
  // Le pas doit rester positif, sinon la boucle ne se termine jamais.
  const chunks = chunkText('a'.repeat(3000), 100, 500);
  assert.ok(chunks.length > 0);
  assert.ok(chunks.length < 100, 'un pas positif doit borner le nombre de chunks');
});

// ─── cosineSimilarity ────────────────────────────────────────────────────

test('cosineSimilarity vaut 1 pour deux vecteurs identiques', () => {
  const v = [0.2, -0.5, 0.9, 0.1];
  assert.ok(Math.abs(cosineSimilarity(v, v) - 1) < 1e-9);
});

test('cosineSimilarity vaut 0 pour deux vecteurs orthogonaux', () => {
  assert.strictEqual(cosineSimilarity([1, 0], [0, 1]), 0);
});

test('cosineSimilarity vaut -1 pour deux vecteurs opposés', () => {
  assert.ok(Math.abs(cosineSimilarity([1, 2], [-1, -2]) + 1) < 1e-9);
});

test('cosineSimilarity renvoie 0 face à un vecteur nul, sans division par zéro', () => {
  const r = cosineSimilarity([0, 0, 0], [1, 2, 3]);
  assert.strictEqual(r, 0);
  assert.ok(Number.isFinite(r), 'le resultat ne doit jamais etre NaN ou Infinity');
});

test('cosineSimilarity classe le vecteur le plus proche en tête', () => {
  const question = [1, 0, 0];
  const proche = [0.9, 0.1, 0];
  const lointain = [0.1, 0.9, 0.2];
  assert.ok(cosineSimilarity(question, proche) > cosineSimilarity(question, lointain));
});

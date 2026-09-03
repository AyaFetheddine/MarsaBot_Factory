'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { masquerSecretsUrl, formaterEtatOperationnel } = require('../src/utils/apiSourceFormat');

// ─── masquerSecretsUrl ───────────────────────────────────────────────────

test('masquerSecretsUrl masque un jeton en parametre de requete', () => {
  const url = 'http://localhost:3001/api/integration/etat-operationnel?token=jeton-factice-de-test';
  const masquee = masquerSecretsUrl(url);
  assert.ok(!masquee.includes('jeton-factice-de-test'), 'le jeton ne doit plus apparaitre');
  assert.match(masquee, /token=\*\*\*/);
  assert.ok(masquee.startsWith('http://localhost:3001/api/integration/etat-operationnel'));
});

test('masquerSecretsUrl couvre les autres noms sensibles', () => {
  for (const nom of ['api_key', 'apikey', 'key', 'secret', 'password', 'access_token']) {
    const masquee = masquerSecretsUrl(`https://exemple.test/x?${nom}=valeursecrete`);
    assert.ok(!masquee.includes('valeursecrete'), `${nom} devrait etre masque`);
  }
});

test('masquerSecretsUrl laisse intacts les parametres non sensibles', () => {
  const url = 'https://exemple.test/x?format=csv&page=2';
  assert.strictEqual(masquerSecretsUrl(url), url);
});

test('masquerSecretsUrl ne laisse jamais fuir la requete d une URL invalide', () => {
  const masquee = masquerSecretsUrl('pas-une-url?token=secret');
  assert.ok(!masquee.includes('secret'));
});

// ─── formaterEtatOperationnel ────────────────────────────────────────────

const REPONSE = {
  source: 'MarsaTrack AI',
  genere_le: '2026-09-03T19:10:07.786Z',
  shift_en_cours: 'Shift 2',
  vacation_en_cours: 'Vacation 2',
  resume: { nombre_operations: 1, nombre_personnels_affectes: 2, nombre_arrets_actifs: 1 },
  operations: [
    {
      nom_operation: 'Chargement MARSA STAR - Quai 5',
      navire: 'MARSA STAR',
      numero_escale: '202609035',
      poste_quai: 'Quai 5',
      type_operation: 'CHARGEMENT',
      statut: 'en cours',
      date_operation: '2026-09-03',
      shift: 'Shift 2',
      vacation: 'Vacation 1',
      personnels_affectes: [
        { nom_complet: 'Agent Terrain Test', fonction: 'Agent_Terrain' },
        { nom_complet: 'Portiqueur Test', fonction: 'Portiqueur' },
      ],
      arrets_de_travail_actifs: [
        {
          motif: 'Vent superieur au seuil de securite',
          code_arret: 'METEO-02',
          libelle_arret: 'Arret meteorologique',
          debut: '2026-09-03T19:35:38.000Z',
          duree_minutes: null,
        },
      ],
    },
  ],
};

test('formaterEtatOperationnel restitue navire, quai, personnels et motif d arret', () => {
  const txt = formaterEtatOperationnel(REPONSE);
  for (const attendu of [
    'MARSA STAR', 'Quai 5', 'Agent Terrain Test', 'Portiqueur Test',
    'METEO-02', 'Vent superieur au seuil de securite',
  ]) {
    assert.ok(txt.includes(attendu), `"${attendu}" doit figurer dans le texte formate`);
  }
});

test('formaterEtatOperationnel produit un texte oriente lignes, plus court que le JSON', () => {
  const txt = formaterEtatOperationnel(REPONSE);
  assert.ok(txt.split('\n').length > 4, 'plusieurs lignes attendues');
  assert.ok(txt.length < JSON.stringify(REPONSE).length, 'plus compact que le JSON brut');
});

test('formaterEtatOperationnel gere une duree connue et une operation sans arret', () => {
  const sansArret = JSON.parse(JSON.stringify(REPONSE));
  sansArret.operations[0].arrets_de_travail_actifs = [];
  assert.match(formaterEtatOperationnel(sansArret), /Arrets de travail actifs : aucun/);

  const avecDuree = JSON.parse(JSON.stringify(REPONSE));
  avecDuree.operations[0].arrets_de_travail_actifs[0].duree_minutes = 15;
  assert.match(formaterEtatOperationnel(avecDuree), /15 min/);
});

test('formaterEtatOperationnel renvoie null pour une source qui n est pas MarsaTrack', () => {
  assert.strictEqual(formaterEtatOperationnel({ operations: [], source: 'Autre' }), null);
  assert.strictEqual(formaterEtatOperationnel({ nimporte: 'quoi' }), null);
  assert.strictEqual(formaterEtatOperationnel('une chaine'), null);
  assert.strictEqual(formaterEtatOperationnel(null), null);
});

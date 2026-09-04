'use strict';

// Sonde GET /health : elle doit interroger reellement MySQL et Ollama, et
// refleter leur panne dans le code HTTP. Le pool et l appel HTTP a Ollama sont
// remplaces, pour que la suite tourne en CI sans base ni serveur de modeles.

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');

const CHEMIN_DB = require.resolve('../src/config/db');
const CHEMIN_AXIOS = require.resolve('axios');
const CHEMIN_SANTE = require.resolve('../src/controllers/healthController');

/**
 * Recharge le controleur avec un pool et un axios simules.
 * @param {boolean|Error} mysqlRepond  true, ou l erreur a lever
 * @param {object|Error}  ollamaRepond corps de reponse, ou l erreur a lever
 */
function chargerSante({ mysql = true, ollama = { models: [{ name: 'llama3.2' }] } } = {}) {
  require.cache[CHEMIN_DB] = {
    id: CHEMIN_DB, filename: CHEMIN_DB, loaded: true,
    exports: {
      pool: {
        async query() {
          if (mysql instanceof Error) throw mysql;
          return [[{ 1: 1 }]];
        },
      },
      testConnection: async () => {},
    },
  };

  require.cache[CHEMIN_AXIOS] = {
    id: CHEMIN_AXIOS, filename: CHEMIN_AXIOS, loaded: true,
    exports: {
      async get() {
        if (ollama instanceof Error) throw ollama;
        return { data: ollama };
      },
    },
  };

  delete require.cache[CHEMIN_SANTE];
  return require('../src/controllers/healthController');
}

async function appelerSante(controleur) {
  const app = express();
  app.get('/health', controleur.sante);
  const serveur = app.listen(0);
  await new Promise((r) => serveur.once('listening', r));
  try {
    const r = await fetch(`http://127.0.0.1:${serveur.address().port}/health`);
    return { statut: r.status, corps: await r.json() };
  } finally {
    await new Promise((r) => serveur.close(r));
  }
}

test('/health repond 200 et detaille ses dependances quand tout repond', async () => {
  const { statut, corps } = await appelerSante(chargerSante());

  assert.strictEqual(statut, 200);
  assert.strictEqual(corps.status, 'OK');
  assert.strictEqual(corps.dependances.mysql.statut, 'ok');
  assert.strictEqual(corps.dependances.ollama.statut, 'ok');
  assert.strictEqual(corps.dependances.ollama.modeles, 1, 'le nombre de modeles doit remonter');
  assert.ok(typeof corps.dependances.mysql.duree_ms === 'number');
  assert.ok(corps.timestamp, 'un horodatage doit etre renvoye');
});

test('/health repond 503 quand MySQL est a terre', async () => {
  const { statut, corps } = await appelerSante(
    chargerSante({ mysql: new Error('ECONNREFUSED 127.0.0.1:3306') })
  );

  assert.strictEqual(statut, 503, 'un orchestrateur doit pouvoir se fier au code HTTP');
  assert.strictEqual(corps.status, 'DEGRADE');
  assert.strictEqual(corps.dependances.mysql.statut, 'indisponible');
  assert.match(corps.dependances.mysql.detail, /ECONNREFUSED/);
  assert.strictEqual(corps.dependances.ollama.statut, 'ok', 'Ollama reste sonde independamment');
});

test('/health repond 503 quand Ollama est a terre', async () => {
  const { statut, corps } = await appelerSante(
    chargerSante({ ollama: new Error('connect ECONNREFUSED 127.0.0.1:11434') })
  );

  assert.strictEqual(statut, 503);
  assert.strictEqual(corps.dependances.mysql.statut, 'ok');
  assert.strictEqual(corps.dependances.ollama.statut, 'indisponible');
});

test('/health signale un Ollama joignable mais sans aucun modele', async () => {
  const { statut, corps } = await appelerSante(chargerSante({ ollama: { models: [] } }));

  // Joignable : la sonde reste verte, mais le nombre de modeles permet de
  // diagnostiquer un bot qui ne repond pas alors que tout semble en ligne.
  assert.strictEqual(statut, 200);
  assert.strictEqual(corps.dependances.ollama.modeles, 0);
});

test('/health sonde les deux dependances meme si la premiere echoue', async () => {
  const { corps } = await appelerSante(chargerSante({ mysql: new Error('base absente') }));
  assert.ok(corps.dependances.ollama, 'Ollama doit etre sonde malgre la panne MySQL');
  assert.ok(corps.dependances.mysql, 'MySQL doit apparaitre malgre son echec');
});

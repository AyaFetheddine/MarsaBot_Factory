'use strict';

// Verifie que le botId de l URL est reellement pris en compte par les routes
// de la base de connaissances : une demande croisee (bot A visant une ressource
// du bot B) doit repondre 404 et laisser la ressource intacte.
//
// La CI n a pas de MySQL. Plutot que d ecrire des tests qui ne pourraient pas y
// tourner, le pool est remplace par une base fictive en memoire qui reconnait
// exactement les requetes emises par les modeles et applique vraiment leurs
// clauses WHERE. Un test qui passerait a cote du bot_id echouerait donc ici.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHEMIN_DB = require.resolve('../src/config/db');

/**
 * Normalise une requete SQL sur une seule ligne, pour la comparer sans
 * dependre de l indentation du modele.
 */
const aplatir = (sql) => sql.replace(/\s+/g, ' ').trim();

/**
 * Base fictive : un tableau de lignes par table, et un execute() qui applique
 * reellement les clauses WHERE des requetes attendues. Toute requete non prevue
 * leve une erreur, ce qui empeche un test de passer par accident si un modele
 * change de requete sans que le test soit mis a jour.
 */
function creerBaseFictive({ documents = [], sources = [], bots = [] } = {}) {
  const tables = { documents, api_sources: sources, bots };
  const journal = [];

  const correspond = (ligne, colonnes, valeurs) =>
    colonnes.every((col, i) => String(ligne[col]) === String(valeurs[i]));

  const pool = {
    async execute(sql, params = []) {
      const s = aplatir(sql);
      journal.push({ sql: s, params });

      if (s === 'SELECT * FROM documents WHERE id = ? AND bot_id = ? LIMIT 1') {
        return [tables.documents.filter((d) => correspond(d, ['id', 'bot_id'], params))];
      }
      if (s === 'DELETE FROM documents WHERE id = ? AND bot_id = ?') {
        const avant = tables.documents.length;
        tables.documents = tables.documents.filter((d) => !correspond(d, ['id', 'bot_id'], params));
        return [{ affectedRows: avant - tables.documents.length }];
      }
      if (s === 'DELETE FROM api_sources WHERE id = ? AND bot_id = ?') {
        const avant = tables.api_sources.length;
        tables.api_sources = tables.api_sources.filter((a) => !correspond(a, ['id', 'bot_id'], params));
        return [{ affectedRows: avant - tables.api_sources.length }];
      }
      if (s === 'SELECT id FROM bots WHERE id = ? LIMIT 1') {
        return [tables.bots.filter((b) => correspond(b, ['id'], params))];
      }
      if (s === 'SELECT id FROM documents WHERE bot_id = ? AND nom_original = ? LIMIT 1') {
        return [tables.documents.filter((d) => correspond(d, ['bot_id', 'nom_original'], params))];
      }
      throw new Error('Requete non prevue par la base fictive : ' + s);
    },
  };

  return { pool, journal, tables };
}

/**
 * Installe la base fictive a la place de src/config/db, puis recharge le
 * controleur et ses modeles pour qu ils la consomment. node --test executant
 * chaque fichier dans son propre processus, cette manipulation du cache reste
 * confinee a ce fichier.
 */
function chargerControleur(base) {
  require.cache[CHEMIN_DB] = {
    id: CHEMIN_DB,
    filename: CHEMIN_DB,
    loaded: true,
    exports: { pool: base.pool, testConnection: async () => {} },
  };
  for (const rel of [
    '../src/models/documentModel',
    '../src/models/apiSourceModel',
    '../src/models/botModel',
    '../src/services/vectorService',
    '../src/controllers/knowledgeController',
  ]) {
    delete require.cache[require.resolve(rel)];
  }
  return require('../src/controllers/knowledgeController');
}

/** Reponse Express minimale : retient le code et le corps. */
function creerReponse() {
  return {
    code: 200,
    corps: null,
    fichierEnvoye: null,
    status(c) { this.code = c; return this; },
    json(o) { this.corps = o; return this; },
    sendFile(p) { this.fichierEnvoye = p; return this; },
  };
}

// ─── DELETE /knowledge/:botId/documents/:docId ────────────────────────────

test('suppression de document : cas nominal, le bot proprietaire supprime', async () => {
  const base = creerBaseFictive({ documents: [{ id: 7, bot_id: 1, chemin: '/inexistant/a.txt' }] });
  const { deleteFile } = chargerControleur(base);

  const res = creerReponse();
  await deleteFile({ params: { botId: '1', docId: '7' } }, res);

  assert.strictEqual(res.code, 200);
  assert.strictEqual(res.corps.success, true);
  assert.strictEqual(base.tables.documents.length, 0, 'le document doit avoir ete supprime');
});

test('suppression de document : cas croise, 404 et le document survit', async () => {
  const base = creerBaseFictive({ documents: [{ id: 7, bot_id: 2, chemin: '/inexistant/a.txt' }] });
  const { deleteFile } = chargerControleur(base);

  const res = creerReponse();
  await deleteFile({ params: { botId: '1', docId: '7' } }, res);

  assert.strictEqual(res.code, 404);
  assert.strictEqual(res.corps.success, false);
  assert.strictEqual(base.tables.documents.length, 1, 'le document d un autre bot doit rester intact');
  assert.strictEqual(base.tables.documents[0].bot_id, 2);
});

test('suppression de document : aucun DELETE n est emis lors d une demande croisee', async () => {
  const base = creerBaseFictive({ documents: [{ id: 7, bot_id: 2, chemin: '/inexistant/a.txt' }] });
  const { deleteFile } = chargerControleur(base);

  await deleteFile({ params: { botId: '1', docId: '7' } }, creerReponse());

  const suppressions = base.journal.filter((r) => r.sql.startsWith('DELETE'));
  assert.strictEqual(suppressions.length, 0, 'la requete de suppression ne doit meme pas partir');
});

// ─── DELETE /knowledge/:botId/api-sources/:sourceId ───────────────────────

test('suppression de source API : cas nominal', async () => {
  const base = creerBaseFictive({ sources: [{ id: 3, bot_id: 1, url: 'https://exemple.test/a' }] });
  const { deleteApi } = chargerControleur(base);

  const res = creerReponse();
  await deleteApi({ params: { botId: '1', sourceId: '3' } }, res);

  assert.strictEqual(res.code, 200);
  assert.strictEqual(base.tables.api_sources.length, 0);
});

test('suppression de source API : cas croise, 404 et la source survit', async () => {
  const base = creerBaseFictive({ sources: [{ id: 3, bot_id: 2, url: 'https://exemple.test/a' }] });
  const { deleteApi } = chargerControleur(base);

  const res = creerReponse();
  await deleteApi({ params: { botId: '1', sourceId: '3' } }, res);

  assert.strictEqual(res.code, 404);
  assert.strictEqual(base.tables.api_sources.length, 1, 'la source d un autre bot doit rester intacte');

  const [requete] = base.journal.filter((r) => r.sql.startsWith('DELETE'));
  assert.match(requete.sql, /WHERE id = \? AND bot_id = \?/);
  assert.deepStrictEqual(requete.params, ['3', '1']);
});

// ─── GET /knowledge/:botId/documents/:docId/view ──────────────────────────

test('consultation de document : cas nominal, le fichier est servi', async () => {
  const fichier = path.join(os.tmpdir(), `marsabot-test-${Date.now()}.txt`);
  fs.writeFileSync(fichier, 'contenu de test');
  try {
    const base = creerBaseFictive({ documents: [{ id: 7, bot_id: 1, chemin: fichier }] });
    const { viewFile } = chargerControleur(base);

    const res = creerReponse();
    await viewFile({ params: { botId: '1', docId: '7' } }, res);

    assert.strictEqual(res.fichierEnvoye, fichier);
    assert.strictEqual(res.corps, null, 'aucune erreur ne doit etre renvoyee');
  } finally {
    fs.unlinkSync(fichier);
  }
});

test('consultation de document : cas croise, 404 et le fichier n est pas servi', async () => {
  const fichier = path.join(os.tmpdir(), `marsabot-test-${Date.now()}-b.txt`);
  fs.writeFileSync(fichier, 'contenu confidentiel d un autre bot');
  try {
    const base = creerBaseFictive({ documents: [{ id: 7, bot_id: 2, chemin: fichier }] });
    const { viewFile } = chargerControleur(base);

    const res = creerReponse();
    await viewFile({ params: { botId: '1', docId: '7' } }, res);

    assert.strictEqual(res.code, 404);
    assert.strictEqual(res.fichierEnvoye, null, 'le contenu ne doit pas quitter le serveur');
    assert.ok(fs.existsSync(fichier), 'le fichier doit rester sur le disque');
  } finally {
    fs.unlinkSync(fichier);
  }
});

test('consultation de document : la reponse 404 ne distingue pas absent et non possede', async () => {
  const messages = [];
  for (const documents of [[], [{ id: 7, bot_id: 2, chemin: '/inexistant/a.txt' }]]) {
    const base = creerBaseFictive({ documents });
    const { viewFile } = chargerControleur(base);
    const res = creerReponse();
    await viewFile({ params: { botId: '1', docId: '7' } }, res);
    messages.push(`${res.code}:${res.corps.message}`);
  }
  assert.strictEqual(messages[0], messages[1], 'les deux cas doivent etre indiscernables');
});

// ─── POST /knowledge/upload : le bot cible doit exister ───────────────────

test('upload : un bot inconnu est refuse en 404 et le fichier temporaire est efface', async () => {
  const fichier = path.join(os.tmpdir(), `marsabot-upload-${Date.now()}.txt`);
  fs.writeFileSync(fichier, 'contenu');

  const base = creerBaseFictive({ bots: [{ id: 1 }] });
  const { uploadFile } = chargerControleur(base);

  const res = creerReponse();
  await uploadFile(
    { body: { botId: '99' }, file: { path: fichier, originalname: 'a.txt', size: 7, mimetype: 'text/plain' } },
    res
  );

  assert.strictEqual(res.code, 404);
  assert.match(res.corps.message, /Bot introuvable/);
  assert.ok(!fs.existsSync(fichier), 'le fichier depose par multer doit etre efface');
});

test('upload : un bot existant passe le controle et le traitement se poursuit', async () => {
  const fichier = path.join(os.tmpdir(), `marsabot-upload-${Date.now()}-ok.txt`);
  fs.writeFileSync(fichier, 'contenu');
  try {
    // Le document porte deja ce nom pour ce bot : le traitement s arrete sur
    // l anti-doublon, juste apres le controle d existence. Cela prouve que le
    // controle a ete franchi sans lancer ni insertion ni vectorisation, qui
    // exigeraient une vraie base et un serveur Ollama.
    const base = creerBaseFictive({
      bots: [{ id: 1 }],
      documents: [{ id: 7, bot_id: 1, nom_original: 'a.txt' }],
    });
    const { uploadFile } = chargerControleur(base);

    const res = creerReponse();
    await uploadFile(
      { body: { botId: '1' }, file: { path: fichier, originalname: 'a.txt', size: 7, mimetype: 'text/plain' } },
      res
    );

    const verifications = base.journal.filter((r) => r.sql === 'SELECT id FROM bots WHERE id = ? LIMIT 1');
    assert.strictEqual(verifications.length, 1, "l existence du bot doit etre verifiee");
    assert.deepStrictEqual(verifications[0].params, ['1']);

    assert.strictEqual(res.code, 400, 'arret attendu sur l anti-doublon, pas sur le bot');
    assert.match(res.corps.message, /existe deja|existe déjà/i);
  } finally {
    if (fs.existsSync(fichier)) fs.unlinkSync(fichier);
  }
});

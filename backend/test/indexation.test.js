'use strict';

// Statut d'indexation : un document dont la vectorisation echoue doit etre
// marque failed, ne plus alimenter la recherche, et pouvoir etre reindexe.
//
// Comme ailleurs dans cette suite, la base et Ollama sont remplaces : la CI n a
// ni l un ni l autre. La base fictive applique reellement les clauses WHERE,
// pour qu un filtre oublie fasse echouer le test.

const test = require('node:test');
const assert = require('node:assert');

const CHEMIN_DB = require.resolve('../src/config/db');
const CHEMIN_AXIOS = require.resolve('axios');
const CHEMIN_MODELE = require.resolve('../src/models/documentModel');
const CHEMIN_VECTEUR = require.resolve('../src/services/vectorService');

const aplatir = (sql) => sql.replace(/\s+/g, ' ').trim();

/**
 * Base fictive minimale : documents, chunks, et une transaction dont on peut
 * observer si elle a ete validee ou annulee.
 */
function creerBase({ documents = [], chunks = [], echouerInsert = false } = {}) {
  const etat = { documents, chunks, commits: 0, rollbacks: 0, requetes: [] };
  let prochainId = 1000;

  const executer = async (sql, params = []) => {
    const s = aplatir(sql);
    etat.requetes.push(s);

    if (s.startsWith('UPDATE documents SET indexing_status')) {
      const [statut, erreur, id] = params;
      const doc = etat.documents.find((d) => String(d.id) === String(id));
      if (doc) { doc.indexing_status = statut; doc.indexing_error = erreur; }
      return [{ affectedRows: doc ? 1 : 0 }];
    }
    if (s === 'DELETE FROM document_chunks WHERE document_id = ?') {
      const avant = etat.chunks.length;
      etat.chunks = etat.chunks.filter((c) => String(c.document_id) !== String(params[0]));
      return [{ affectedRows: avant - etat.chunks.length }];
    }
    if (s.startsWith('INSERT INTO document_chunks')) {
      if (echouerInsert) throw new Error('ecriture refusee par la base');
      etat.chunks.push({ id: prochainId++, document_id: params[0], chunk_text: params[1], embedding: params[2] });
      return [{ insertId: prochainId }];
    }
    if (s.includes('FROM document_chunks dc') && s.includes('JOIN documents d')) {
      const botId = params[0];
      // Le filtre sur indexing_status est applique tel qu il figure dans la
      // requete : un oubli cote code se verrait ici.
      const filtreStatut = s.includes("d.indexing_status = 'indexed'");
      const lignes = etat.chunks.filter((c) => {
        const doc = etat.documents.find((d) => String(d.id) === String(c.document_id));
        if (!doc || String(doc.bot_id) !== String(botId)) return false;
        return filtreStatut ? (doc.indexing_status || 'indexed') === 'indexed' : true;
      });
      return [lignes.map((c) => ({
        id: c.id, document_id: c.document_id, chunk_text: c.chunk_text, embedding: c.embedding,
      }))];
    }
    throw new Error('Requete non prevue : ' + s);
  };

  const connexion = {
    execute: executer,
    beginTransaction: async () => {},
    commit: async () => { etat.commits++; },
    rollback: async () => { etat.rollbacks++; },
    release: () => {},
  };

  etat.pool = { execute: executer, getConnection: async () => connexion };
  return etat;
}

/** Recharge vectorService avec la base fictive et un Ollama simule. */
function chargerVecteur(base, { embeddingEchoue = false } = {}) {
  require.cache[CHEMIN_DB] = {
    id: CHEMIN_DB, filename: CHEMIN_DB, loaded: true,
    exports: { pool: base.pool, testConnection: async () => {} },
  };
  require.cache[CHEMIN_AXIOS] = {
    id: CHEMIN_AXIOS, filename: CHEMIN_AXIOS, loaded: true,
    exports: {
      async post() {
        if (embeddingEchoue) throw new Error('connect ECONNREFUSED 127.0.0.1:11434');
        return { data: { embedding: [1, 0, 0] } };
      },
    },
  };
  delete require.cache[CHEMIN_MODELE];
  delete require.cache[CHEMIN_VECTEUR];
  return require('../src/services/vectorService');
}

const DOCUMENT = { id: 7, bot_id: 1, indexing_status: 'pending', indexing_error: null };
const TEXTE = Array.from({ length: 12 }, (_, i) => `ligne ${i} du document de test`).join('\n');

// ─── Embeddings indisponibles → failed ────────────────────────────────────

test('embeddings indisponibles : le document passe en failed avec un motif', async () => {
  const base = creerBase({ documents: [{ ...DOCUMENT }] });
  const vecteur = chargerVecteur(base, { embeddingEchoue: true });

  await assert.rejects(() => vecteur.processAndStoreDocument(7, TEXTE));

  assert.strictEqual(base.documents[0].indexing_status, 'failed');
  assert.match(base.documents[0].indexing_error, /ECONNREFUSED/);
});

test('embeddings indisponibles : aucun chunk partiel n est ecrit', async () => {
  const base = creerBase({ documents: [{ ...DOCUMENT }] });
  const vecteur = chargerVecteur(base, { embeddingEchoue: true });

  await assert.rejects(() => vecteur.processAndStoreDocument(7, TEXTE));
  assert.strictEqual(base.chunks.length, 0);
});

// ─── Ecriture atomique ────────────────────────────────────────────────────

test('un echec pendant l ecriture annule la transaction, sans chunk orphelin', async () => {
  const base = creerBase({ documents: [{ ...DOCUMENT }], echouerInsert: true });
  const vecteur = chargerVecteur(base);

  await assert.rejects(() => vecteur.processAndStoreDocument(7, TEXTE));

  assert.strictEqual(base.rollbacks, 1, 'la transaction doit etre annulee');
  assert.strictEqual(base.commits, 0, 'rien ne doit etre valide');
  assert.strictEqual(base.chunks.length, 0, 'aucun chunk ne doit subsister');
  assert.strictEqual(base.documents[0].indexing_status, 'failed');
});

test('une indexation reussie valide la transaction et passe le document en indexed', async () => {
  const base = creerBase({ documents: [{ ...DOCUMENT }] });
  const vecteur = chargerVecteur(base);

  await vecteur.processAndStoreDocument(7, TEXTE);

  assert.strictEqual(base.commits, 1);
  assert.strictEqual(base.rollbacks, 0);
  assert.ok(base.chunks.length > 0, 'des chunks doivent avoir ete ecrits');
  assert.strictEqual(base.documents[0].indexing_status, 'indexed');
  assert.strictEqual(base.documents[0].indexing_error, null);
});

test('une reindexation remplace les chunks au lieu de les cumuler', async () => {
  const base = creerBase({
    documents: [{ ...DOCUMENT }],
    chunks: [{ id: 1, document_id: 7, chunk_text: 'ancien chunk', embedding: '[1,0,0]' }],
  });
  const vecteur = chargerVecteur(base);

  await vecteur.processAndStoreDocument(7, TEXTE);

  assert.ok(!base.chunks.some((c) => c.chunk_text === 'ancien chunk'), 'les anciens chunks doivent disparaitre');
});

test('un document sans texte est declare indexed, pas laisse en attente', async () => {
  const base = creerBase({ documents: [{ ...DOCUMENT }] });
  const vecteur = chargerVecteur(base);

  await vecteur.processAndStoreDocument(7, '   ');

  assert.strictEqual(base.documents[0].indexing_status, 'indexed');
  assert.strictEqual(base.chunks.length, 0);
});

// ─── Le RAG n interroge que les documents indexed ─────────────────────────

test('un document failed n est pas utilise par la recherche', async () => {
  const base = creerBase({
    documents: [
      { id: 7, bot_id: 1, indexing_status: 'indexed' },
      { id: 8, bot_id: 1, indexing_status: 'failed' },
    ],
    chunks: [
      { id: 1, document_id: 7, chunk_text: 'CONTENU-SAIN', embedding: '[1,0,0]' },
      { id: 2, document_id: 8, chunk_text: 'CONTENU-PARTIEL', embedding: '[1,0,0]' },
    ],
  });
  const vecteur = chargerVecteur(base);

  const contexte = await vecteur.findSimilarChunks([1, 0, 0], 1);

  assert.ok(contexte.includes('CONTENU-SAIN'));
  assert.ok(!contexte.includes('CONTENU-PARTIEL'), "le document en echec ne doit pas alimenter la reponse");
});

test('un document en cours d indexation n est pas utilise non plus', async () => {
  const base = creerBase({
    documents: [{ id: 8, bot_id: 1, indexing_status: 'pending' }],
    chunks: [{ id: 2, document_id: 8, chunk_text: 'CONTENU-EN-COURS', embedding: '[1,0,0]' }],
  });
  const vecteur = chargerVecteur(base);

  assert.strictEqual(await vecteur.findSimilarChunks([1, 0, 0], 1), '');
});

test('apres reindexation reussie, le contenu redevient visible de la recherche', async () => {
  const base = creerBase({ documents: [{ id: 7, bot_id: 1, indexing_status: 'failed' }] });
  const vecteur = chargerVecteur(base);

  assert.strictEqual(await vecteur.findSimilarChunks([1, 0, 0], 1), '', 'invisible tant qu il est en echec');

  await vecteur.processAndStoreDocument(7, 'ligne unique de contenu retrouve');

  assert.strictEqual(base.documents[0].indexing_status, 'indexed');
  const contexte = await vecteur.findSimilarChunks([1, 0, 0], 1);
  assert.ok(contexte.includes('contenu retrouve'), 'le contenu doit redevenir interrogeable');
});

test('les documents d un autre bot restent hors de la recherche', async () => {
  const base = creerBase({
    documents: [
      { id: 7, bot_id: 1, indexing_status: 'indexed' },
      { id: 9, bot_id: 2, indexing_status: 'indexed' },
    ],
    chunks: [
      { id: 1, document_id: 7, chunk_text: 'BOT-UN', embedding: '[1,0,0]' },
      { id: 3, document_id: 9, chunk_text: 'BOT-DEUX', embedding: '[1,0,0]' },
    ],
  });
  const vecteur = chargerVecteur(base);

  const contexte = await vecteur.findSimilarChunks([1, 0, 0], 1);
  assert.ok(contexte.includes('BOT-UN'));
  assert.ok(!contexte.includes('BOT-DEUX'));
});

const axios = require('axios');
const { pool } = require('../config/db');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const EMBED_MODEL = 'nomic-embed-text';

/**
 * Decoupe un texte en chunks en respectant les frontieres de ligne.
 *
 * Une ligne n est jamais coupee en deux : pour un CSV (une ligne = un
 * enregistrement) chaque enregistrement reste entier, avec son identifiant et
 * son statut. Le decoupage purement positionnel qui precedait scindait les
 * lignes en plein milieu, rendant certains enregistrements inexploitables.
 *
 * Le recouvrement reprend les dernieres lignes completes du chunk precedent.
 * Une ligne isolee plus longue que chunkSize est decoupee par caracteres.
 *
 * @param {string} text        - Texte source
 * @param {number} chunkSize   - Taille cible en caracteres d un chunk
 * @param {number} overlap     - Caracteres de recouvrement entre chunks
 * @returns {string[]}
 */
function chunkText(text, chunkSize = 1000, overlap = 200) {
  if (!text) return [];

  const NL = String.fromCharCode(10);
  // Pas positif garanti meme si overlap >= chunkSize (securite anti-boucle)
  const step = chunkSize - overlap > 0 ? chunkSize - overlap : chunkSize;
  const chunks = [];
  let current = [];   // lignes du chunk en cours
  let length = 0;     // longueur cumulee, separateurs compris

  const flush = () => { if (current.length) chunks.push(current.join(NL)); };

  for (const line of text.split(NL)) {
    // Ligne seule trop longue : repli sur un decoupage par caracteres
    if (line.length > chunkSize) {
      flush();
      current = [];
      length = 0;
      for (let i = 0; i < line.length; i += step) {
        chunks.push(line.slice(i, i + chunkSize));
      }
      continue;
    }

    // La ligne ne rentre plus : on ferme le chunk et on prepare le recouvrement
    if (length + line.length + 1 > chunkSize && current.length) {
      flush();
      const carry = [];
      let carried = 0;
      for (let i = current.length - 1; i >= 0; i--) {
        const taille = current[i].length + 1;
        if (carried + taille > overlap) break;
        carry.unshift(current[i]);
        carried += taille;
      }
      current = carry;
      length = carried;
    }

    current.push(line);
    length += line.length + 1;
  }

  flush();
  return chunks;
}

/**
 * Obtient l'embedding d'un texte via l'API Ollama.
 * @param {string} text
 * @returns {Promise<number[]>}
 */
async function getEmbedding(text) {
  const response = await axios.post(
    `${OLLAMA_URL}/api/embeddings`,
    { model: EMBED_MODEL, prompt: text },
    { timeout: 10000 } // 10 s max — évite de bloquer le handler WhatsApp
  );
  return response.data.embedding;
}

/**
 * Découpe le texte en chunks, vectorise chaque chunk via Ollama et stocke
 * les résultats dans la table document_chunks.
 * @param {number} documentId
 * @param {string} text
 */
async function processAndStoreDocument(documentId, text) {
  if (!text || text.trim().length === 0) {
    console.log(`⚠️  Aucun texte à vectoriser pour le document ${documentId}.`);
    return;
  }

  const chunks = chunkText(text);
  console.log(`✂️  Découpage du texte en ${chunks.length} chunks...`);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const embedding = await getEmbedding(chunk);
    await pool.execute(
      'INSERT INTO document_chunks (document_id, chunk_text, embedding) VALUES (?, ?, ?)',
      [documentId, chunk, JSON.stringify(embedding)]
    );
  }

  console.log(`🔢 Vectorisation et stockage terminés (${chunks.length} chunks pour le document ${documentId}).`);
}

/**
 * Calcule la similarité cosinus entre deux vecteurs.
 * @param {number[]} vecA
 * @param {number[]} vecB
 * @returns {number} score entre -1 et 1
 */
function cosineSimilarity(vecA, vecB) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot   += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Cherche les chunks les plus proches semantiquement de la question.
 *
 * La SELECTION se fait par score, mais la RESTITUTION suit l ordre du
 * document (document_id puis id, tous deux croissants). Sans cela, un
 * tableau reparti sur plusieurs chunks etait remis au LLM dans le desordre :
 * la seconde moitie avant la premiere, ce qui lui faisait manquer des lignes.
 *
 * @param {number[]} questionEmbedding  - Vecteur de la question
 * @param {number|string} botId
 * @param {number} topK                 - Nombre de chunks a retenir
 * @returns {Promise<string>}           - Chunks concatenes, en ordre documentaire
 */
async function findSimilarChunks(questionEmbedding, botId, topK = 4) {
  const [rows] = await pool.execute(
    `SELECT dc.id, dc.document_id, dc.chunk_text, dc.embedding
     FROM document_chunks dc
     JOIN documents d ON dc.document_id = d.id
     WHERE d.bot_id = ?`,
    [String(botId)]
  );

  if (rows.length === 0) return '';

  const scored = rows.map((row) => {
    const embedding = typeof row.embedding === "string"
      ? JSON.parse(row.embedding)
      : row.embedding;
    return {
      id: row.id,
      documentId: row.document_id,
      text: row.chunk_text,
      score: cosineSimilarity(questionEmbedding, embedding),
    };
  });

  // 1. Selection : les topK meilleurs scores
  const retenus = scored.sort((a, b) => b.score - a.score).slice(0, topK);

  // 2. Restitution : ordre documentaire, pour ne pas presenter un tableau
  //    ou un texte suivi dans le desordre.
  retenus.sort((a, b) => (a.documentId - b.documentId) || (a.id - b.id));

  const SEP = String.fromCharCode(10, 10);
  return retenus.map((c) => c.text).join(SEP);
}

module.exports = { chunkText, getEmbedding, processAndStoreDocument, cosineSimilarity, findSimilarChunks };

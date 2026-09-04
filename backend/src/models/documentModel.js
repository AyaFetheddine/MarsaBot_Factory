const { pool } = require('../config/db');

/**
 * Crée la table documents si elle n'existe pas encore.
 *
 * La définition est identique à celle de sql/init.sql, qui reste la source de
 * vérité. Les ALTER TABLE de rattrapage qui figuraient ici — pour content, puis
 * pour les colonnes d'indexation — ont été retirés : ils faisaient diverger le
 * schéma réel de celui du fichier, et masquaient la divergence en avalant
 * l'erreur 1060. Une base créée avant ces colonnes doit donc être migrée à la
 * main, la procédure est dans le README.
 */
async function initDocumentsTable() {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS documents (
      id                  INT           AUTO_INCREMENT PRIMARY KEY,
      bot_id              INT           NOT NULL,
      nom_original        VARCHAR(255)  NOT NULL,
      nom_fichier_genere  VARCHAR(255)  NOT NULL,
      chemin              VARCHAR(500)  NOT NULL,
      taille              INT           NOT NULL DEFAULT 0,
      content             LONGTEXT,
      indexing_status     ENUM('pending','indexed','failed') NOT NULL DEFAULT 'indexed',
      indexing_error      VARCHAR(255),
      date_ajout          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_documents_bot
        FOREIGN KEY (bot_id) REFERENCES bots(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
    ) ENGINE=InnoDB
  `);
  console.log('✅ Table documents vérifiée/créée.');
}

/**
 * Vérifie si un fichier avec le même nom original existe déjà pour un bot.
 */
async function findByBotAndName(botId, originalName) {
  const [rows] = await pool.execute(
    'SELECT id FROM documents WHERE bot_id = ? AND nom_original = ? LIMIT 1',
    [botId, originalName]
  );
  return rows[0] || null;
}

/**
 * Insère un nouveau document en base.
 *
 * Le statut d'indexation est explicite : 'pending' quand il y a du texte à
 * vectoriser, 'indexed' quand il n'y en a pas. Un document sans texte n'a rien
 * à indexer, le laisser en attente le ferait paraître bloqué pour toujours.
 */
async function createDocument({ botId, nomOriginal, nomFichierGenere, chemin, taille, content = '' }) {
  const statutInitial = content.trim().length > 0 ? 'pending' : 'indexed';
  const [result] = await pool.execute(
    `INSERT INTO documents (bot_id, nom_original, nom_fichier_genere, chemin, taille, content, indexing_status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [botId, nomOriginal, nomFichierGenere, chemin, taille, content, statutInitial]
  );
  const [rows] = await pool.execute(
    'SELECT * FROM documents WHERE id = ?',
    [result.insertId]
  );
  return rows[0];
}

/**
 * Récupère tous les documents d'un bot, du plus récent au plus ancien.
 */
async function getDocumentsByBot(botId) {
  const [rows] = await pool.execute(
    'SELECT * FROM documents WHERE bot_id = ? ORDER BY date_ajout DESC',
    [botId]
  );
  return rows;
}

/**
 * Récupère un document par son id, à condition qu'il appartienne au bot donné.
 * Renvoie null si le document n'existe pas OU s'il appartient à un autre bot :
 * l'appelant ne peut donc pas distinguer les deux cas, et répond 404 dans les
 * deux, sans révéler l'existence d'une ressource d'un autre bot.
 */
async function getDocumentByIdForBot(id, botId) {
  const [rows] = await pool.execute(
    'SELECT * FROM documents WHERE id = ? AND bot_id = ? LIMIT 1',
    [id, botId]
  );
  return rows[0] || null;
}

/**
 * Supprime un document appartenant au bot donné.
 * Le bot_id fait partie de la clause WHERE : une demande croisée ne supprime
 * rien du tout, plutôt que de supprimer la ressource d'un autre bot.
 * @returns {Promise<number>} nombre de lignes réellement supprimées (0 ou 1)
 */
async function deleteDocument(id, botId) {
  const [result] = await pool.execute(
    'DELETE FROM documents WHERE id = ? AND bot_id = ?',
    [id, botId]
  );
  return result.affectedRows;
}

/**
 * Enregistre le résultat d'une tentative d'indexation.
 *
 * Le motif d'échec est tronqué à la taille de la colonne : une pile d'appels
 * complète n'apporte rien dans l'interface, et une insertion trop longue
 * échouerait, faisant perdre l'information au lieu de la conserver.
 */
async function setIndexingStatus(id, statut, erreur = null) {
  const motif = erreur ? String(erreur).slice(0, 255) : null;
  await pool.execute(
    'UPDATE documents SET indexing_status = ?, indexing_error = ? WHERE id = ?',
    [statut, motif, id]
  );
}

/**
 * Crée la table document_chunks si elle n'existe pas encore.
 * Chaque chunk est lié à un document (ON DELETE CASCADE) et stocke
 * le texte brut ainsi que l'embedding au format JSON.
 */
async function initChunksTable() {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS document_chunks (
      id           INT  AUTO_INCREMENT PRIMARY KEY,
      document_id  INT  NOT NULL,
      chunk_text   TEXT NOT NULL,
      embedding    JSON,
      CONSTRAINT fk_chunks_document
        FOREIGN KEY (document_id) REFERENCES documents(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
    ) ENGINE=InnoDB
  `);
  console.log('✅ Table document_chunks vérifiée/créée.');
}

module.exports = { initDocumentsTable, initChunksTable, findByBotAndName, createDocument, getDocumentsByBot, getDocumentByIdForBot, deleteDocument, setIndexingStatus };

const { pool } = require('../config/db');

/**
 * Crée la table messages si elle n'existe pas encore.
 * Appelé une seule fois au démarrage du serveur.
 */
async function initMessagesTable() {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS messages (
      id         INT           AUTO_INCREMENT PRIMARY KEY,
      id_groupe  VARCHAR(255)  NOT NULL,
      bot_id     VARCHAR(255)  NOT NULL,
      role       ENUM('user', 'assistant') NOT NULL,
      content    TEXT          NOT NULL,
      created_at TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_messages_groupe_bot (id_groupe, bot_id),
      INDEX idx_messages_created (created_at)
    ) ENGINE=InnoDB
  `);
  // Migration défensive : ajoute bot_id si la table existait sans elle
  try {
    await pool.execute(
      `ALTER TABLE messages ADD COLUMN bot_id VARCHAR(255) NOT NULL DEFAULT '' AFTER id_groupe`
    );
    console.log('✅ Colonne bot_id ajoutée à la table messages (migration).');
  } catch (alterErr) {
    // Erreur 1060 = colonne déjà existante → ignorée silencieusement
    if (alterErr.errno !== 1060) throw alterErr;
  }
  console.log('✅ Table messages vérifiée/créée.');
}

/**
 * Insère un message dans l'historique.
 * @param {string} idGroupe  - Identifiant WhatsApp de l'utilisateur/groupe
 * @param {'user'|'assistant'} role
 * @param {string} content
 */
async function saveMessage(idGroupe, botId, role, content) {
  await pool.execute(
    'INSERT INTO messages (id_groupe, bot_id, role, content) VALUES (?, ?, ?, ?)',
    [idGroupe, botId, role, content]
  );
}

/**
 * Récupère les N derniers messages d'un utilisateur/groupe, du plus ancien au plus récent.
 * @param {string} idGroupe
 * @param {number} limit
 * @returns {Promise<{role: string, content: string}[]>}
 */
async function getRecentMessages(idGroupe, botId, limit = 10) {
  // MySQL n'accepte pas de parametre lie apres LIMIT dans une requete preparee :
  // la requete echouait a chaque appel avec « Incorrect arguments to
  // mysqld_stmt_execute ». L'erreur etant rattrapee plus haut et convertie en
  // tableau vide, la panne etait invisible et l'historique de conversation
  // toujours vide.
  //
  // La limite est donc interpolee, apres avoir ete ramenee a un entier borne.
  // Elle ne peut pas porter d'injection : ce qui est insere est le resultat d'un
  // calcul numerique, jamais la valeur recue. Les deux autres parametres restent
  // lies normalement.
  const borne = Math.min(Math.max(Number.parseInt(limit, 10) || 10, 1), 100);
  const [rows] = await pool.execute(
    `SELECT role, content FROM (
       SELECT role, content, created_at
       FROM messages
       WHERE id_groupe = ? AND bot_id = ?
       ORDER BY created_at DESC
       LIMIT ${borne}
     ) sub
     ORDER BY sub.created_at ASC`,
    [idGroupe, botId]
  );
  return rows;
}

module.exports = { initMessagesTable, saveMessage, getRecentMessages };

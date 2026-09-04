const { pool } = require('../config/db');

/**
 * Crée la table api_sources si elle n'existe pas encore.
 * Appelé une seule fois au démarrage du serveur.
 */
async function initApiSourceTable() {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS api_sources (
      id         INT            AUTO_INCREMENT PRIMARY KEY,
      bot_id     INT            NOT NULL,
      url        VARCHAR(2048)  NOT NULL,
      date_ajout TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_apisource_bot
        FOREIGN KEY (bot_id) REFERENCES bots(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
    ) ENGINE=InnoDB
  `);
}

/**
 * Ajoute une source API pour un bot.
 */
async function addApiSource(botId, url) {
  const [result] = await pool.execute(
    'INSERT INTO api_sources (bot_id, url) VALUES (?, ?)',
    [botId, url]
  );
  const [rows] = await pool.execute(
    'SELECT * FROM api_sources WHERE id = ?',
    [result.insertId]
  );
  return rows[0];
}

/**
 * Récupère toutes les sources API d'un bot, de la plus récente à la plus ancienne.
 */
async function getApiSourcesByBot(botId) {
  const [rows] = await pool.execute(
    'SELECT * FROM api_sources WHERE bot_id = ? ORDER BY date_ajout DESC',
    [botId]
  );
  return rows;
}

/**
 * Supprime une source API appartenant au bot donné.
 * Le bot_id fait partie de la clause WHERE : une demande croisée ne supprime
 * rien du tout, plutôt que de supprimer la source d'un autre bot.
 * @returns {Promise<number>} nombre de lignes réellement supprimées (0 ou 1)
 */
async function deleteApiSource(id, botId) {
  const [result] = await pool.execute(
    'DELETE FROM api_sources WHERE id = ? AND bot_id = ?',
    [id, botId]
  );
  return result.affectedRows;
}

module.exports = { initApiSourceTable, addApiSource, getApiSourcesByBot, deleteApiSource };

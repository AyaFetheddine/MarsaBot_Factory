const { pool } = require('../config/db');

/**
 * Indique si un bot existe.
 *
 * La table bots est créée par sql/init.sql, pas ici : ce modèle ne fait que la
 * lire. Il sert à refuser un document dont le bot cible est inconnu, avant
 * d'écrire quoi que ce soit en base ou sur le disque. Sans cette vérification,
 * l'insertion échouait plus loin sur la contrainte de clé étrangère, après que
 * multer avait déjà écrit le fichier dans uploads/.
 */
async function botExiste(botId) {
  const [rows] = await pool.execute('SELECT id FROM bots WHERE id = ? LIMIT 1', [botId]);
  return rows.length > 0;
}

module.exports = { botExiste };

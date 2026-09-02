const { pool } = require('../config/db');

const DEFAULT_SETTINGS = [
  { key: 'ollama_url',           value: 'http://localhost:11434' },
  { key: 'ollama_default_model', value: 'llama3.2' },
];

/**
 * Crée la table system_settings et insère les valeurs par défaut
 * si elles n'existent pas encore.
 */
async function initSettingsTable() {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS system_settings (
      id            INT           AUTO_INCREMENT PRIMARY KEY,
      setting_key   VARCHAR(100)  UNIQUE NOT NULL,
      setting_value VARCHAR(1024) NOT NULL DEFAULT ''
    ) ENGINE=InnoDB
  `);

  for (const { key, value } of DEFAULT_SETTINGS) {
    await pool.execute(
      `INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES (?, ?)`,
      [key, value]
    );
  }
}

/**
 * Retourne tous les paramètres sous forme de tableau.
 */
async function getAllSettings() {
  const [rows] = await pool.execute('SELECT setting_key, setting_value FROM system_settings');
  return rows;
}

/**
 * Met à jour la valeur d'un paramètre existant.
 */
async function updateSetting(key, value) {
  await pool.execute(
    'UPDATE system_settings SET setting_value = ? WHERE setting_key = ?',
    [value, key]
  );
}

module.exports = { initSettingsTable, getAllSettings, updateSetting };

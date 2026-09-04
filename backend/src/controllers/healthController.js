const axios = require('axios');
const { pool } = require('../config/db');

// Une sonde ne doit jamais faire attendre son appelant : au-dela de ce delai,
// la dependance est declaree indisponible plutot que de bloquer le healthcheck
// du conteneur, qui a lui-meme son propre timeout.
const DELAI_SONDE_MS = 3000;

/**
 * Vérifie que MySQL répond réellement à une requête, et pas seulement que le
 * port est ouvert.
 */
async function sonderMysql() {
  const debut = Date.now();
  try {
    await pool.query('SELECT 1');
    return { statut: 'ok', duree_ms: Date.now() - debut };
  } catch (erreur) {
    return { statut: 'indisponible', duree_ms: Date.now() - debut, detail: erreur.message };
  }
}

/**
 * Vérifie qu'Ollama répond et remonte le nombre de modèles disponibles. Un
 * Ollama joignable mais sans modèle installé ne peut produire aucune réponse :
 * l'information est donc utile au diagnostic.
 */
async function sonderOllama() {
  const debut = Date.now();
  const url = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/+$/, '');
  try {
    const reponse = await axios.get(`${url}/api/tags`, { timeout: DELAI_SONDE_MS });
    const modeles = Array.isArray(reponse.data?.models) ? reponse.data.models : [];
    return { statut: 'ok', duree_ms: Date.now() - debut, url, modeles: modeles.length };
  } catch (erreur) {
    return { statut: 'indisponible', duree_ms: Date.now() - debut, url, detail: erreur.message };
  }
}

/**
 * GET /health — sonde applicative destinée à la supervision et au healthcheck
 * du conteneur. Sans authentification : un orchestrateur ne dispose d'aucun
 * jeton, et la réponse ne révèle que l'état des dépendances.
 *
 * Renvoie 200 si tout répond, 503 sinon, pour qu'un orchestrateur puisse se
 * fier au seul code HTTP. /api/health, plus ancienne et purement déclarative,
 * est conservée telle quelle : elle répond même quand MySQL est à terre, ce qui
 * reste utile pour distinguer un serveur mort d'une dépendance en panne.
 */
async function sante(_req, res) {
  const [mysql, ollama] = await Promise.all([sonderMysql(), sonderOllama()]);
  const tout_va_bien = mysql.statut === 'ok' && ollama.statut === 'ok';

  return res.status(tout_va_bien ? 200 : 503).json({
    status: tout_va_bien ? 'OK' : 'DEGRADE',
    timestamp: new Date().toISOString(),
    dependances: { mysql, ollama },
  });
}

module.exports = { sante, sonderMysql, sonderOllama };

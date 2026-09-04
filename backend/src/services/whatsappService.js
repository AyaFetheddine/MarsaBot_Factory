const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');
const vectorService = require('./vectorService');
const agentService = require('./agentService');
const { persistMessage, getHistory } = require('./historyService');
const { verifierUrlSource, verifierRedirection } = require('../utils/urlGuard');
const { masquerSecretsUrl, formaterEtatOperationnel } = require('../utils/apiSourceFormat');

/**
 * Map des clients actifs : botId (string) → { client, status }
 * statuts : 'initializing' | 'qr_ready' | 'ready' | 'disconnected'
 */
const clients = new Map();

/**
 * Détruit un client existant pour un botId donné.
 */
async function destroyClient(botId) {
  const entry = clients.get(String(botId));
  if (entry) {
    try { await entry.client.destroy(); } catch { /* ignore */ }
    clients.delete(String(botId));
  }
}

/**
 * Initialise un client WhatsApp pour un bot.
 * @param {number|string} botId
 * @param {function} qrCallback  (err, qrBase64DataURL) — appelé lors du premier QR
 */
async function initializeWhatsApp(botId, qrCallback) {
  const key = String(botId);

  // Réinitialise si un client existe déjà
  await destroyClient(key);

  // Supprime le lockfile Chrome résiduel (laissé par un crash/arrêt brutal)
  const sessionDir = path.join(__dirname, '..', '..', '.wwebjs_auth', `session-bot_${key}`);
  const lockfilePath = path.join(sessionDir, 'lockfile');
  try {
    if (fs.existsSync(lockfilePath)) {
      fs.unlinkSync(lockfilePath);
      console.log(`🔓 Lockfile supprimé pour bot #${key}`);
    }
  } catch { /* ignore — pas bloquant */ }

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: `bot_${key}` }),
    puppeteer: {
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    },
    // Epingle la build de WhatsApp Web. Sans cela, LocalWebCache retombe en
    // silence sur la derniere build servie par Meta ; celle du 02/09/2026
    // (2.3000.1046532346) casse l'injection de window.Store et rend le client
    // sourd aux messages entrants tout en emettant quand meme 'ready'.
    // strict:true fait echouer bruyamment plutot que de degrader en silence.
    webVersion: '2.3000.1038499816',
    webVersionCache: {
      type: 'local',
      path: path.join(__dirname, '..', '..', '.wwebjs_cache'),
      strict: true,
    },
  });

  clients.set(key, { client, status: 'initializing' });

  client.on('qr', async (qr) => {
    const entry = clients.get(key);
    if (entry) entry.status = 'qr_ready';
    try {
      const base64 = await qrcode.toDataURL(qr);
      qrCallback(null, base64);
    } catch (err) {
      qrCallback(err);
    }
  });

  client.on('ready', async () => {
    const entry = clients.get(key);
    if (entry) entry.status = 'ready';
    console.log(`✅ Bot #${key} WhatsApp connecté et prêt.`);
    try {
      await pool.execute("UPDATE bots SET statut = 'actif' WHERE id = ?", [key]);
    } catch (dbErr) {
      console.error(`⚠️ Impossible de mettre à jour le statut du bot #${key} :`, dbErr.message);
    }
  });

  // ── Traitement des messages entrants ──────────────────────────────────────
  client.on('message', async (msg) => {
    // Ignorer groupes et statuts.
    // whatsapp-web.js n'expose pas msg.isGroupMsg : l'identifiant d'un groupe
    // se termine par @g.us, celui d'un contact par @c.us.
    if (msg.from.endsWith('@g.us') || msg.from === 'status@broadcast') return;

    try {
      // 0. Persister le message de l'utilisateur
      await persistMessage(msg.from, key, 'user', msg.body);

      // 1. Récupérer la configuration globale Ollama
      const [settingRows] = await pool.execute(
        "SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ('ollama_url', 'ollama_default_model')"
      );
      const settingsMap = {};
      settingRows.forEach(({ setting_key, setting_value }) => {
        settingsMap[setting_key] = setting_value;
      });
      const ollamaUrl = settingsMap['ollama_url'] || 'http://localhost:11434';
      const defaultModel = settingsMap['ollama_default_model'] || 'llama3.2';

      // 2. Récupérer la config du bot (allow_general_knowledge)
      const [botRows] = await pool.execute(
        'SELECT allow_general_knowledge FROM bots WHERE id = ? LIMIT 1',
        [key]
      );
      const allowGeneralKnowledge = botRows.length > 0 ? Boolean(botRows[0].allow_general_knowledge) : false;

      // 3. RAG — vectoriser la question et chercher dans la mémoire du bot
      let retrievedContext = '';
      try {
        const questionEmbedding = await vectorService.getEmbedding(msg.body);
        retrievedContext = await vectorService.findSimilarChunks(questionEmbedding, key);
        console.log(`🔍 Contexte trouvé pour bot #${key} :`, retrievedContext || '(vide)');
      } catch (ragErr) {
        console.warn(`⚠️  RAG échoué pour bot #${key} :`, ragErr.message);
        retrievedContext = '';
      }

      // 3b. Sources API externes configurées pour ce bot
      let apiContext = '';
      try {
        const [apiRows] = await pool.execute(
          'SELECT url FROM api_sources WHERE bot_id = ? ORDER BY date_ajout DESC',
          [key]
        );
        if (apiRows.length > 0) {
          const apiResults = [];
          for (const { url } of apiRows) {
            try {
              const isGoogleSheetsCsv =
                url.includes('docs.google.com/spreadsheets') || url.includes('format=csv');
              const isGoogleDocsTxt =
                url.includes('docs.google.com/document') || url.includes('format=txt');

              const urlSansSecret = masquerSecretsUrl(url);
              console.log(`🌐 Appel de l'API externe : ${urlSansSecret}`);
              // Revalidation a l usage : protege aussi les sources
              // enregistrees avant la mise en place du controle.
              await verifierUrlSource(url);

              const resp = await axios.get(url, {
                timeout: 5000,
                responseType: (isGoogleSheetsCsv || isGoogleDocsTxt) ? 'text' : 'json',
                // Les exports Google Sheets et Docs redirigent : on les suit,
                // mais chaque saut est verifie pour ne pas atterrir en interne.
                maxRedirects: 5,
                beforeRedirect: (options) => {
                  verifierRedirection(options.protocol, options.hostname, options.port);
                },
              });

              let data;
              if (isGoogleDocsTxt) {
                // ── Google Docs TXT : injection brute sans parsing ───────
                data = typeof resp.data === 'string' ? resp.data.trim() : String(resp.data).trim();
                console.log(`🔵 Synchronisation Google Docs réussie (${data.length} caractères)`);
              } else if (isGoogleSheetsCsv) {
                // ── Parsing CSV dynamique ────────────────────────────────
                const rawText = typeof resp.data === 'string' ? resp.data : String(resp.data);
                const lines = rawText.split(/\r?\n/).filter(l => l.trim() !== '');
                if (lines.length < 2) {
                  data = rawText; // pas d'en-têtes détectables, on envoie brut
                } else {
                  const delimiter = lines[0].includes(';') ? ';' : ',';
                  const splitCsv = (line) => {
                    const result = [];
                    let current = '';
                    let inQuotes = false;
                    for (let i = 0; i < line.length; i++) {
                      const ch = line[i];
                      if (ch === '"') {
                        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
                        else { inQuotes = !inQuotes; }
                      } else if (ch === delimiter && !inQuotes) {
                        result.push(current.trim()); current = '';
                      } else { current += ch; }
                    }
                    result.push(current.trim());
                    return result;
                  };
                  const headers = splitCsv(lines[0]);
                  const rows = [];
                  for (let i = 1; i < lines.length; i++) {
                    const values = splitCsv(lines[i]);
                    const pairs = headers
                      .map((h, idx) => `${h}: ${values[idx] !== undefined ? values[idx] : ''}`)
                      .join(', ');
                    rows.push(pairs);
                  }
                  data = rows.join('\n');
                  console.log(`🟢 Synchronisation Google Sheets réussie (${rows.length} ligne(s), délimiteur '${delimiter}')`);
                }
              } else {
                // Etat operationnel MarsaTrack : converti en lignes lisibles.
                // Le JSON brut (tableaux imbriques de personnels et d'arrets)
                // est mal exploite par un modele de cette taille.
                const enLignes = formaterEtatOperationnel(resp.data);
                if (enLignes) {
                  data = enLignes;
                  console.log(`🟣 Etat operationnel MarsaTrack mis en forme (${data.length} caractères)`);
                } else {
                  data = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
                }
                console.log(`✅ Appel de l'API externe réussi : ${urlSansSecret}`);
              }

              // URL masquee : un jeton d'authentification ne doit jamais entrer
              // dans le contexte transmis au modele.
              apiResults.push(`[Source: ${urlSansSecret}]\n${data}`);
            } catch (apiErr) {
              console.warn(`⚠️  API externe échouée (${masquerSecretsUrl(url)}) :`, apiErr.message);
            }
          }
          if (apiResults.length > 0) {
            apiContext = apiResults.join('\n\n');
          }
        }
      } catch (apiLookupErr) {
        console.warn('⚠️  Récupération des sources API échouée :', apiLookupErr.message);
      }

      // 4. Court-circuit strict : refuser uniquement si aucun contexte du tout
      if (!allowGeneralKnowledge && !retrievedContext.trim() && !apiContext.trim()) {
        await msg.reply('Désolé, je ne dispose pas de cette information. Puis-je vous aider autrement ?');
        return;
      }

      // 5. Historique de conversation (mémoire à court terme, isolée par bot)
      const historyMessages = await getHistory(msg.from, key, 10);
      const chatHistory = historyMessages
        .map(m => `${m.role === 'user' ? 'Utilisateur' : 'Assistant'}: ${m.content}`)
        .join('\n');

      // 6. Appel à l'agent (llama3.2 + Tavily si allowGeneralKnowledge)
      const finalResponse = await agentService.askAgent(
        msg.body, retrievedContext, allowGeneralKnowledge, apiContext, chatHistory,
        { ollamaUrl, model: defaultModel }
      );

      // 7. Persister la réponse de l'assistant
      await persistMessage(msg.from, key, 'assistant', finalResponse);

      // 8. Répondre sur WhatsApp
      await msg.reply(finalResponse);

    } catch (error) {
      console.error(`Erreur traitement message bot #${key} :`, error.message);
      await msg.reply('Une erreur interne est survenue. Veuillez réessayer.');
    }
  });

  client.on('auth_failure', (msg) => {
    qrCallback(new Error(`Échec d'authentification WhatsApp : ${msg}`));
    clients.delete(key);
  });

  client.on('disconnected', async (reason) => {
    console.log(`🛑 Déconnexion WhatsApp détectée pour le bot ${key}. Raison :`, reason);
    // 1. Mettre à jour le statut en base avant de détruire le client
    try {
      await pool.execute("UPDATE bots SET statut = 'inactif' WHERE id = ?", [key]);
    } catch (dbErr) {
      console.error(`⚠️ Impossible de mettre à jour le statut du bot #${key} :`, dbErr.message);
    }
    try {
      // 2. On détruit proprement l'instance Puppeteer pour relâcher les fichiers (lockfile, etc.)
      await client.destroy();
      console.log(`✅ Instance Puppeteer fermée proprement pour le bot ${key}.`);
    } catch (error) {
      console.error(`⚠️ Erreur lors de la fermeture de l'instance pour le bot ${key}:`, error.message);
    } finally {
      // 3. On retire le bot de la Map des clients actifs pour garder la mémoire propre
      if (clients.has(key)) {
        clients.delete(key);
      }
    }
  });

  // Non-bloquant — les événements 'qr' et 'ready' arrivent de manière asynchrone
  client.initialize().catch((err) => {
    qrCallback(new Error(`Impossible de démarrer Puppeteer : ${err.message}`));
    clients.delete(key);
  });
}

/**
 * Retourne le statut d'un client.
 */
function getClientStatus(botId) {
  const entry = clients.get(String(botId));
  return entry ? entry.status : 'none';
}

/**
 * Relance automatiquement tous les bots ayant le statut 'actif' en base.
 * Appelée au démarrage du serveur pour éviter l'intervention manuelle.
 */
async function initializeActiveBots() {
  const [rows] = await pool.execute("SELECT id FROM bots WHERE statut = 'actif'");
  if (rows.length === 0) {
    console.log('   ℹ️  Aucun bot actif à relancer.');
    return;
  }
  console.log(`   🤖 Relance automatique de ${rows.length} bot(s) actif(s)...`);
  for (const row of rows) {
    try {
      // Callback vide : LocalAuth gère la session, aucun nouveau QR attendu
      await initializeWhatsApp(row.id, (err) => {
        if (err) console.warn(`   ⚠️  QR inattendu pour bot #${row.id} :`, err.message);
      });
      console.log(`   ✅ Bot #${row.id} initialisé.`);
    } catch (err) {
      console.error(`   ❌ Échec de la relance du bot #${row.id} :`, err.message);
    }
  }
}

module.exports = { initializeWhatsApp, destroyClient, getClientStatus, initializeActiveBots };

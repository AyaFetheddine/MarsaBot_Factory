const { pool } = require('../config/db');
const { initializeWhatsApp, getClientStatus } = require('../services/whatsappService');

// Créer un nouveau bot
async function createBot(req, res) {
  try {
    const { nom, specialite_domaine, numero_telephone, allow_general_knowledge } = req.body;
    const allowKnowledge = allow_general_knowledge ? 1 : 0;

    const [result] = await pool.execute(
      'INSERT INTO bots (nom, specialite_domaine, numero_telephone, allow_general_knowledge) VALUES (?, ?, ?, ?)',
      [nom, specialite_domaine, numero_telephone, allowKnowledge]
    );

    const [rows] = await pool.execute('SELECT * FROM bots WHERE id = ?', [result.insertId]);

    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Erreur createBot :', error.message);
    res.status(500).json({ success: false, message: 'Erreur lors de la création du bot.' });
  }
}

// Récupérer tous les bots
async function getAllBots(_req, res) {
  try {
    const [rows] = await pool.execute('SELECT * FROM bots ORDER BY date_creation DESC');

    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Erreur getAllBots :', error.message);
    res.status(500).json({ success: false, message: 'Erreur lors de la récupération des bots.' });
  }
}

// Générer le QR Code WhatsApp pour un bot
function generateQrCode(req, res) {
  const { botId } = req.params;

  // Si le bot est déjà connecté, inutile de relancer Puppeteer
  const currentStatus = getClientStatus(botId);
  if (currentStatus === 'ready') {
    return res.status(200).json({
      success: false,
      alreadyConnected: true,
      message: 'Ce bot est déjà connecté à WhatsApp. Aucun QR Code n\'est nécessaire.',
    });
  }

  const TIMEOUT_MS = 60000; // 60s max pour que Puppeteer démarre et génère le QR

  const timer = setTimeout(() => {
    if (!res.headersSent) {
      res.status(504).json({
        success: false,
        message: 'Le bot est peut-être déjà connecté (session WhatsApp active). Rechargez la page et vérifiez son statut.',
      });
    }
  }, TIMEOUT_MS);

  try {
    initializeWhatsApp(botId, (err, qrBase64) => {
      clearTimeout(timer);
      if (res.headersSent) return;
      if (err) {
        return res.status(500).json({ success: false, message: err.message });
      }
      return res.json({ success: true, qrCodeBase64: qrBase64 });
    });
  } catch (error) {
    clearTimeout(timer);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
}

// Modifier un bot existant
async function updateBot(req, res) {
  try {
    const { id } = req.params;
    const { nom, specialite_domaine, numero_telephone, allow_general_knowledge } = req.body;
    const allowKnowledge = allow_general_knowledge ? 1 : 0;

    // La colonne description existe toujours en base mais n'est plus ni saisie
    // ni affichee : le nom et le domaine suffisent a identifier un bot, et
    // aucun des deux champs n'entrait dans le contexte du modele. La requete
    // ne la touche pas, ce qui preserve la valeur des bots deja crees.
    await pool.execute(
      'UPDATE bots SET nom=?, specialite_domaine=?, numero_telephone=?, allow_general_knowledge=? WHERE id=?',
      [nom, specialite_domaine, numero_telephone, allowKnowledge, id]
    );

    const [rows] = await pool.execute('SELECT * FROM bots WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Bot introuvable.' });
    }

    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Erreur updateBot :', error.message);
    res.status(500).json({ success: false, message: 'Erreur lors de la mise à jour du bot.' });
  }
}

module.exports = { createBot, getAllBots, generateQrCode, updateBot };

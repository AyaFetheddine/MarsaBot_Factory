const express = require('express');
const multer = require('multer');
const cors = require('cors');
require('dotenv').config();


const { testConnection } = require('./config/db');
const { initApiSourceTable } = require('./models/apiSourceModel');
const { initSettingsTable } = require('./models/settingModel');
const { initDocumentsTable, initChunksTable } = require('./models/documentModel');
const { initMessagesTable } = require('./models/messageModel');
const whatsappService = require('./services/whatsappService');
const botRoutes = require('./routes/botRoutes');
const adminRoutes = require('./routes/adminRoutes');
const knowledgeRoutes = require('./routes/knowledgeRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const authMiddleware = require('./middlewares/authMiddleware');

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());


// Routes
app.use('/api/admin', adminRoutes);
app.use('/api/bots', authMiddleware, botRoutes);
app.use('/api/knowledge', authMiddleware, knowledgeRoutes);
app.use('/api/settings', authMiddleware, settingsRoutes);

// Route de test
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'OK',
    message: "L'API MarsaBot Factory fonctionne correctement !",
    timestamp: new Date().toISOString(),
  });
});

// Route inconnue : repondre en JSON, pas en HTML
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route introuvable : ' + req.method + ' ' + req.path });
});

// Gestionnaire d erreurs global. Doit rester le DERNIER middleware monte.
// Sans lui, Express repond une page HTML contenant la pile d appels et les
// chemins absolus du serveur, et le message utile n atteint jamais le client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // Erreurs multer : taille depassee, champ inattendu, etc.
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'Fichier trop volumineux. Taille maximale : 20 Mo.'
      : 'Envoi du fichier refuse : ' + err.message;
    return res.status(400).json({ success: false, message });
  }

  // Erreurs applicatives marquees comme imputables au client
  if (err && err.status && err.status < 500) {
    return res.status(err.status).json({ success: false, message: err.message });
  }

  // Tout le reste : journalise cote serveur, generique cote client
  console.error('Erreur non geree :', err);
  return res.status(500).json({ success: false, message: 'Erreur serveur.' });
});

// Démarrage du serveur
const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log('┌──────────────────────────────────────────┐');
  console.log('│                                          │');
  console.log(`│   🚀 MarsaBot Factory API                │`);
  console.log(`│   ✅ Serveur lancé sur le port ${PORT}       │`);
  console.log(`│   📡 http://localhost:${PORT}/api/health    │`);
  console.log('│                                          │');
  console.log('└──────────────────────────────────────────┘');

  await testConnection();
  await initApiSourceTable();
  await initSettingsTable();
  await initDocumentsTable();
  await initChunksTable();
  await initMessagesTable();
  await whatsappService.initializeActiveBots();
});

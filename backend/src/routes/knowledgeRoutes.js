const express = require('express');
const router = express.Router();
const upload = require('../middlewares/upload');
const { uploadFile, getDocuments, deleteFile, viewFile, addApi, getApis, deleteApi } = require('../controllers/knowledgeController');
const authMiddleware = require('../middlewares/authMiddleware');

// POST /api/knowledge/upload
router.post('/upload', upload.single('file'), uploadFile);

// GET /api/knowledge/:botId/documents
router.get('/:botId/documents', getDocuments);

// GET /api/knowledge/:botId/documents/:docId/view
// Le botId est obligatoire dans le chemin : sans lui, le contenu d un document
// etait servi a partir de son seul identifiant, sans lien avec le bot demande.
router.get('/:botId/documents/:docId/view', viewFile);

// DELETE /api/knowledge/:botId/documents/:docId
router.delete('/:botId/documents/:docId', authMiddleware, deleteFile);

// POST /api/knowledge/:botId/api-sources
router.post('/:botId/api-sources', addApi);

// GET /api/knowledge/:botId/api-sources
router.get('/:botId/api-sources', getApis);

// DELETE /api/knowledge/:botId/api-sources/:sourceId
router.delete('/:botId/api-sources/:sourceId', authMiddleware, deleteApi);

module.exports = router;

const express = require('express');
const router = express.Router();
const { login, createDefaultAdmin } = require('../controllers/adminController');
const { creerLimiteurConnexion } = require('../config/securite');

// POST /api/admin/login
// Seule route ou une force brute a un sens : tout le reste de l API exige deja
// un jeton valide. Le limiteur est construit au chargement du module, une seule
// fois, pour que son compteur soit partage entre toutes les requetes.
router.post('/login', creerLimiteurConnexion(), login);
// GET /api/admin/setup
router.get('/setup', createDefaultAdmin);

module.exports = router;

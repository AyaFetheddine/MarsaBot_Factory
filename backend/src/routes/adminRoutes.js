const express = require('express');
const router = express.Router();
const { login, createDefaultAdmin } = require('../controllers/adminController');
const { creerLimiteurConnexion } = require('../config/securite');
const bouclageLocal = require('../middlewares/bouclageLocal');

// POST /api/admin/login
// Seule route ou une force brute a un sens : tout le reste de l API exige deja
// un jeton valide. Le limiteur est construit au chargement du module, une seule
// fois, pour que son compteur soit partage entre toutes les requetes.
router.post('/login', creerLimiteurConnexion(), login);
// GET /api/admin/setup
// Cree le compte initial, une seule fois, sur une base vide. Elle ne peut pas
// exiger de jeton puisqu'aucun compte n'existe encore : l'acces est donc
// restreint a la machine elle-meme. L'exploitant l'appelle depuis le serveur ;
// en conteneur, par docker exec.
router.get('/setup', bouclageLocal, createDefaultAdmin);

module.exports = router;

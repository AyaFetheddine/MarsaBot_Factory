const express = require('express');
const router = express.Router();
const { getSettings, getEtatMoteur, updateSettings } = require('../controllers/settingsController');

// GET /api/settings
router.get('/', getSettings);

// GET /api/settings/moteur — lecture seule : etat du moteur IA et modeles installes
router.get('/moteur', getEtatMoteur);

// PUT /api/settings
router.put('/', updateSettings);

module.exports = router;

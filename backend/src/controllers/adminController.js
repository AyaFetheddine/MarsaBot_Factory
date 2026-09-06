const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');

const ROLE_ADMIN = 'Admin';

/**
 * Connexion directe a la console, hors du portail.
 *
 * Depuis la fusion, l'administrateur entre normalement par MarsaPort AI, qui
 * transmet son jeton a la console encadree. Ce chemin subsiste comme acces de
 * secours, utilisable si le portail est indisponible.
 *
 * L'identifiant est le MATRICULE, celui-la meme qui ouvre le portail : une
 * seule personne, un seul compte, un seul identifiant. Demander une adresse
 * e-mail ici et un matricule la-bas faisait paraitre deux comptes distincts
 * pour un seul utilisateur.
 */
async function login(req, res) {
  try {
    const { matricule, password } = req.body;
    if (!matricule || !password) {
      return res.status(400).json({ success: false, message: 'Matricule et mot de passe requis.' });
    }

    const [rows] = await pool.execute('SELECT * FROM admins WHERE matricule = ?', [matricule]);
    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Identifiants invalides.' });
    }

    const admin = rows[0];
    const valide = await bcrypt.compare(password, admin.password_hash);
    if (!valide) {
      return res.status(401).json({ success: false, message: 'Identifiants invalides.' });
    }

    // Meme forme de charge utile que MarsaTrack AI : id, matricule, role. Le
    // claim role est verifie par le middleware, la signature seule n'ouvrant
    // aucun droit depuis que les deux services partagent leur secret.
    const token = jwt.sign(
      { id: admin.id, matricule: admin.matricule, nom: admin.nom, role: ROLE_ADMIN },
      process.env.JWT_SECRET,
      { expiresIn: '8h' },
    );
    res.json({ success: true, token });
  } catch (error) {
    console.error('Erreur login admin :', error);
    res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
}

// GET /setup
async function createDefaultAdmin(req, res) {
  try {
    const [rows] = await pool.execute('SELECT COUNT(*) as count FROM admins');
    if (rows[0].count > 0) {
      return res.json({ success: false, message: 'Un admin existe déjà.' });
    }
    const matricule = process.env.DEFAULT_ADMIN_MATRICULE || 'admin';
    const password = process.env.DEFAULT_ADMIN_PASSWORD || 'change_me_in_production';
    const nom = 'Administrateur';
    const password_hash = await bcrypt.hash(password, 12);
    await pool.execute(
      'INSERT INTO admins (matricule, password_hash, nom) VALUES (?, ?, ?)',
      [matricule, password_hash, nom],
    );
    res.json({ success: true, message: 'Admin par défaut créé.', matricule });
  } catch (error) {
    console.error('Erreur création admin par défaut :', error);
    res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
}

module.exports = { login, createDefaultAdmin };

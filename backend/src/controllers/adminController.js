const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');

// Seul role emis par MarsaBot. Nomme comme le role equivalent de MarsaTrack AI.
const ROLE_ADMIN = 'Admin';

// POST /login
async function login(req, res) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email et mot de passe requis.' });
    }
    const [rows] = await pool.execute('SELECT * FROM admins WHERE email = ?', [email]);
    if (!rows.length) {
      return res.status(401).json({ success: false, message: 'Identifiants invalides.' });
    }
    const admin = rows[0];
    const valid = await bcrypt.compare(password, admin.password_hash);
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Identifiants invalides.' });
    }
    // Le claim role aligne la forme du jeton sur celle de MarsaTrack AI, ou les
    // roles Admin et Portiqueur existent deja. MarsaBot n a qu un seul type de
    // compte : la valeur est donc constante, et la table admins n a pas de
    // colonne role. Le claim est present des maintenant pour que les deux
    // services parlent la meme langue le jour d une authentification commune ;
    // aucun controle d autorisation ne s appuie sur lui aujourd hui.
    const token = jwt.sign(
      { id: admin.id, email: admin.email, nom: admin.nom, role: ROLE_ADMIN },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
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
    const email = 'admin@marsamaroc.ma';
    const password = process.env.DEFAULT_ADMIN_PASSWORD || 'change_me_in_production';
    const nom = 'Administrateur';
    const password_hash = await bcrypt.hash(password, 10);
    await pool.execute('INSERT INTO admins (email, password_hash, nom) VALUES (?, ?, ?)', [email, password_hash, nom]);
    res.json({ success: true, message: 'Admin par défaut créé.', email, password });
  } catch (error) {
    console.error('Erreur création admin par défaut :', error);
    res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
}

module.exports = { login, createDefaultAdmin };

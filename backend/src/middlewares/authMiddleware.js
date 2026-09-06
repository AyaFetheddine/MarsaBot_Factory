const jwt = require('jsonwebtoken');

// Seul ce role ouvre la console des assistants.
const ROLE_REQUIS = 'Admin';

/**
 * Authentification de la console MarsaBot Factory.
 *
 * Depuis la fusion visuelle, la console est encadree dans le portail
 * MarsaPort AI, qui lui transmet son propre jeton : les deux services signent
 * desormais avec le meme secret. Un jeton emis par MarsaTrack AI est donc
 * accepte ici, ce qui evite a l'utilisateur une seconde authentification pour
 * une application qui n'en presente qu'une.
 *
 * Le partage du secret rend valide la signature de TOUS les jetons MarsaTrack,
 * y compris ceux d'un Portiqueur ou d'un Chef d'equipe, qui n'ont rien a faire
 * dans la gestion des assistants. Le role est donc verifie explicitement : la
 * signature prouve l'identite, elle n'accorde aucun droit a elle seule.
 *
 * Les jetons emis par la console elle-meme portent deja `role: 'Admin'`, la
 * verification est donc la meme pour les deux origines.
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Token manquant.' });
  }
  const token = authHeader.split(' ')[1];
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ success: false, message: 'Token invalide ou expiré.' });
  }

  if (decoded.role !== ROLE_REQUIS) {
    // 403 et non 401 : le jeton est authentique, c'est le droit qui manque.
    // Se reconnecter n'y changerait rien, l'interface ne doit donc pas le
    // proposer.
    return res.status(403).json({
      success: false,
      message: 'Accès réservé aux administrateurs.',
    });
  }

  req.admin = decoded;
  next();
}

module.exports = authMiddleware;

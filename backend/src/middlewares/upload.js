const multer = require('multer');
const path = require('path');

// Formats reellement traites par le controleur d upload : PDF, TXT, CSV.
// Le .xlsx etait accepte ici sans etre extrait ensuite : le document etait
// enregistre vide, jamais vectorise, et n alimentait aucune reponse. Il est
// desormais refuse a l entree, avec un message explicite, plutot que d etre
// accueilli pour ne servir a rien.
//
// application/vnd.ms-excel est conserve : Windows attribue frequemment ce type
// MIME aux fichiers .csv, qui eux sont bien traites. L extension reste
// verifiee cote controleur.
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/vnd.ms-excel',
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, path.join(__dirname, '../../uploads'));
  },
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, `${Date.now()}-${safeName}`);
  },
});

function fileFilter(_req, file, cb) {
  if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
    cb(null, true);
  } else {
    // status = 400 : erreur imputable au client, pas au serveur.
    // Le gestionnaire global d index.js s en sert pour repondre en JSON.
    const erreur = new Error('Type de fichier non autorisé. Formats acceptés : PDF, TXT, CSV.');
    erreur.status = 400;
    cb(erreur);
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 20 * 1024 * 1024 },
});

module.exports = upload;

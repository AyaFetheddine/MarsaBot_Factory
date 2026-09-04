// Durcissement HTTP : origines autorisées, en-têtes de sécurité, limitation
// des tentatives de connexion. Regroupé ici plutôt que dans index.js pour être
// testable sans démarrer le serveur.

const rateLimit = require('express-rate-limit');

// Origines de développement des deux frontends du projet. MarsaTrack occupe
// 5173, MarsaBot 5174. Les variantes 127.0.0.1 sont incluses parce qu'un
// navigateur qui ouvre 127.0.0.1 envoie une origine différente de localhost.
const ORIGINES_DEV = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
];

/**
 * Liste blanche des origines, lue dans CORS_ORIGINS (séparateur virgule).
 * Sans la variable, on retombe sur les origines locales de développement —
 * jamais sur « tout autoriser » : une variable oubliée en production doit
 * fermer la porte, pas l'ouvrir en grand.
 */
function originesAutorisees() {
  const brut = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return brut.length > 0 ? brut : ORIGINES_DEV;
}

/**
 * Options passées à cors(). L'origine est évaluée à chaque requête, et non
 * figée au démarrage, pour que les tests puissent changer CORS_ORIGINS.
 *
 * Une requête sans en-tête Origin est acceptée : ce sont les appels qui ne
 * viennent pas d'une page web (curl, healthcheck Docker, appel serveur à
 * serveur). CORS ne protège que le navigateur ; refuser ces requêtes casserait
 * la supervision sans rien sécuriser, l'authentification restant seule
 * responsable de l'accès.
 */
const optionsCors = {
  origin(origine, callback) {
    if (!origine) return callback(null, true);
    if (originesAutorisees().includes(origine)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true,
};

/**
 * Options passées à helmet().
 *
 * crossOriginResourcePolicy est ouvert : le frontend est servi depuis une autre
 * origine que l'API (5174 contre 3000, ou 80 contre 3000 en conteneur). La
 * valeur par défaut same-origin ferait bloquer par le navigateur les réponses
 * de l'API, y compris le téléchargement d'un document. L'accès reste contrôlé
 * par la liste blanche CORS et par le jeton.
 */
const optionsHelmet = {
  crossOriginResourcePolicy: { policy: 'cross-origin' },
};

const nombreEntier = (valeur, defaut) => {
  const n = Number.parseInt(valeur, 10);
  return Number.isFinite(n) && n >= 0 ? n : defaut;
};

/**
 * Limiteur appliqué à la seule route de connexion. Le formulaire de connexion
 * est le seul point où une force brute a un sens : le reste de l'API exige
 * déjà un jeton valide.
 *
 * Défauts volontairement larges — 20 tentatives par quart d'heure et par
 * adresse — pour ne pas gêner le développement ni une démonstration où le mot
 * de passe est saisi plusieurs fois. LOGIN_RATE_LIMIT_MAX=0 désactive
 * complètement la limitation.
 */
function creerLimiteurConnexion() {
  const fenetreMinutes = nombreEntier(process.env.LOGIN_RATE_LIMIT_WINDOW_MINUTES, 15);
  const maximum = nombreEntier(process.env.LOGIN_RATE_LIMIT_MAX, 20);

  if (maximum === 0) {
    return (_req, _res, next) => next();
  }

  return rateLimit({
    windowMs: fenetreMinutes * 60 * 1000,
    limit: maximum,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Même forme de réponse que le reste de l'API, pour que le frontend
    // affiche le message au lieu d'un corps inattendu.
    handler: (_req, res) =>
      res.status(429).json({
        success: false,
        message: `Trop de tentatives de connexion. Réessayez dans ${fenetreMinutes} minutes.`,
      }),
  });
}

module.exports = { ORIGINES_DEV, originesAutorisees, optionsCors, optionsHelmet, creerLimiteurConnexion };

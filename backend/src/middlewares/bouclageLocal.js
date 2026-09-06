'use strict';

/**
 * N'autorise que les appels venus de la machine elle-meme.
 *
 * Reserve aux routes d'administration qui doivent rester publiques par nature :
 * la creation du compte initial, appelee une seule fois par l'exploitant depuis
 * le serveur, ne peut pas exiger un jeton puisqu'aucun compte n'existe encore.
 *
 * Sans ce garde, la fenetre est etroite mais reelle : entre le demarrage d'une
 * installation neuve et la creation du compte, n'importe qui atteignant le port
 * pouvait creer l'administrateur a la place de l'exploitant.
 *
 * L'adresse est lue sur le SOCKET, jamais dans un en-tete. `req.ip` suivrait
 * `X-Forwarded-For` si `trust proxy` etait active un jour, et cet en-tete est
 * fourni par l'appelant : un attaquant distant se declarerait local.
 */

// Formes sous lesquelles Node presente la boucle locale, IPv4 et IPv6.
const ADRESSES_LOCALES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function estAdresseLocale(adresse) {
  if (typeof adresse !== 'string' || adresse.length === 0) return false;
  return ADRESSES_LOCALES.has(adresse);
}

function bouclageLocal(req, res, next) {
  const adresse = req.socket ? req.socket.remoteAddress : undefined;
  if (estAdresseLocale(adresse)) return next();

  // 404 et non 403 : un appelant distant n'a pas a apprendre que cette route
  // existe. L'exploitant, lui, la trouve dans la documentation.
  return res.status(404).json({ success: false, message: 'Ressource introuvable.' });
}

module.exports = bouclageLocal;
module.exports.estAdresseLocale = estAdresseLocale;

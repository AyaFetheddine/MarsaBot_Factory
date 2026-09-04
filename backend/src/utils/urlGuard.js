'use strict';

const dns = require('dns').promises;
const net = require('net');

/**
 * Validation des URL de sources API.
 *
 * Ces URL sont fournies par un administrateur puis appelées par le serveur à
 * chaque message entrant, et leur réponse est injectée dans le prompt donc
 * renvoyée à l'utilisateur WhatsApp. Sans contrôle, une URL pointant vers le
 * réseau interne, la boucle locale ou un service de métadonnées cloud
 * transforme le bot en canal d'exfiltration (SSRF).
 *
 * Politique : seuls http et https sont acceptés, et toute adresse privée,
 * loopback ou lien-local est refusée — sauf si l'hôte figure explicitement
 * dans la variable d'environnement ALLOWED_INTERNAL_HOSTS.
 *
 * Exemple :  ALLOWED_INTERNAL_HOSTS=localhost:3001,127.0.0.1:3001
 * (nécessaire pour interroger MarsaTrack AI depuis un bot)
 */

/** Erreur imputable au client : le gestionnaire global d'index.js la rend en JSON. */
function erreurClient(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

/** Hôtes internes explicitement autorisés, lus à chaque appel. */
function hotesAutorises() {
  return (process.env.ALLOWED_INTERNAL_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Une adresse IP appartient-elle à une plage privée, locale ou réservée ?
 * Un format non reconnu est refusé par défaut.
 * @param {string} ip
 * @returns {boolean}
 */
function estAdressePrivee(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0) return true;                       // 0.0.0.0/8
    if (a === 10) return true;                      // privé
    if (a === 127) return true;                     // boucle locale
    if (a === 169 && b === 254) return true;        // lien-local et métadonnées cloud
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true;                      // multicast et réservé
    return false;
  }

  if (net.isIPv6(ip)) {
    const s = ip.toLowerCase();
    if (s === '::1' || s === '::') return true;     // boucle locale
    if (s.startsWith('fc') || s.startsWith('fd')) return true;  // adresses uniques locales
    if (s.startsWith('fe80')) return true;          // lien-local
    const mappee = s.match(/^::ffff:([0-9.]+)$/);   // IPv4 encapsulée en IPv6
    if (mappee) return estAdressePrivee(mappee[1]);
    return false;
  }

  return true;
}

/**
 * Vérifie qu'une URL peut être appelée par le serveur sans risque.
 * @param {string} urlBrute
 * @returns {Promise<URL>}  l'URL analysée si elle est acceptable
 * @throws {Error} avec status = 400 et un message explicite sinon
 */
async function verifierUrlSource(urlBrute) {
  let url;
  try {
    url = new URL(String(urlBrute).trim());
  } catch {
    throw erreurClient("URL invalide. Attendu : une adresse http ou https complète.");
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw erreurClient(`Protocole non autorisé : ${url.protocol.replace(':', '')}. Seuls http et https sont acceptés.`);
  }

  // url.hostname conserve les crochets d'une adresse IPv6 litterale
  // ("[::1]"), que net.isIP ne reconnait pas : on les retire.
  const hoteBrut = url.hostname.toLowerCase();
  const hote = hoteBrut.startsWith('[') && hoteBrut.endsWith(']')
    ? hoteBrut.slice(1, -1)
    : hoteBrut;
  const hotePort = url.port ? `${hote}:${url.port}` : hote;

  // Exception explicite déclarée par l'administrateur
  const autorises = hotesAutorises();
  if (autorises.includes(hotePort) || autorises.includes(hote)) {
    return url;
  }

  // Adresse IP écrite en clair dans l'URL
  if (net.isIP(hote)) {
    if (estAdressePrivee(hote)) {
      throw erreurClient(
        `Adresse interne refusée : ${hote}. Pour l'autoriser, ajoutez-la à ALLOWED_INTERNAL_HOSTS.`
      );
    }
    return url;
  }

  // Nom de domaine : on résout, car un nom public peut pointer vers une
  // adresse interne. Toutes les adresses retournées doivent être publiques.
  let adresses;
  try {
    adresses = await dns.lookup(hote, { all: true });
  } catch {
    throw erreurClient(`Hôte introuvable : ${hote}`);
  }

  for (const { address } of adresses) {
    if (estAdressePrivee(address)) {
      throw erreurClient(
        `L'hôte ${hote} pointe vers une adresse interne (${address}). ` +
        `Pour l'autoriser, ajoutez-le à ALLOWED_INTERNAL_HOSTS.`
      );
    }
  }

  return url;
}

/**
 * Verification SYNCHRONE, utilisee lors des redirections : follow-redirects
 * n accepte pas de rappel asynchrone. Couvre le protocole, la liste
 * d exceptions et les adresses IP litterales. La resolution DNS n est pas
 * possible ici : une redirection vers un nom de domaine qui pointerait vers
 * une adresse interne resterait donc acceptee. Limite assumee et documentee.
 * @param {string} protocole  ex. "https:"
 * @param {string} hote
 * @param {string|number} [port]
 */
function verifierRedirection(protocole, hote, port) {
  if (protocole !== "http:" && protocole !== "https:") {
    throw erreurClient(`Redirection refusee vers le protocole ${protocole}`);
  }
  const h = String(hote || "").toLowerCase();
  const hp = port ? `${h}:${port}` : h;
  const autorises = hotesAutorises();
  if (autorises.includes(hp) || autorises.includes(h)) return;
  if (net.isIP(h) && estAdressePrivee(h)) {
    throw erreurClient(`Redirection refusee vers une adresse interne : ${h}`);
  }
}

module.exports = { verifierUrlSource, verifierRedirection, estAdressePrivee, erreurClient };

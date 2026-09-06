'use strict';

const axios = require('axios');

/**
 * Interrogation du moteur Ollama pour la page Parametres.
 *
 * L'administrateur n'est pas developpeur : il ne doit ni connaitre ni saisir le
 * nom exact d'un modele. Ollama publie deja la liste de ce qui est installe sur
 * la machine, il suffit de la lui presenter. Le navigateur ne peut pas appeler
 * Ollama directement — le moteur tourne sur le serveur, pas sur le poste de
 * l'administrateur — donc l'appel est relaye ici.
 */

const DELAI_MS = 4000;

/**
 * Modeles d'embedding, a exclure de la liste proposee.
 *
 * nomic-embed-text sert au calcul des vecteurs dans vectorService et ne sait
 * pas tenir une conversation : le choisir comme modele de reponse rendrait tous
 * les bots muets, sans message d'erreur visible avant le prochain message
 * WhatsApp. Un choix qui casse l'application n'est pas un choix a proposer.
 */
const MODELES_EMBEDDING = /(embed|embedding)/i;

/**
 * Ne garde que les modeles capables de repondre, tries par nom.
 * Fonction pure : testable sans reseau.
 * @param {Array} modelesBruts  le tableau `models` renvoye par /api/tags
 * @returns {Array<{nom: string, taille_go: number|null, parametres: string|null}>}
 */
function filtrerModelesConversationnels(modelesBruts) {
  if (!Array.isArray(modelesBruts)) return [];
  return modelesBruts
    .filter((m) => m && typeof m.name === 'string' && m.name.trim())
    .filter((m) => !MODELES_EMBEDDING.test(m.name))
    .map((m) => ({
      nom: m.name,
      taille_go: typeof m.size === 'number' ? Math.round((m.size / 1e9) * 100) / 100 : null,
      parametres: (m.details && m.details.parameter_size) || null,
    }))
    .sort((a, b) => a.nom.localeCompare(b.nom));
}

/**
 * Verifie qu'une URL de moteur est utilisable par le serveur.
 * Seuls http et https sont acceptes. Contrairement aux sources API externes
 * (voir utils/urlGuard), la boucle locale est ici legitime : Ollama tourne le
 * plus souvent sur la meme machine que le backend.
 * @param {string} urlBrute
 * @returns {{valide: boolean, message?: string, url?: string}}
 */
function verifierUrlMoteur(urlBrute) {
  const texte = String(urlBrute || '').trim();
  if (!texte) {
    return { valide: false, message: "L'adresse du moteur IA est obligatoire." };
  }
  // « localhost:11434 » est la faute de frappe la plus probable, et new URL()
  // l'accepte en lisant « localhost: » comme un protocole. Plutot que de
  // renvoyer un message incomprehensible, on complete le schema manquant :
  // l'administrateur ecrit l'adresse comme il la dirait.
  const complete = /^[a-z][a-z0-9+.-]*:\/\//i.test(texte) ? texte : `http://${texte}`;

  let url;
  try {
    url = new URL(complete);
  } catch {
    return { valide: false, message: `Adresse invalide : « ${texte} ». Exemple attendu : http://localhost:11434` };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { valide: false, message: `Protocole non supporte : « ${url.protocol} ». Utilisez http:// ou https://` };
  }
  // Normalisation : pas de barre oblique finale, les appels ajoutent /api/...
  return { valide: true, url: complete.replace(/\/+$/, '') };
}

/**
 * Demande au moteur la liste de ses modeles. Ne leve jamais : un moteur eteint
 * est un etat normal a afficher, pas une erreur a propager.
 * @param {string} urlBase
 * @returns {Promise<{joignable: boolean, modeles: Array, erreur: string|null}>}
 */
async function interrogerMoteur(urlBase) {
  const controle = verifierUrlMoteur(urlBase);
  if (!controle.valide) {
    return { joignable: false, modeles: [], erreur: controle.message };
  }
  try {
    const reponse = await axios.get(`${controle.url}/api/tags`, { timeout: DELAI_MS });
    return {
      joignable: true,
      modeles: filtrerModelesConversationnels(reponse.data && reponse.data.models),
      erreur: null,
    };
  } catch (err) {
    const cause = err.code === 'ECONNREFUSED'
      ? "Aucun service ne repond a cette adresse. Verifiez qu'Ollama est demarre."
      : err.code === 'ECONNABORTED'
        ? `Le moteur n'a pas repondu en moins de ${DELAI_MS / 1000} secondes.`
        : err.message;
    return { joignable: false, modeles: [], erreur: cause };
  }
}

/**
 * Resout un nom de modele vers celui qu'annonce reellement le moteur.
 *
 * Ollama accepte « llama3.2 » mais publie « llama3.2:latest » dans /api/tags.
 * Sans cette equivalence, la valeur par defaut du projet — « llama3.2 », ecrite
 * dans settingModel et dans agentService — serait declaree absente du moteur
 * sur une installation neuve.
 *
 * @param {string} nom              nom saisi ou enregistre
 * @param {string[]} nomsDisponibles  noms publies par le moteur
 * @returns {string|null} le nom canonique, ou null si le modele est absent
 */
function resoudreNomModele(nom, nomsDisponibles) {
  const cherche = String(nom || '').trim();
  if (!cherche || !Array.isArray(nomsDisponibles)) return null;
  if (nomsDisponibles.includes(cherche)) return cherche;
  if (!cherche.includes(':')) {
    const avecTag = `${cherche}:latest`;
    if (nomsDisponibles.includes(avecTag)) return avecTag;
  }
  return null;
}

module.exports = {
  filtrerModelesConversationnels,
  verifierUrlMoteur,
  interrogerMoteur,
  resoudreNomModele,
  DELAI_MS,
};

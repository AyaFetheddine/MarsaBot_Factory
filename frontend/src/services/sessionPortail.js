/**
 * Session partagee avec le portail MarsaPort AI.
 *
 * La console est encadree dans le portail, mais sur une autre origine : leurs
 * localStorage sont cloisonnes par le navigateur, le jeton ne peut donc pas
 * simplement etre lu. Le portail nous l'envoie par postMessage, apres que nous
 * ayons signale etre pretes a le recevoir.
 *
 * L'echange est volontairement dissymetrique : la console demande, le portail
 * decide. Elle ne peut ni forcer une connexion, ni obtenir un jeton d'un autre
 * onglet, chaque message etant restreint a une origine ecrite en dur.
 *
 * Ouverte seule, hors du portail, la console retrouve exactement son
 * comportement d'avant : son propre formulaire de connexion.
 */

// Le portail conserve son adresse propre, comme l'API du backend ailleurs.
const ORIGINE_PORTAIL = 'http://localhost:5173';

const MSG_PRET = 'marsaport:console-prete';
const MSG_SESSION = 'marsaport:session';
const MSG_EXPIREE = 'marsaport:session-expiree';

/**
 * La console est-elle affichee a l'interieur du portail ?
 * @returns {boolean}
 */
export function estEncadree() {
  try {
    return window.self !== window.top;
  } catch {
    // Acces refuse a la fenetre parente : c'est bien qu'il y en a une.
    return true;
  }
}

/**
 * Ecoute le jeton envoye par le portail et l'enregistre.
 *
 * @param {(jeton: string) => void} auJeton  appele apres l'enregistrement
 * @returns {() => void} fonction de desabonnement
 */
export function ecouterPortail(auJeton) {
  if (!estEncadree()) return () => {};

  const surMessage = (event) => {
    // Une page encadree recoit les messages de n'importe qui : l'origine est
    // la seule garantie que le jeton vient bien du portail.
    if (event.origin !== ORIGINE_PORTAIL) return;
    const data = event.data;
    if (!data || data.type !== MSG_SESSION || typeof data.token !== 'string') return;
    if (!data.token) return;

    localStorage.setItem('token', data.token);
    auJeton(data.token);
  };

  window.addEventListener('message', surMessage);
  // Le portail peut avoir fini de charger avant nous : c'est a la console de
  // se signaler, pas au portail de deviner quand elle est prete.
  window.parent.postMessage({ type: MSG_PRET }, ORIGINE_PORTAIL);

  return () => window.removeEventListener('message', surMessage);
}

/**
 * Signale que la session n'est plus valable.
 *
 * Encadree, la console ne montre jamais son propre formulaire de connexion :
 * l'utilisateur voit une application unique, c'est donc au portail de le
 * deconnecter et de presenter SON ecran d'authentification. Ouverte seule, la
 * console retombe sur son comportement habituel.
 */
export function signalerSessionExpiree() {
  localStorage.removeItem('token');
  if (estEncadree()) {
    window.parent.postMessage({ type: MSG_EXPIREE }, ORIGINE_PORTAIL);
    return;
  }
  window.location.assign('/login');
}

export const MESSAGES = { MSG_PRET, MSG_SESSION, MSG_EXPIREE, ORIGINE_PORTAIL };

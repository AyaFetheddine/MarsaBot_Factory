'use strict';

/**
 * Utilitaires pour les sources API externes :
 *  - masquage des jetons dans les URL (journaux et contexte du modele)
 *  - mise en forme lisible de l'etat operationnel MarsaTrack AI
 *
 * Les deux fonctions sont pures et testables sans reseau ni base.
 */

// Noms de parametres consideres comme sensibles dans une URL.
const PARAMS_SENSIBLES = /^(token|access_token|api_?key|key|secret|password|pwd)$/i;

/**
 * Remplace la valeur de tout parametre sensible d'une URL par des etoiles.
 * Utilise avant chaque journalisation et avant injection dans le prompt :
 * une URL de source peut porter un jeton d'authentification, qui n'a rien a
 * faire ni dans les logs ni dans le contexte envoye au modele.
 * @param {string} urlBrute
 * @returns {string} l'URL avec les valeurs sensibles masquees
 */
function masquerSecretsUrl(urlBrute) {
  try {
    const url = new URL(String(urlBrute));
    let modifiee = false;
    for (const nom of [...url.searchParams.keys()]) {
      if (PARAMS_SENSIBLES.test(nom)) {
        url.searchParams.set(nom, '***');
        modifiee = true;
      }
    }
    return modifiee ? url.toString() : String(urlBrute);
  } catch (_) {
    // URL non analysable : on ne prend aucun risque, on ne renvoie que l'origine
    return String(urlBrute).split('?')[0];
  }
}

/** Formate une date ISO en quelque chose de court et lisible. */
function dateCourte(iso) {
  if (!iso) return 'inconnue';
  return String(iso).replace('T', ' ').replace(/\.\d+Z$/, '').replace('Z', '');
}

/**
 * Detecte la reponse de l'endpoint d'integration MarsaTrack AI et la convertit
 * en texte oriente lignes.
 *
 * Le JSON brut (objet racine, tableaux imbriques de personnels et d'arrets) est
 * mal exploite par un modele de 7 milliards de parametres : la meme difficulte
 * que celle mesuree sur les donnees tabulaires du RAG. Une ligne par fait, avec
 * les noms et les motifs en clair, rend les questions du terrain answerables.
 *
 * @param {any} donnees  corps de la reponse, deja analyse en objet
 * @returns {string|null} le texte formate, ou null si ce n'est pas cette source
 */
function formaterEtatOperationnel(donnees) {
  if (!donnees || typeof donnees !== 'object') return null;
  if (!Array.isArray(donnees.operations)) return null;
  if (donnees.source !== 'MarsaTrack AI') return null;

  const lignes = [];
  const r = donnees.resume || {};

  lignes.push(
    `Etat operationnel MarsaTrack AI au ${dateCourte(donnees.genere_le)} — ` +
    `${donnees.shift_en_cours || 'shift inconnu'}, ${donnees.vacation_en_cours || 'vacation inconnue'}.`
  );
  lignes.push(
    `Resume : ${r.nombre_operations ?? donnees.operations.length} operation(s) en cours, ` +
    `${r.nombre_personnels_affectes ?? '?'} personne(s) affectee(s), ` +
    `${r.nombre_arrets_actifs ?? '?'} arret(s) de travail actif(s).`
  );

  for (const op of donnees.operations) {
    lignes.push('');
    lignes.push(`Operation : ${op.nom_operation}`);
    lignes.push(
      `  Navire ${op.navire} | escale ${op.numero_escale} | poste ${op.poste_quai} | ` +
      `${op.type_operation} | statut ${op.statut} | date ${op.date_operation} | ${op.shift}, ${op.vacation}`
    );

    const personnels = Array.isArray(op.personnels_affectes) ? op.personnels_affectes : [];
    if (personnels.length === 0) {
      lignes.push('  Personnels affectes : aucun');
    } else {
      lignes.push(
        `  Personnels affectes (${personnels.length}) : ` +
        personnels.map((p) => `${p.nom_complet} (${p.fonction})`).join(', ')
      );
    }

    const arrets = Array.isArray(op.arrets_de_travail_actifs) ? op.arrets_de_travail_actifs : [];
    if (arrets.length === 0) {
      lignes.push('  Arrets de travail actifs : aucun');
    } else {
      for (const a of arrets) {
        const duree = a.duree_minutes === null || a.duree_minutes === undefined
          ? 'duree en cours'
          : `${a.duree_minutes} min`;
        lignes.push(
          `  Arret actif : ${a.code_arret} ${a.libelle_arret} — motif : ${a.motif} — ` +
          `debut ${dateCourte(a.debut)}, ${duree}`
        );
      }
    }
  }

  if (donnees.limites && donnees.limites.operations_tronquees) {
    lignes.push('');
    lignes.push('Attention : la liste des operations a ete tronquee par la source.');
  }

  return lignes.join('\n');
}

module.exports = { masquerSecretsUrl, formaterEtatOperationnel };

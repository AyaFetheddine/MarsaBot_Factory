'use strict';

const axios = require('axios');

const { formaterEtatOperationnel } = require('../utils/apiSourceFormat');

/**
 * Source integree : l'etat operationnel de MarsaTrack AI.
 *
 * MarsaBot Factory existe pour rendre les donnees d'exploitation accessibles
 * par messagerie. Cette source n'est donc pas une source parmi d'autres : elle
 * est branchee sur TOUS les bots, automatiquement.
 *
 * Consequence voulue : l'administrateur ne saisit ni URL ni jeton. Il cree un
 * bot, y depose ses documents, et le bot repond deja sur les operations en
 * cours. Demander une adresse d'API a chaque creation serait une charge
 * inutile, et une source d'oubli.
 *
 * Le jeton vit uniquement ici, lu depuis l'environnement du serveur. Il n'est
 * jamais stocke en base, jamais affiche dans l'interface, jamais transmis dans
 * une URL : il part dans l'en-tete Authorization, qui n'apparait nulle part.
 */

const CHEMIN = '/api/integration/etat-operationnel';

// Le premier appel peut attendre la base de MarsaTrack ; au-dela, mieux vaut
// repondre sans ce contexte que faire patienter la personne sur WhatsApp.
const DELAI_MS = 5000;

/** L'integration est-elle configuree ? Sans cela, le bot fonctionne comme avant. */
function integrationActive() {
  return Boolean(
    (process.env.MARSATRACK_BASE_URL || '').trim() &&
      (process.env.MARSATRACK_INTEGRATION_TOKEN || '').trim(),
  );
}

/** Adresse complete du point d'integration, sans aucun secret. */
function urlIntegration() {
  const base = (process.env.MARSATRACK_BASE_URL || '').trim().replace(/\/+$/, '');
  return `${base}${CHEMIN}`;
}

/**
 * Recupere l'etat operationnel et le met en forme pour le modele.
 *
 * Ne leve jamais : une indisponibilite de MarsaTrack ne doit pas empecher un
 * bot de repondre a partir de ses propres documents. L'appelant recoit alors
 * null et poursuit normalement.
 *
 * @returns {Promise<string|null>} le contexte en lignes lisibles, ou null
 */
async function recupererEtatOperationnel() {
  if (!integrationActive()) return null;

  const url = urlIntegration();

  try {
    const reponse = await axios.get(url, {
      timeout: DELAI_MS,
      responseType: 'json',
      // Le jeton passe par l'en-tete, jamais par l'URL : il n'apparait ainsi
      // ni dans les journaux, ni dans une eventuelle redirection.
      headers: {
        Authorization: `Bearer ${process.env.MARSATRACK_INTEGRATION_TOKEN.trim()}`,
      },
      // Aucune redirection attendue d'un service interne : la suivre
      // n'apporterait rien et exposerait l'en-tete a un autre hote.
      maxRedirects: 0,
    });

    const enLignes = formaterEtatOperationnel(reponse.data);
    if (enLignes) return enLignes;

    // Mise en forme impossible : on transmet le brut plutot que rien.
    return typeof reponse.data === 'string'
      ? reponse.data
      : JSON.stringify(reponse.data);
  } catch (erreur) {
    const statut = erreur.response ? ` (HTTP ${erreur.response.status})` : '';
    console.warn(`⚠️  Etat operationnel MarsaTrack indisponible${statut} :`, erreur.message);
    return null;
  }
}

module.exports = { recupererEtatOperationnel, integrationActive, urlIntegration };

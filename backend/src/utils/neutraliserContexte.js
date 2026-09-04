'use strict';

const crypto = require('crypto');

// Séparation entre les instructions du bot et les données qu'il consulte.
//
// Le contenu des documents, des réponses d'API, des résultats web et de
// l'historique de conversation n'est pas écrit par nous : il vient de fichiers
// déposés par un administrateur, de services tiers et de messages
// d'utilisateurs. Injecté tel quel dans le prompt, il peut se faire passer pour
// une instruction. Ce module lui retire ce pouvoir sans le rendre illisible.
//
// Le principe est de ne toucher qu'à ce qui a une valeur STRUCTURELLE — un
// marqueur de rôle en début de ligne, une balise de contrôle du modèle, une
// tentative de fermeture du délimiteur — et jamais à la prose. Un document qui
// parle de « règle », de « système » ou d'« instruction » dans une phrase doit
// ressortir intact : le mutiler casserait la recherche documentaire, qui est
// précisément ce que le bot doit savoir faire.

const PLAFOND_PAR_SOURCE_PAR_DEFAUT = 8000;

// Marqueurs de rôle, reconnus uniquement en DÉBUT DE LIGNE et suivis de deux
// points. La liste est fermée volontairement : un motif générique du type
// « un mot puis deux points » détruirait les documents CSV, dont chaque ligne
// commence par « ID_Equipement: ... ».
const MARQUEURS_DE_ROLE = [
  'system', 'système', 'systeme',
  'assistant', 'user', 'utilisateur', 'human', 'humain',
  'ai', 'bot', 'marsabot',
];

const MOTIF_ROLE = new RegExp(`^[ \\t]*(?:${MARQUEURS_DE_ROLE.join('|')})[ \\t]*:`, 'i');

// Anciens délimiteurs de contexte, en clair dans l'historique du dépôt : un
// document peut les reproduire pour tenter de fermer une zone.
const MOTIF_ANCIEN_DELIMITEUR = /^[ \t]*-{2,}[ \t]*(DEBUT|DÉBUT|FIN)\b.*-{2,}[ \t]*$/i;

/**
 * Retire les caractères de contrôle (hors tabulation et saut de ligne) et les
 * caractères de direction, qui permettent d'afficher à l'écran un texte
 * différent de celui qui est réellement lu par le modèle.
 *
 * Écrit comme un filtre par point de code plutôt que comme une classe de
 * caractères : une classe contenant des caractères de contrôle est illisible
 * dans le fichier, et déclencherait une règle de lint qu'il faudrait désactiver.
 */
function retirerCaracteresInvisibles(texte) {
  let sortie = '';
  for (const caractere of texte) {
    const code = caractere.codePointAt(0);
    const estControle =
      code <= 0x08 || code === 0x0b || code === 0x0c ||
      (code >= 0x0e && code <= 0x1f) || code === 0x7f;
    const estDirectionnel =
      (code >= 0x200b && code <= 0x200f) ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069) ||
      code === 0xfeff;
    if (!estControle && !estDirectionnel) sortie += caractere;
  }
  return sortie;
}

/** Préfixe apposé à une ligne dont la forme imitait une instruction. */
const PREFIXE_NEUTRALISE = '[donnee] ';

/**
 * Tire un identifiant de délimiteur, différent à chaque appel.
 *
 * C'est le cœur de la protection : les anciens délimiteurs étaient des chaînes
 * fixes, lisibles dans le dépôt, donc reproductibles par un document. Un
 * identifiant tiré au hasard à l'exécution ne peut pas être deviné par un
 * contenu écrit à l'avance.
 */
function genererIdentifiantBalise() {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * Retire à un texte son pouvoir d'instruction, sans en retirer le sens.
 *
 * @param {string} texte
 * @returns {string}
 */
function neutraliser(texte) {
  if (typeof texte !== 'string' || texte === '') return '';

  let sortie = retirerCaracteresInvisibles(texte);

  // Tentative de fermeture du délimiteur. Casser la séquence « <DONNEES »
  // suffit : sans elle, l'identifiant seul ne délimite rien. On ne masque
  // volontairement PAS les occurrences nues de l'identifiant, car un document
  // légitime qui contiendrait cette suite de caractères s'en trouverait mutilé —
  // exactement le travers que ce module doit éviter.
  sortie = sortie.replace(/<\s*\/?\s*DONNEES/gi, (trouve) => trouve.replace('<', '(') + ')');

  // Balises de contrôle des modèles de langage. Elles n'ont aucun sens dans un
  // document légitime : la séquence est cassée, le texte reste lisible.
  sortie = sortie.replace(/<\|/g, '< |').replace(/\|>/g, '| >');
  sortie = sortie.replace(/\[\/?INST\]/gi, (trouve) => trouve.replace('[', '(').replace(']', ')'));

  // Marqueurs de rôle et anciens délimiteurs : la ligne est conservée telle
  // quelle, seulement préfixée, pour qu'aucune information ne soit perdue.
  sortie = sortie
    .split('\n')
    .map((ligne) =>
      MOTIF_ROLE.test(ligne) || MOTIF_ANCIEN_DELIMITEUR.test(ligne)
        ? PREFIXE_NEUTRALISE + ligne
        : ligne
    )
    .join('\n');

  return sortie;
}

/**
 * Tronque une source trop longue, en le disant explicitement plutôt qu'en
 * coupant en silence : le modèle doit pouvoir signaler qu'il n'a pas tout vu.
 */
function tronquer(texte, plafond) {
  if (texte.length <= plafond) return texte;
  return texte.slice(0, plafond) + `\n[...] source tronquee a ${plafond} caracteres.`;
}

/**
 * Assemble les sources non fiables en un bloc unique, délimité par une balise
 * imprévisible. Chaque source est neutralisée puis tronquée.
 *
 * L'historique de conversation passe par le même traitement que les documents :
 * il est écrit par des utilisateurs, donc tout aussi peu fiable.
 *
 * @param {{titre: string, contenu: string}[]} sources
 * @param {{identifiantBalise?: string, plafondParSource?: number}} options
 * @returns {{bloc: string, identifiantBalise: string, sourcesRetenues: number}}
 */
function construireBlocDonnees(sources, options = {}) {
  const identifiantBalise = options.identifiantBalise || genererIdentifiantBalise();
  const plafondParSource = Number.isInteger(options.plafondParSource) && options.plafondParSource > 0
    ? options.plafondParSource
    : plafondConfigure();

  const sections = (sources || [])
    .filter((s) => s && typeof s.contenu === 'string' && s.contenu.trim() !== '')
    .map((s) => {
      const propre = tronquer(neutraliser(s.contenu), plafondParSource);
      return `[${s.titre}]\n${propre}`;
    });

  const corps = sections.length > 0 ? sections.join('\n\n') : '(aucune donnee disponible)';

  return {
    bloc: `<DONNEES ${identifiantBalise}>\n${corps}\n</DONNEES ${identifiantBalise}>`,
    identifiantBalise,
    sourcesRetenues: sections.length,
  };
}

/** Plafond par source, réglable par variable d'environnement. */
function plafondConfigure() {
  const n = Number.parseInt(process.env.CONTEXTE_MAX_CARACTERES_PAR_SOURCE, 10);
  return Number.isFinite(n) && n > 0 ? n : PLAFOND_PAR_SOURCE_PAR_DEFAUT;
}

module.exports = {
  PLAFOND_PAR_SOURCE_PAR_DEFAUT,
  PREFIXE_NEUTRALISE,
  genererIdentifiantBalise,
  neutraliser,
  tronquer,
  construireBlocDonnees,
  plafondConfigure,
};

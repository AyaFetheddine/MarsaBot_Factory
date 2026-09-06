const { getAllSettings, updateSetting } = require('../models/settingModel');
const { interrogerMoteur, verifierUrlMoteur, resoudreNomModele } = require('../services/ollamaService');

// Seules ces cles peuvent etre ecrites depuis l'interface.
const CLES_AUTORISEES = new Set(['ollama_url', 'ollama_default_model']);

async function getSettings(req, res) {
  try {
    const rows = await getAllSettings();
    // Transforme le tableau [{setting_key, setting_value}] en objet plat
    const settings = {};
    rows.forEach(({ setting_key, setting_value }) => {
      settings[setting_key] = setting_value;
    });
    return res.json({ success: true, data: settings });
  } catch (error) {
    console.error('Erreur getSettings :', error.message);
    return res.status(500).json({ success: false, message: 'Erreur lors de la récupération des paramètres.' });
  }
}

/**
 * Etat du moteur IA : joignable ou non, et modeles reellement installes.
 *
 * Lecture seule. Sert a peupler la liste deroulante de la page Parametres et a
 * afficher un indicateur de connexion, pour que l'administrateur n'ait jamais a
 * saisir un nom de modele de memoire.
 *
 * L'adresse interrogee est celle passee en `?url=` (bouton « Tester ») ou, a
 * defaut, celle enregistree en base.
 */
async function getEtatMoteur(req, res) {
  try {
    let url = typeof req.query.url === 'string' && req.query.url.trim() ? req.query.url.trim() : null;
    if (!url) {
      const rows = await getAllSettings();
      const trouve = rows.find((r) => r.setting_key === 'ollama_url');
      url = (trouve && trouve.setting_value) || 'http://localhost:11434';
    }
    const etat = await interrogerMoteur(url);
    return res.json({ success: true, data: { url, ...etat } });
  } catch (error) {
    console.error('Erreur getEtatMoteur :', error.message);
    return res.status(500).json({ success: false, message: "Erreur lors de la vérification du moteur IA." });
  }
}

/**
 * Enregistre la configuration du moteur, apres verification qu'elle fonctionne.
 *
 * Auparavant n'importe quelle valeur etait acceptee : une adresse vide ou un
 * nom de modele mal orthographie etaient enregistres, l'interface affichait
 * « Parametres sauvegardes », et la panne n'apparaissait qu'au message WhatsApp
 * suivant. La configuration est desormais eprouvee contre le moteur avant
 * d'etre ecrite : ce qui est enregistre est ce qui marche.
 */
async function updateSettings(req, res) {
  try {
    const updates = req.body;
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      return res.status(400).json({ success: false, message: 'Corps de requête invalide.' });
    }

    const inconnues = Object.keys(updates).filter((k) => !CLES_AUTORISEES.has(k));
    if (inconnues.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Paramètre inconnu : ${inconnues.join(', ')}.`,
      });
    }

    // Valeurs cibles : celles envoyees, completees par celles deja en base.
    const actuelles = {};
    (await getAllSettings()).forEach(({ setting_key, setting_value }) => {
      actuelles[setting_key] = setting_value;
    });
    const urlCible = updates.ollama_url !== undefined ? updates.ollama_url : actuelles.ollama_url;
    const modeleCible =
      updates.ollama_default_model !== undefined
        ? String(updates.ollama_default_model || '').trim()
        : actuelles.ollama_default_model;

    const controleUrl = verifierUrlMoteur(urlCible);
    if (!controleUrl.valide) {
      return res.status(400).json({ success: false, message: controleUrl.message });
    }

    if (!modeleCible) {
      return res.status(400).json({ success: false, message: 'Le modèle par défaut est obligatoire.' });
    }

    // La configuration est verifiee sur l'adresse SOUMISE, pas sur l'ancienne :
    // changer d'adresse et de modele en une fois reste possible.
    const etat = await interrogerMoteur(controleUrl.url);
    if (!etat.joignable) {
      return res.status(400).json({
        success: false,
        message: `Moteur IA injoignable à l'adresse ${controleUrl.url}. ${etat.erreur || ''}`.trim(),
      });
    }

    const disponibles = etat.modeles.map((m) => m.nom);
    // « llama3.2 » et « llama3.2:latest » designent le meme modele ; on
    // enregistre le nom canonique pour que l'interface le retrouve dans sa
    // liste.
    const modeleResolu = resoudreNomModele(modeleCible, disponibles);
    if (!modeleResolu) {
      return res.status(400).json({
        success: false,
        message:
          `Le modèle « ${modeleCible} » n'est pas installé sur ce moteur. ` +
          (disponibles.length
            ? `Modèles disponibles : ${disponibles.join(', ')}.`
            : 'Aucun modèle de conversation disponible sur ce moteur.'),
      });
    }

    await updateSetting('ollama_url', controleUrl.url);
    await updateSetting('ollama_default_model', modeleResolu);

    return res.json({ success: true, message: 'Paramètres mis à jour avec succès.' });
  } catch (error) {
    console.error('Erreur updateSettings :', error.message);
    return res.status(500).json({ success: false, message: 'Erreur lors de la mise à jour des paramètres.' });
  }
}

module.exports = { getSettings, getEtatMoteur, updateSettings };

import { useCallback, useEffect, useState } from 'react';
import { getSystemSettings, updateSystemSettings, getEtatMoteur } from '../services/api';
import { signalerSessionExpiree } from '../services/sessionPortail';
import ChoixModele from './ChoixModele';
import './Settings.css';

function IconServer() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" />
      <line x1="6" y1="18" x2="6.01" y2="18" />
    </svg>
  );
}

const URL_PAR_DEFAUT = 'http://localhost:11434';

/**
 * Ollama accepte « llama3.2 » mais publie « llama3.2:latest ». Sans cette
 * equivalence, un modele pourtant installe n'apparaitrait pas selectionne dans
 * la liste. Une etiquette explicite n'est jamais remplacee : demander
 * « qwen2.5:14b » ne doit pas retomber sur le 7b.
 */
function resoudreModele(nom, nomsDisponibles) {
  if (!nom) return '';
  if (nomsDisponibles.includes(nom)) return nom;
  if (!nom.includes(':') && nomsDisponibles.includes(`${nom}:latest`)) return `${nom}:latest`;
  return nom;
}

/**
 * Page Parametres.
 *
 * L'administrateur n'est pas developpeur : il ne doit ni retenir le nom exact
 * d'un modele, ni savoir ce qu'est une URL d'API. Le moteur publie deja la
 * liste de ce qu'il sait faire, l'interface la lui presente. L'adresse du
 * serveur, qui ne change quasiment jamais, est repliee dans un bloc avance.
 */
function Settings() {
  const [ollamaUrl, setOllamaUrl] = useState(URL_PAR_DEFAUT);
  const [ollamaModel, setOllamaModel] = useState('');
  const [etat, setEtat] = useState({ chargement: true, joignable: false, modeles: [], erreur: null });
  const [sessionExpiree, setSessionExpiree] = useState(false);
  const [avanceOuvert, setAvanceOuvert] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState(null); // { type: 'ok' | 'erreur', texte }

  // Interroge le moteur. Sans argument, l'adresse enregistree est utilisee.
  const verifierMoteur = useCallback(async (url) => {
    setEtat((e) => ({ ...e, chargement: true }));
    try {
      const { data } = await getEtatMoteur(url);
      const d = data.data || {};
      const modeles = d.modeles || [];
      setEtat({
        chargement: false,
        joignable: Boolean(d.joignable),
        modeles,
        erreur: d.erreur || null,
      });
      // Aligne la valeur enregistree sur le nom publie par le moteur.
      const noms = modeles.map((m) => m.nom);
      setOllamaModel((actuel) => resoudreModele(actuel, noms));
      return d;
    } catch (err) {
      // Un 401 vient de notre propre API, pas du moteur : la session a expire.
      // L'afficher comme une panne du moteur enverrait l'administrateur
      // verifier Ollama alors qu'il lui suffit de se reconnecter.
      if (err.response?.status === 401) {
        setSessionExpiree(true);
        setEtat({ chargement: false, joignable: false, modeles: [], erreur: null });
        return null;
      }
      setEtat({
        chargement: false,
        joignable: false,
        modeles: [],
        erreur: err.response?.data?.message || 'Verification impossible.',
      });
      return null;
    }
  }, []);

  useEffect(() => {
    let annule = false;
    getSystemSettings()
      .then(({ data }) => {
        const s = data.data || {};
        if (annule) return;
        setOllamaUrl(s.ollama_url || URL_PAR_DEFAUT);
        setOllamaModel(s.ollama_default_model || '');
      })
      .catch(() => {
        if (!annule) setOllamaUrl(URL_PAR_DEFAUT);
      })
      .finally(() => {
        if (!annule) verifierMoteur();
      });
    return () => { annule = true; };
  }, [verifierMoteur]);

  // Encadree, la console ne montre pas son propre formulaire de connexion :
  // c'est le portail qui deconnecte et presente SON authentification.
  const seReconnecter = signalerSessionExpiree;

  const handleTester = async () => {
    setMessage(null);
    await verifierMoteur(ollamaUrl);
  };

  const handleSave = async (event) => {
    event.preventDefault();
    setIsSaving(true);
    setMessage(null);
    try {
      await updateSystemSettings({
        ollama_url: ollamaUrl.trim(),
        ollama_default_model: ollamaModel,
      });
      setMessage({ type: 'ok', texte: 'Configuration enregistree.' });
      await verifierMoteur();
    } catch (err) {
      if (err.response?.status === 401) {
        setSessionExpiree(true);
      } else {
        // Le serveur refuse une configuration qui ne fonctionne pas et explique
        // pourquoi : c'est ce message qu'il faut montrer, pas un texte generique.
        setMessage({
          type: 'erreur',
          texte: err.response?.data?.message || 'Erreur lors de la sauvegarde.',
        });
      }
    } finally {
      setIsSaving(false);
    }
  };

  // Le modele enregistre peut ne plus etre installe (desinstalle cote serveur).
  // On le garde dans la liste, signale, pour ne pas le faire disparaitre
  // silencieusement du menu.
  const nomsDisponibles = etat.modeles.map((m) => m.nom);
  const modeleManquant = Boolean(ollamaModel) && etat.joignable && !nomsDisponibles.includes(ollamaModel);
  // Un modele enregistre puis desinstalle du serveur reste propose, pour ne pas
  // disparaitre en silence du menu ; l'avertissement sous le champ explique
  // pourquoi il faut en choisir un autre.
  const choixModeles = modeleManquant ? [ollamaModel, ...nomsDisponibles] : nomsDisponibles;
  const peutEnregistrer = etat.joignable && Boolean(ollamaModel) && !modeleManquant && !isSaving;

  const etatClasse = etat.chargement ? 'attente' : etat.joignable ? 'ok' : 'ko';
  const nbModeles = etat.modeles.length;
  const pluriel = nbModeles > 1 ? 's' : '';

  return (
    <div className="st-root">
      {/* ── En-tête ── */}
      <div className="st-page-header">
        <h1 className="st-title">Configuration du Moteur IA (Local)</h1>
        <p className="st-subtitle">
          Tous les traitements sont effectués localement via Ollama. Aucune donnée ne quitte votre infrastructure.
        </p>
      </div>

      {/* ── Badge souveraineté ── */}
      <div className="st-security-badge">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
        100% On-Premise · Souveraineté des données garantie
      </div>

      <form className="st-card" onSubmit={handleSave}>
        <h2 className="st-card-title">
          <IconServer />
          Moteur de génération
        </h2>
        <p className="st-card-desc">
          Le moteur produit les réponses de vos assistants. Choisissez le modèle utilisé par défaut.
        </p>

        {/* ── Session expirée ── */}
        {sessionExpiree ? (
          <div className="st-status st-status--session">
            <span className="st-status-dot" aria-hidden="true" />
            <div className="st-status-body">
              <strong className="st-status-title">Session expirée</strong>
              <span className="st-status-detail">
                Votre session a dépassé 8 heures. Reconnectez-vous pour afficher la configuration.
              </span>
            </div>
            <button type="button" className="st-test-btn" onClick={seReconnecter}>
              Se reconnecter
            </button>
          </div>
        ) : (
        <>
        {/* ── Indicateur d'état ── */}
        <div className={`st-status st-status--${etatClasse}`}>
          <span className="st-status-dot" aria-hidden="true" />
          <div className="st-status-body">
            <strong className="st-status-title">
              {etat.chargement && 'Vérification du moteur…'}
              {!etat.chargement && etat.joignable && 'Moteur connecté'}
              {!etat.chargement && !etat.joignable && 'Moteur injoignable'}
            </strong>
            <span className="st-status-detail">
              {!etat.chargement && etat.joignable && `${nbModeles} modèle${pluriel} disponible${pluriel}`}
              {!etat.chargement && !etat.joignable && etat.erreur}
            </span>
          </div>
          {!etat.chargement && !etat.joignable && (
            <button type="button" className="st-test-btn" onClick={handleTester}>
              Réessayer
            </button>
          )}
        </div>

        {/* ── Modèle par défaut ── */}
        <div className="st-field">
          <label htmlFor="st-ollama-model" className="st-label">Modèle par défaut</label>
          <ChoixModele
            id="st-ollama-model"
            valeur={ollamaModel}
            options={choixModeles}
            surChangement={setOllamaModel}
            desactive={!etat.joignable || nbModeles === 0}
            placeholder="Sélectionnez un modèle"
          />
          <p className="st-input-hint">
            {etat.joignable
              ? 'Modèles installés sur le serveur. Les modèles de vectorisation sont exclus : ils ne savent pas rédiger de réponse.'
              : 'La liste sera disponible dès que le moteur répondra.'}
          </p>
          {modeleManquant && (
            <p className="st-input-warning">
              Le modèle enregistré n&apos;est plus installé sur le serveur. Choisissez-en un autre.
            </p>
          )}
        </div>

        {/* ── Paramètres avancés ── */}
        <div className="st-advanced">
          <button
            type="button"
            className="st-advanced-toggle"
            onClick={() => setAvanceOuvert((v) => !v)}
            aria-expanded={avanceOuvert}
          >
            <span className={`st-chevron ${avanceOuvert ? 'st-chevron--open' : ''}`} aria-hidden="true">›</span>
            Paramètres avancés
          </button>
          {avanceOuvert && (
            <div className="st-advanced-body">
              <div className="st-field">
                <label htmlFor="st-ollama-url" className="st-label">Adresse du serveur Ollama</label>
                <input
                  id="st-ollama-url"
                  type="text"
                  className="st-input"
                  value={ollamaUrl}
                  onChange={(e) => setOllamaUrl(e.target.value)}
                  placeholder={URL_PAR_DEFAUT}
                />
                <p className="st-input-hint">
                  À ne modifier que si le moteur tourne sur une autre machine.
                  Valeur habituelle : {URL_PAR_DEFAUT}
                </p>
                <button
                  type="button"
                  className="st-verifier-btn"
                  onClick={handleTester}
                  disabled={etat.chargement}
                >
                  {etat.chargement ? 'Vérification…' : 'Vérifier cette adresse'}
                </button>
              </div>
            </div>
          )}
        </div>

        </>
        )}

        <div className="st-actions">
          <button type="submit" className="st-save-btn" disabled={!peutEnregistrer || sessionExpiree}>
            {isSaving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
          {message && (
            <span className={`st-feedback st-feedback--${message.type}`}>
              {message.type === 'ok' ? '✓ ' : '⚠ '}{message.texte}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}

export default Settings;

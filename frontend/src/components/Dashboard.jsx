import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createBot, getBots, getWhatsAppQrCode, updateBot } from '../services/api';
import './Dashboard.css';

const initialForm = {
  nom: '',
  specialite_domaine: '',
  numero_telephone: '',
  allow_general_knowledge: false,
};

const initialQrModal = {
  open: false,
  loading: false,
  botId: null,
  botName: '',
  qrBase64: null,
  error: null,
};

function Dashboard() {
  const navigate = useNavigate();
  const [bots, setBots] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState('');
  const [qrModal, setQrModal] = useState(initialQrModal);
  const [editingBotId, setEditingBotId] = useState(null);
  // Le formulaire est replie par defaut : on consulte la liste souvent, on cree
  // un bot rarement. Il s'ouvre au clic sur « Nouveau bot », ou automatiquement
  // lors d'une modification.
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [recherche, setRecherche] = useState('');

  const fetchBots = async () => {
    try {
      setFetching(true);
      setError('');
      const { data } = await getBots();
      setBots(data.data || []);
    } catch (requestError) {
      const status = requestError.response?.status;
      if (status === 401) {
        localStorage.removeItem('token');
        navigate('/login', { replace: true });
        return;
      }
      setError('Impossible de charger les bots pour le moment.');
    } finally {
      setFetching(false);
    }
  };

  // fetchBots est aussi appelee par le bouton Actualiser et apres soumission
  // du formulaire (voir plus bas) ; elle ne depend d aucune prop/etat reactif,
  // l effet ne doit donc s executer qu au montage.
  useEffect(() => {
    fetchBots();
  }, []);

  const handleGenerateQr = async (bot) => {
    setQrModal({ open: true, loading: true, botId: bot.id, botName: bot.nom, qrBase64: null, error: null, alreadyConnected: false });
    try {
      const { data } = await getWhatsAppQrCode(bot.id);
      if (data.alreadyConnected) {
        setQrModal((prev) => ({ ...prev, loading: false, alreadyConnected: true }));
      } else {
        setQrModal((prev) => ({ ...prev, loading: false, qrBase64: data.qrCodeBase64 }));
      }
    } catch (err) {
      const message = err.response?.data?.message || err.message || 'Impossible de générer le QR Code.';
      setQrModal((prev) => ({ ...prev, loading: false, error: message }));
    }
  };

  const handleDownloadQr = () => {
    if (!qrModal.qrBase64) return;
    const a = document.createElement('a');
    a.href = qrModal.qrBase64;
    a.download = `QRCode_WhatsApp_${qrModal.botName.replace(/\s+/g, '_')}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleShareQr = async () => {
    if (!qrModal.qrBase64) return;
    try {
      const response = await fetch(qrModal.qrBase64);
      const blob = await response.blob();
      const file = new File([blob], `QRCode_${qrModal.botName}.png`, { type: 'image/png' });
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: `QR Code WhatsApp — ${qrModal.botName}` });
        return;
      }
      // Fallback : copie dans le presse-papier
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      alert('QR Code copié dans le presse-papier !');
    } catch {
      alert('Le partage ou la copie n\'est pas supporté sur ce navigateur.');
    }
  };

  const handleEditBot = (bot) => {
    setForm({
      nom: bot.nom || '',
      specialite_domaine: bot.specialite_domaine || '',
      numero_telephone: bot.numero_telephone || '',
      allow_general_knowledge: Boolean(bot.allow_general_knowledge),
    });
    setEditingBotId(bot.id);
    setFormulaireOuvert(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelEdit = () => {
    setForm(initialForm);
    setEditingBotId(null);
    setFormulaireOuvert(false);
  };

  const handleChange = (event) => {
    const { name, value, type, checked } = event.target;
    setForm((current) => ({ ...current, [name]: type === 'checkbox' ? checked : value }));
  };

  // Recherche sur le nom, le domaine et le numero : ce sont les trois reperes
  // par lesquels un administrateur identifie un bot dans une longue liste.
  const termeRecherche = recherche.trim().toLowerCase();
  const botsFiltres = termeRecherche
    ? bots.filter((bot) =>
        [bot.nom, bot.specialite_domaine, bot.numero_telephone]
          .filter(Boolean)
          .some((champ) => String(champ).toLowerCase().includes(termeRecherche)),
      )
    : bots;

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (editingBotId !== null) {
        await updateBot(editingBotId, form);
        setEditingBotId(null);
      } else {
        await createBot(form);
      }
      setForm(initialForm);
      setFormulaireOuvert(false);
      await fetchBots();
    } catch (requestError) {
      const status = requestError.response?.status;
      if (status === 401) {
        localStorage.removeItem('token');
        navigate('/login', { replace: true });
        return;
      }
      setError(requestError.response?.data?.message || 'La création du bot a échoué.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="db-root">
      <div className="db-page-header">
        <div>
          <h2 className="db-title">Mes Bots</h2>
          <p className="db-subtitle">Créez et supervisez vos chatbots WhatsApp.</p>
        </div>
        <div className="db-header-actions">
          <button
            className="db-new-btn"
            type="button"
            onClick={() => (formulaireOuvert ? handleCancelEdit() : setFormulaireOuvert(true))}
          >
            {formulaireOuvert ? '✕ Fermer' : '＋ Nouveau bot'}
          </button>
          <button className="db-refresh-btn" type="button" onClick={fetchBots} disabled={fetching}>
            {fetching ? 'Actualisation…' : 'Actualiser'}
          </button>
        </div>
      </div>

      {error ? <div className="db-error">{error}</div> : null}

      <section className="db-stack">
        {formulaireOuvert && (
        <section className="db-panel">
          <div className="panel-header-inline">
            <div>
              <h2>{editingBotId ? 'Modifier le bot' : 'Nouveau bot'}</h2>
              <p>{editingBotId ? 'Modifiez les informations du bot sélectionné.' : 'Créez un agent WhatsApp prêt à être configuré.'}</p>
            </div>
            <span className="badge inactif">Admin</span>
          </div>

          <form className="form-stack" onSubmit={handleSubmit}>
            <div className="field">
              <label htmlFor="nom">Nom du bot</label>
              <input
                id="nom"
                name="nom"
                type="text"
                placeholder="Ex: AssistBot Logistics"
                value={form.nom}
                onChange={handleChange}
                required
              />
            </div>

            <div className="field">
              <label htmlFor="specialite_domaine">Domaine</label>
              <input
                id="specialite_domaine"
                name="specialite_domaine"
                type="text"
                placeholder="Ex: Logistique, Support, Tracking..."
                value={form.specialite_domaine}
                onChange={handleChange}
              />
            </div>

            <div className="field">
              <label htmlFor="numero_telephone">Numéro WhatsApp</label>
              <input
                id="numero_telephone"
                name="numero_telephone"
                type="text"
                placeholder="Ex: +212600000000"
                value={form.numero_telephone}
                onChange={handleChange}
              />
            </div>

            <div className="field field--toggle">
              <label className="toggle-label">
                <input
                  type="checkbox"
                  name="allow_general_knowledge"
                  className="toggle-input"
                  checked={form.allow_general_knowledge}
                  onChange={handleChange}
                />
                <span className="toggle-track">
                  <span className="toggle-thumb" />
                </span>
                <span className="toggle-text">
                  Autoriser les connaissances générales (LLM) si la réponse n&apos;est pas dans les documents
                </span>
              </label>
            </div>

            <div className="form-actions">
              <button className="primary-button" type="submit" disabled={loading}>
                {loading
                  ? (editingBotId ? 'Mise à jour...' : 'Création...')
                  : (editingBotId ? 'Mettre à jour le bot' : 'Créer le bot')}
              </button>
              {editingBotId && (
                <button className="secondary-button" type="button" onClick={handleCancelEdit}>
                  Annuler
                </button>
              )}
            </div>
          </form>
        </section>
        )}

        <section className="db-panel db-bots-panel">
          <div className="bots-panel-header">
            <div>
              <h2>Liste des bots</h2>
              <p>
                {botsFiltres.length === bots.length
                  ? `${bots.length} bot${bots.length > 1 ? 's' : ''} enregistré${bots.length > 1 ? 's' : ''} dans la plateforme.`
                  : `${botsFiltres.length} bot${botsFiltres.length > 1 ? 's' : ''} sur ${bots.length}.`}
              </p>
            </div>

            {bots.length > 3 && (
              <input
                className="bots-search"
                type="search"
                placeholder="Rechercher un bot…"
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
                aria-label="Rechercher un bot par nom, domaine ou numéro"
              />
            )}
          </div>

          {fetching ? (
            <div className="empty-state">Chargement des bots en cours...</div>
          ) : bots.length === 0 ? (
            <div className="empty-state">
              <span className="empty-state-icon" aria-hidden="true">🤖</span>
              <p className="empty-state-title">Aucun bot pour le moment</p>
              <p>Créez votre premier assistant WhatsApp pour commencer.</p>
              <button className="db-new-btn" type="button" onClick={() => setFormulaireOuvert(true)}>
                ＋ Nouveau bot
              </button>
            </div>
          ) : botsFiltres.length === 0 ? (
            <div className="empty-state">
              <span className="empty-state-icon" aria-hidden="true">🔍</span>
              <p className="empty-state-title">Aucun résultat</p>
              <p>Aucun bot ne correspond à « {recherche} ».</p>
            </div>
          ) : (
            <div className="bots-grid">
              {botsFiltres.map((bot) => (
                <article key={bot.id} className="bot-card">
                  <div className="bot-card-header">
                    <span className="bot-name">{bot.nom}</span>
                    <span className={`badge ${(bot.statut || 'inactif').toLowerCase()}`}>
                      {(bot.statut || 'inactif').toUpperCase()}
                    </span>
                  </div>

                  <div className="bot-meta">
                    <span>Domaine: {bot.specialite_domaine || 'Non renseigné'}</span>
                    <span>WhatsApp: {bot.numero_telephone || 'Non renseigné'}</span>
                    <span className={`bot-knowledge-badge ${bot.allow_general_knowledge ? 'allowed' : 'strict'}`}>
                      {bot.allow_general_knowledge ? '🧠 LLM activé' : '🔒 Documents uniquement'}
                    </span>
                  </div>

                  <div className="bot-date">
                    Créé le {new Date(bot.date_creation).toLocaleDateString('fr-FR')}
                  </div>

                  <div className="bot-card-actions">
                    <button
                      type="button"
                      className="bot-edit-btn"
                      onClick={() => handleEditBot(bot)}
                    >
                      ⚙️ Modifier
                    </button>
                    <button
                      type="button"
                      className="bot-qr-btn"
                      onClick={() => handleGenerateQr(bot)}
                    >
                      📱 Générer le QR Code WhatsApp
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>

      {/* ── Modale QR Code WhatsApp ── */}
      {qrModal.open && (
        <div className="qr-overlay" onClick={() => setQrModal(initialQrModal)}>
          <div className="qr-modal" onClick={(e) => e.stopPropagation()}>
            <div className="qr-modal-header">
              <h3 className="qr-modal-title">QR Code WhatsApp — {qrModal.botName}</h3>
              <button
                type="button"
                className="qr-close-btn"
                aria-label="Fermer"
                onClick={() => setQrModal(initialQrModal)}
              >✕</button>
            </div>

            <div className="qr-modal-body">
              {qrModal.loading && (
                <div className="qr-loading">
                  <div className="qr-spinner" />
                  <p>Démarrage de l'instance WhatsApp…</p>
                  <p className="qr-loading-hint">Cela peut prendre jusqu'à 60 secondes.</p>
                </div>
              )}

              {qrModal.alreadyConnected && (
                <div className="qr-info">
                  <p>✅ Ce bot est déjà connecté à WhatsApp.</p>
                  <p className="qr-loading-hint">Aucun QR Code n'est nécessaire. Le bot est actif et opérationnel.</p>
                </div>
              )}

              {qrModal.error && (
                <div className="qr-error">
                  <p>❌ {qrModal.error}</p>
                  <button
                    type="button"
                    className="bot-qr-btn"
                    onClick={() => handleGenerateQr({ id: qrModal.botId, nom: qrModal.botName })}
                  >Réessayer</button>
                </div>
              )}

              {qrModal.qrBase64 && (
                <>
                  <p className="qr-instruction">
                    Ouvrez WhatsApp sur le téléphone du bot → <strong>Appareils connectés</strong> → <strong>Connecter un appareil</strong>
                  </p>
                  <img
                    src={qrModal.qrBase64}
                    alt="QR Code WhatsApp"
                    className="qr-image"
                  />
                  <div className="qr-actions">
                    <button type="button" className="qr-action-btn qr-download" onClick={handleDownloadQr}>
                      📥 Télécharger
                    </button>
                    <button type="button" className="qr-action-btn qr-share" onClick={handleShareQr}>
                      🔗 Partager
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Dashboard;

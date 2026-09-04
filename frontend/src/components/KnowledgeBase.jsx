import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import Select from 'react-select';
import { addBotApiSource, deleteBotApiSource, deleteBotDocument, getBotApiSources, getBotDocuments, getBots, reindexBotDocument, uploadKnowledgeFile, viewBotDocument } from '../services/api';
import './KnowledgeBase.css';

/* ── Icône nuage upload ── */
function IconUpload() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 16 12 12 8 16" />
      <line x1="12" y1="12" x2="12" y2="21" />
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
    </svg>
  );
}

/* ── Icône fichier PDF ── */
function IconFilePdf() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="9" y1="15" x2="15" y2="15" />
      <line x1="9" y1="11" x2="15" y2="11" />
    </svg>
  );
}

/* ── Icône fichier CSV/Excel ── */
function IconFileSheet() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="16" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

/* ── Icône corbeille ── */
function IconTrash() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

/* ── Icône globe (source API) ── */
function IconGlobe() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

/* ── Utilitaires ── */
function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  return `${Math.round(bytes / 1024)} Ko`;
}

function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function getFileType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (ext === 'txt') return 'txt';
  if (ext === 'csv') return 'csv';
  return 'xlsx';
}

function DocIcon({ type }) {
  const cls = `kb-doc-icon ${type === 'pdf' ? 'pdf' : type === 'txt' ? 'csv' : 'xlsx'}`;
  return (
    <div className={cls}>
      {type === 'pdf' ? <IconFilePdf /> : <IconFileSheet />}
    </div>
  );
}

/* ── Badge de statut d'indexation ──
   Un document non indexé n'alimente pas les réponses du bot. Sans ce badge,
   l'échec était invisible : le document apparaissait dans la liste comme les
   autres, et le bot répondait « je n'ai pas cette information » sans que rien
   n'explique pourquoi. Les documents créés avant cette version n'ont pas de
   statut : ils sont affichés comme indexés, ce qu'ils sont. */
function StatutIndexation({ doc }) {
  const statut = doc.indexing_status || 'indexed';
  const libelles = {
    indexed: { texte: 'Indexé', classe: 'kb-statut--indexe' },
    pending: { texte: 'Indexation en cours…', classe: 'kb-statut--attente' },
    failed: { texte: 'Échec d’indexation', classe: 'kb-statut--echec' },
  };
  const { texte, classe } = libelles[statut] || libelles.indexed;

  return (
    <span className={`kb-statut ${classe}`} title={statut === 'failed' ? doc.indexing_error || '' : undefined}>
      {texte}
    </span>
  );
}

function KnowledgeBase() {
  const [bots, setBots] = useState([]);
  const [selectedBotId, setSelectedBotId] = useState('');
  const [activeTab, setActiveTab] = useState('files');
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [apiSources, setApiSources] = useState([]);
  const [apiUrl, setApiUrl] = useState('');
  const [reindexEnCours, setReindexEnCours] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    getBots()
      .then(({ data }) => setBots(data.data || []))
      .catch(() => setBots([]));
  }, []);

  const fetchDocuments = () => {
    if (!selectedBotId) { setDocuments([]); setApiSources([]); return; }
    getBotDocuments(selectedBotId)
      .then(({ data }) => setDocuments(data.data || []))
      .catch(() => setDocuments([]));
    getBotApiSources(selectedBotId)
      .then(({ data }) => setApiSources(data.data || []))
      .catch(() => setApiSources([]));
  };

  // fetchDocuments est aussi appelee apres suppression, upload et ajout de
  // source API (voir plus bas) ; selectedBotId, seule valeur reactive dont elle
  // depend, est deja dans le tableau de dependances de cet effet.
  useEffect(() => {
    fetchDocuments();
  }, [selectedBotId]);

  // La réindexation est lancée côté serveur puis se poursuit en tâche de fond :
  // le calcul des embeddings prend plusieurs secondes par morceau de texte. La
  // liste est rechargée une première fois pour afficher « en cours », puis une
  // seconde fois après quelques secondes pour montrer l'issue.
  const handleReindex = async (docId) => {
    setReindexEnCours(docId);
    try {
      await reindexBotDocument(selectedBotId, docId);
      fetchDocuments();
      toast.success('Réindexation lancée.');
      setTimeout(fetchDocuments, 5000);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Impossible de relancer l’indexation.');
    } finally {
      setReindexEnCours(null);
    }
  };

  const handleDelete = (docId) => {
    toast((t) => (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px', textAlign: 'center' }}>
        <p style={{ margin: '0 0 16px 0', fontSize: '15px', color: '#333' }}>
          <strong>êtes-vous sûr de vouloir supprimer cet élément ?</strong><br/>
          <span style={{ fontSize: '13px', color: '#666', marginTop: '4px', display: 'block' }}>Cette action est définitive et irréversible.</span>
        </p>
        <div style={{ display: 'flex', gap: '12px', width: '100%', justifyContent: 'center' }}>
          <button
            onClick={async () => {
              toast.dismiss(t.id);
              try {
                await deleteBotDocument(selectedBotId, docId);
                fetchDocuments();
                toast.success('Fichier supprimé !');
              } catch (err) {
                const message = err.response?.data?.message || 'Erreur lors de la suppression.';
                toast.error(message);
              }
            }}
            style={{ background: '#e74c3c', color: 'white', border: 'none', padding: '8px 20px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}
          >
            Supprimer
          </button>
          <button
            onClick={() => toast.dismiss(t.id)}
            style={{ background: '#f1f3f5', color: '#333', border: 'none', padding: '8px 20px', borderRadius: '6px', cursor: 'pointer', fontWeight: '500' }}
          >
            Annuler
          </button>
        </div>
      </div>
    ), { 
      duration: Infinity, 
      id: 'delete-confirm',
      style: { 
        minWidth: '350px', 
        padding: '20px', 
        borderRadius: '12px', 
        boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
        border: '1px solid #e2e8f0',
        marginTop: '30vh'
      } 
    });
  };
const handleAddApiSource = async () => {
    if (!selectedBotId) { toast.error('Veuillez sélectionner un bot.'); return; }
    if (!apiUrl.trim()) { toast.error('Veuillez entrer une URL.'); return; }
    try {
      await addBotApiSource(selectedBotId, apiUrl.trim());
      toast.success('Source API connectée avec succès !');
      setApiUrl('');
      fetchDocuments();
    } catch (err) {
      const message = err.response?.data?.message || 'Erreur lors de la connexion.';
      toast.error(message);
    }
  };

  const handleDeleteApiSource = (sourceId) => {
    toast((t) => (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px', textAlign: 'center' }}>
        <p style={{ margin: '0 0 16px 0', fontSize: '15px', color: '#333' }}>
          <strong>êtes-vous sûr de vouloir supprimer cet élément ?</strong><br/>
          <span style={{ fontSize: '13px', color: '#666', marginTop: '4px', display: 'block' }}>Cette action est définitive et irréversible.</span>
        </p>
        <div style={{ display: 'flex', gap: '12px', width: '100%', justifyContent: 'center' }}>
          <button
            onClick={async () => {
              toast.dismiss(t.id);
              try {
                await deleteBotApiSource(selectedBotId, sourceId);
                fetchDocuments();
                toast.success('Source API supprimée !');
              } catch (err) {
                const message = err.response?.data?.message || 'Erreur lors de la suppression.';
                toast.error(message);
              }
            }}
            style={{ background: '#e74c3c', color: 'white', border: 'none', padding: '8px 20px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}
          >
            Supprimer
          </button>
          <button
            onClick={() => toast.dismiss(t.id)}
            style={{ background: '#f1f3f5', color: '#333', border: 'none', padding: '8px 20px', borderRadius: '6px', cursor: 'pointer', fontWeight: '500' }}
          >
            Annuler
          </button>
        </div>
      </div>
    ), { 
      duration: Infinity, 
      id: 'delete-confirm',
      style: { 
        minWidth: '350px', 
        padding: '20px', 
        borderRadius: '12px', 
        boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
        border: '1px solid #e2e8f0',
        marginTop: '30vh'
      } 
    });
  };

  const sendFile = async (file) => {
    setIsUploading(true);
    try {
      await uploadKnowledgeFile(selectedBotId, file);
      toast.success('Fichier envoyé avec succès !');
      fetchDocuments();
    } catch (err) {
      const message = err.response?.data?.message || "Erreur lors de l'envoi du fichier.";
      toast.error(message);
    } finally {
      setIsUploading(false);
    }
  };

  /* \u2500\u2500 Handlers fichiers \u2500\u2500 */
  const handleFileSelect = (event) => {
    const files = Array.from(event.target.files);
    files.forEach((file) => sendFile(file));
    event.target.value = '';
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setIsDragOver(false);
    if (!selectedBotId || isUploading) return;
    const files = Array.from(event.dataTransfer.files);
    files.forEach((file) => sendFile(file));
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    if (selectedBotId && !isUploading) setIsDragOver(true);
  };
  const handleDragLeave = () => setIsDragOver(false);

  const botOptions = bots.map(bot => ({ value: bot.id, label: bot.nom }));
  const selectedBotOption = botOptions.find(option => String(option.value) === String(selectedBotId)) || null;

  const customSelectStyles = {
    control: (provided, state) => ({
      ...provided,
      padding: '4px',
      borderRadius: '8px',
      borderColor: state.isFocused ? '#0284c7' : '#cbd5e1',
      boxShadow: state.isFocused ? '0 0 0 1px #0284c7' : 'none',
      '&:hover': { borderColor: '#0284c7' },
      cursor: 'pointer'
    }),
    option: (provided, state) => ({
      ...provided,
      backgroundColor: state.isSelected ? '#0284c7' : state.isFocused ? '#f0f9ff' : 'white',
      color: state.isSelected ? 'white' : '#333',
      cursor: 'pointer',
      padding: '10px 14px'
    }),
    menu: (provided) => ({
      ...provided,
      borderRadius: '8px',
      overflow: 'hidden',
      boxShadow: '0 10px 25px rgba(0,0,0,0.1)'
    })
  };

  return (
    <div className="kb-root">
      {/* \u2500\u2500 En-tête \u2500\u2500 */}
      <div className="kb-page-header">
        <h1 className="kb-title">Base de Connaissances</h1>
        <p className="kb-subtitle">
          Importez les documents (PDF, TXT, CSV) qui serviront de base de données à vos agents IA.
        </p>
      </div>

      {/* \u2500\u2500 Sélecteur de bot \u2500\u2500 */}
      <div className="kb-bot-selector">
        <label className="kb-bot-label">Bot cible</label>
        <Select
          options={botOptions}
          value={selectedBotOption}
          styles={customSelectStyles}
          placeholder="-- Sélectionnez le bot à configurer --"
          noOptionsMessage={() => 'Aucun bot disponible'}
          onChange={(selected) => setSelectedBotId(selected ? selected.value : '')}
          isSearchable={false}
        />
      </div>

      {/* \u2500\u2500 Onglets \u2500\u2500 */}
      <div className="kb-tabs">
        <button
          type="button"
          className={`kb-tab${activeTab === 'files' ? ' kb-tab--active' : ''}`}
          onClick={() => setActiveTab('files')}
        >
          Fichiers Locaux
        </button>
        <button
          type="button"
          className={`kb-tab${activeTab === 'api' ? ' kb-tab--active' : ''}`}
          onClick={() => setActiveTab('api')}
        >
          Connexion API
        </button>
      </div>

      {/* \u2500\u2500 Contenu onglet Fichiers \u2500\u2500 */}
      {activeTab === 'files' && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt,.csv"
            multiple
            hidden
            onChange={handleFileSelect}
          />
          <div
            className={`kb-dropzone${isDragOver ? ' kb-dropzone--over' : ''}${!selectedBotId || isUploading ? ' kb-dropzone--locked' : ''}`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
          >
            <div className="kb-dropzone-icon"><IconUpload /></div>
            {isUploading ? (
              <p className="kb-dropzone-text">&#9203; Envoi en cours...</p>
            ) : selectedBotId ? (
              <p className="kb-dropzone-text">Glissez et déposez vos fichiers ici</p>
            ) : (
              <p className="kb-dropzone-warning">&#9888;&#65039; Veuillez d&apos;abord sélectionner un bot à configurer</p>
            )}
            <p className="kb-dropzone-hint">PDF, TXT, CSV &#8212; 20 Mo max par fichier</p>
            <button
              type="button"
              className="kb-browse-btn"
              disabled={!selectedBotId || isUploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {isUploading ? 'Envoi...' : 'Parcourir les fichiers'}
            </button>
          </div>
        </>
      )}

      {/* ── Contenu onglet API ── */}
      {activeTab === 'api' && (
        <div className={`kb-api-form${!selectedBotId ? ' kb-api-form--locked' : ''}`}>
          {!selectedBotId && (
            <p className="kb-dropzone-warning" style={{ marginBottom: '12px' }}>
              ⚠️ Veuillez d&apos;abord sélectionner un bot à configurer
            </p>
          )}
          <div className="kb-api-field">
            <label htmlFor="kb-api-url" className="kb-api-label">URL de l&apos;API externe</label>
            <input
              id="kb-api-url"
              type="url"
              className="kb-api-input"
              placeholder="https://api.marsamaroc.ma/tracking..."
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              disabled={!selectedBotId}
            />
          </div>
          <button type="button" className="kb-browse-btn" onClick={handleAddApiSource} disabled={!selectedBotId}>
            Connecter la source
          </button>
        </div>
      )}

      {/* \u2500\u2500 Sources de connaissances \u2500\u2500 */}
      <div className="kb-docs-section">
        <h2 className="kb-docs-title">Sources de connaissances</h2>
        {!selectedBotId ? (
          <div className="kb-empty">Sélectionnez un bot pour voir ses sources.</div>
        ) : documents.length === 0 && apiSources.length === 0 ? (
          <div className="kb-empty">Aucune source indexée pour le moment.</div>
        ) : (
          <ul className="kb-docs-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {documents.map((doc) => {
              const type = getFileType(doc.nom_original);
              return (
                <li key={`doc-${doc.id}`} className="kb-doc-card">
                  <DocIcon type={type} />
                  <div className="kb-doc-info">
                    <p
                      className="kb-doc-name kb-doc-name--clickable"
                      title="Cliquer pour visualiser"
                      onClick={async () => {
                        try {
                          const response = await viewBotDocument(selectedBotId, doc.id);
                          const fileBlob = new Blob([response.data], { type: response.headers['content-type'] });
                          const fileURL = URL.createObjectURL(fileBlob);
                          window.open(fileURL, '_blank');
                        } catch {
                          toast.error('Impossible d\'ouvrir le fichier.');
                        }
                      }}
                    >
                      {doc.nom_original}
                    </p>
                    <p className="kb-doc-meta">
                      Ajouté le {formatDate(doc.date_ajout)} · {formatSize(doc.taille)}
                      {' · '}<StatutIndexation doc={doc} />
                    </p>
                  </div>
                  {doc.indexing_status === 'failed' && (
                    <button
                      type="button"
                      className="kb-doc-reindex"
                      title={doc.indexing_error || 'Relancer l’indexation'}
                      aria-label={`Réindexer ${doc.nom_original}`}
                      disabled={reindexEnCours === doc.id}
                      onClick={() => handleReindex(doc.id)}
                    >
                      {reindexEnCours === doc.id ? '…' : 'Réindexer'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="kb-doc-delete"
                    title="Supprimer le document"
                    aria-label={`Supprimer ${doc.nom_original}`}
                    onClick={() => handleDelete(doc.id)}
                  >
                    <IconTrash />
                  </button>
                </li>
              );
            })}
            {apiSources.map((source) => (
              <li key={`api-${source.id}`} className="kb-doc-card">
                <div className="kb-doc-icon api">
                  <IconGlobe />
                </div>
                <div className="kb-doc-info">
                  <p
                    className="kb-doc-name kb-doc-name--clickable"
                    title="Ouvrir l'API dans un nouvel onglet"
                    onClick={() => window.open(source.url, '_blank', 'noopener,noreferrer')}
                  >
                    {source.url}
                  </p>
                  <p className="kb-doc-meta">Connectée le {formatDate(source.date_ajout)}</p>
                </div>
                <button
                  type="button"
                  className="kb-doc-delete"
                  title="Supprimer la source API"
                  aria-label={`Supprimer ${source.url}`}
                  onClick={() => handleDeleteApiSource(source.id)}
                >
                  <IconTrash />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default KnowledgeBase;
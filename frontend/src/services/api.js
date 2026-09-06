import axios from 'axios';
import { signalerSessionExpiree } from './sessionPortail';

// L'URL de l'API est fournie au moment de la compilation par VITE_API_URL.
// Le repli couvre le développement local, ou la variable n'est pas renseignée.
// Vite n'expose que les variables prefixees VITE_, et leur valeur est figee
// dans le bundle : changer d'API impose donc de reconstruire le frontend.
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000/api',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

/**
 * Un 401 signifie que le jeton est absent, perime ou signe avec un autre
 * secret. Sans ce traitement l'application se croyait connectee — App.jsx ne
 * teste que la PRESENCE du jeton — et chaque page affichait une erreur
 * technique differente au lieu de proposer de se reconnecter.
 *
 * Deux exceptions volontaires :
 *  - la connexion elle-meme, dont le 401 signale un mot de passe errone ;
 *  - le 403, ou le jeton est authentique mais le role insuffisant : se
 *    reconnecter n'y changerait rien.
 */
api.interceptors.response.use(
  (reponse) => reponse,
  (erreur) => {
    const estConnexion = String(erreur.config?.url || '').includes('/admin/login');
    if (erreur.response?.status === 401 && !estConnexion) {
      signalerSessionExpiree();
    }
    return Promise.reject(erreur);
  },
);

export async function login(matricule, password) {
  const response = await api.post('/admin/login', { matricule, password });
  const token = response.data?.token;

  if (token) {
    localStorage.setItem('token', token);
  }

  return response.data;
}

export function getBots() {
  return api.get('/bots');
}

export function createBot(botData) {
  return api.post('/bots', botData);
}

export function uploadKnowledgeFile(botId, file) {
  const formData = new FormData();
  formData.append('botId', botId);
  formData.append('file', file);
  return api.post('/knowledge/upload', formData);
}

export function getBotDocuments(botId) {
  return api.get(`/knowledge/${botId}/documents`);
}

export function deleteBotDocument(botId, docId) {
  return api.delete(`/knowledge/${botId}/documents/${docId}`);
}

export function viewBotDocument(botId, docId) {
  return api.get(`/knowledge/${botId}/documents/${docId}/view`, { responseType: 'blob' });
}

export function reindexBotDocument(botId, docId) {
  return api.post(`/knowledge/${botId}/documents/${docId}/reindex`);
}

export function addBotApiSource(botId, url) {
  return api.post(`/knowledge/${botId}/api-sources`, { url });
}

export function getBotApiSources(botId) {
  return api.get(`/knowledge/${botId}/api-sources`);
}

export function deleteBotApiSource(botId, sourceId) {
  return api.delete(`/knowledge/${botId}/api-sources/${sourceId}`);
}

export function getSystemSettings() {
  return api.get('/settings');
}

/**
 * Etat du moteur IA et modeles installes. `url` permet de tester une adresse
 * avant de l'enregistrer ; sans elle, l'adresse en base est utilisee.
 */
export function getEtatMoteur(url) {
  return api.get('/settings/moteur', url ? { params: { url } } : undefined);
}

export function updateSystemSettings(settingsObject) {
  return api.put('/settings', settingsObject);
}

export function getWhatsAppQrCode(botId) {
  return api.get(`/bots/${botId}/whatsapp/qr`, { timeout: 65000 });
}

export function updateBot(id, botData) {
  return api.put(`/bots/${id}`, botData);
}

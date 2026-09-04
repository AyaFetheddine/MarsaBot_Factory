import axios from 'axios';

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

export async function login(email, password) {
  const response = await api.post('/admin/login', { email, password });
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

export function updateSystemSettings(settingsObject) {
  return api.put('/settings', settingsObject);
}

export function getWhatsAppQrCode(botId) {
  return api.get(`/bots/${botId}/whatsapp/qr`, { timeout: 65000 });
}

export function updateBot(id, botData) {
  return api.put(`/bots/${id}`, botData);
}

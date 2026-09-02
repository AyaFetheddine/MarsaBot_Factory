'use strict';

const { ChatOllama } = require('@langchain/ollama');
const { TavilySearch } = require('@langchain/tavily');
const { SystemMessage, HumanMessage } = require('@langchain/core/messages');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const DEFAULT_MODEL = 'llama3.2';

function detectLanguageDirective(text) {
  if (/[\u0600-\u06FF\u0750-\u077F]/.test(text)) {
    return 'CRITICAL INSTRUCTION: Reply ONLY in Arabic script. No French/English.';
  }
  // Darija Arabizi detected — reply in French (llama3.2 cannot generate real Darija
  // and hallucinates an invented language when forced to write it)
  const darijaWords = /\b(salam|chno|chnou|kifach|wach|fien|fin|labas|bghit|brit|dyal|dir|kat3ref|zwina|hna|nta|ntina|3ndek|3ndi|mzyan|wakha|bslama|chouf|kayn|kayna)\b/i;
  if (darijaWords.test(text)) {
    return 'CRITICAL INSTRUCTION: The user is writing in Moroccan Darija. You MUST reply ONLY in French (standard French). Do NOT attempt to write Darija or any other language.';
  }
  const englishWords = /\b(hello|hi|hey|what|how|when|where|who|why|please|thank|help|good|morning|evening|can|you|is|are|the|and|for|to|tell|me|my|i|want|need|would|like)\b/i;
  if (englishWords.test(text)) {
    return 'CRITICAL INSTRUCTION: The user is writing in English. You MUST reply ONLY in English. Do NOT start with French greetings like "Bonjour".';
  }
  return 'CRITICAL INSTRUCTION: The user is writing in French. You MUST reply ONLY in French.';
}

function isWebQuestion(query) {
  const webKeywords = [
    'météo','meteo','température','temps','pluie','soleil',
    'actualité','actualite','news',"aujourd'hui",'maintenant',
    'prix','tarif','cours','bourse',
    'horaire','trafic','grève','greve',
    'résultat','resultat','score','match',
    'weather','today','current','now','latest',
  ];
  const lower = query.toLowerCase();
  return webKeywords.some(kw => lower.includes(kw));
}

async function askAgent(userQuery, ragContext, allowWebSearch = false, apiContext = '', chatHistory = '', options = {}) {
  // Configuration pilotee par la page Parametres (table system_settings).
  // A defaut, on retombe sur les variables d'environnement.
  const baseUrl = options.ollamaUrl || OLLAMA_URL;
  const model = options.model || DEFAULT_MODEL;
  const llm = new ChatOllama({ baseUrl, model, temperature: 0.2 });
  const languageDirective = detectLanguageDirective(userQuery);
  let webContext = '';

  if (allowWebSearch) {
    const needsWebSearch = !ragContext || ragContext.trim() === '' || isWebQuestion(userQuery);
    if (needsWebSearch) {
      try {
        const searchTool = new TavilySearch({ maxResults: 3, apiKey: process.env.TAVILY_API_KEY });
        console.log(`Web search for: "${userQuery}"`);
        const rawResult = await searchTool.invoke({ query: userQuery });
        webContext = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult);
        console.log('Web search results received.');
      } catch (err) {
        console.warn('Tavily search failed:', err.message);
      }
    }
  }

  let systemContent;
  if (allowWebSearch) {
    const contextSections = [];
    if (ragContext && ragContext.trim()) {
      contextSections.push(
        `--- DEBUT DU CONTEXTE INTERNE (Fichiers & Base de connaissances) ---\n${ragContext}\n--- FIN DU CONTEXTE INTERNE ---`
      );
    }
    if (apiContext && apiContext.trim()) {
      contextSections.push(
        `--- DEBUT DES DONNEES API TEMPS REEL ---\n${apiContext}\n--- FIN DES DONNEES API ---`
      );
    }
    if (webContext) {
      contextSections.push(
        `--- DEBUT DES RESULTATS DE RECHERCHE WEB ---\n${webContext}\n--- FIN DES RESULTATS WEB ---`
      );
    }
    const fullContext = contextSections.length > 0 ? contextSections.join('\n\n') : '(aucun contexte disponible)';
    if (chatHistory && chatHistory.trim()) {
      contextSections.unshift(
        `--- DEBUT DE L'HISTORIQUE DE CONVERSATION ---\n${chatHistory}\n--- FIN DE L'HISTORIQUE ---`
      );
    }
    systemContent =
      `You are the official assistant of Marsa Maroc, operator of the port of Casablanca. ` +
      `${languageDirective}\n\n` +
      `CRITICAL DATA ISOLATION RULES — follow without exception:\n` +
      `1. ISOLATION: NEVER mix or merge information from the internal context (files) with information from the external API. Treat them as completely separate and independent events.\n` +
      `2. IDENTIFIERS: Only link two pieces of information if they share the EXACT same identifier (e.g., same ID_Equipement, same incident ID). Never infer a link based on similar keywords like "panne" or "incident".\n` +
      `3. TRACEABILITY: If a breakdown, incident, or update comes from the API data section, ALWAYS indicate it is real-time or ongoing information (e.g., "according to real-time data...").\n` +
      `4. MEMORY: Use the conversation history above to understand context if the user refers to equipment or a person already mentioned. Do NOT repeat the history in your answer.\n` +
      `5. Reply ONLY using the context provided in the sections below.\n` +
      `6. If the answer is not in the context, say the equivalent of "I don't have this information. Can I help you with something else?" in the user's language.\n\n` +
      (contextSections.length > 0 ? contextSections.join('\n\n') : fullContext);
  } else {
    const contextSections = [];
    if (ragContext && ragContext.trim()) {
      contextSections.push(
        `--- DEBUT DU CONTEXTE INTERNE (Fichiers & Base de connaissances) ---\n${ragContext}\n--- FIN DU CONTEXTE INTERNE ---`
      );
    }
    if (apiContext && apiContext.trim()) {
      contextSections.push(
        `--- DEBUT DES DONNEES API TEMPS REEL ---\n${apiContext}\n--- FIN DES DONNEES API ---`
      );
    }
    const fullContext = contextSections.length > 0 ? contextSections.join('\n\n') : '(no context available)';
    if (chatHistory && chatHistory.trim()) {
      contextSections.unshift(
        `--- DEBUT DE L'HISTORIQUE DE CONVERSATION ---\n${chatHistory}\n--- FIN DE L'HISTORIQUE ---`
      );
    }
    systemContent =
      `You are the official assistant of Marsa Maroc. ` +
      `${languageDirective}\n\n` +
      `ABSOLUTE RULES:\n` +
      `1. Reply ONLY using the context provided in the sections below.\n` +
      `2. ISOLATION: NEVER mix or merge information from the internal context (files) with information from the external API. Treat them as completely separate and independent events.\n` +
      `3. IDENTIFIERS: Only link two pieces of information if they share the EXACT same identifier (e.g., same ID_Equipement, same incident ID). Never infer a link based on similar keywords.\n` +
      `4. TRACEABILITY: If a breakdown, incident, or update comes from the API data section, ALWAYS indicate it is real-time or ongoing information.\n` +
      `5. MEMORY: Use the conversation history above to understand context if the user refers to equipment or a person already mentioned. Do NOT repeat the history in your answer.\n` +
      `6. If the answer is not in the context, say only the equivalent of "I don't have this information in my knowledge base. Can I help you with something else?" in the user's language.\n` +
      `7. NEVER say you are an AI, a language model, or mention a training cutoff date.\n` +
      `8. NEVER use general knowledge or external sources beyond what is provided.\n` +
      `9. NEVER explain your technical limitations.\n` +
      `10. If the user is just saying hello, greeting you, or asking what you can do, DO NOT use the internal context. Just introduce yourself politely as MarsaBot, the Marsa Maroc assistant, and ask how you can help, strictly in the user's language.\n\n` +
      (contextSections.length > 0 ? contextSections.join('\n\n') : fullContext);
  }

  const messages = [new SystemMessage(systemContent), new HumanMessage(userQuery)];
  const response = await llm.invoke(messages);
  return typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
}

module.exports = { askAgent };

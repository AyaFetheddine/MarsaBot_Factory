const fs = require('fs');
const { PDFParse } = require('pdf-parse');
const { findByBotAndName, createDocument, getDocumentsByBot, getDocumentById, deleteDocument } = require('../models/documentModel');
const { addApiSource, getApiSourcesByBot, deleteApiSource } = require('../models/apiSourceModel');
const vectorService = require('../services/vectorService');
const { verifierUrlSource } = require('../utils/urlGuard');

/**
 * Parse un fichier CSV et retourne une chaîne de texte formatée clé:valeur
 * (même format que LangChain CSVLoader), une ligne par enregistrement.
 * Gère les champs entre guillemets contenant des virgules.
 */
function parseCsvToText(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(line => line.trim() !== '');
  if (lines.length < 2) return raw; // pas d'en-têtes détectables

  // Détection automatique du délimiteur (Excel FR → ';', standard → ',')
  const delimiter = lines[0].includes(';') ? ';' : ',';
  console.log(`📊 Délimiteur CSV détecté : '${delimiter}'`);

  // Découpe une ligne CSV en tenant compte des guillemets
  const splitCsvLine = (line) => {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; } // guillemet échappé
        else { inQuotes = !inQuotes; }
      } else if (ch === delimiter && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = splitCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = splitCsvLine(lines[i]);
    const pairs = headers.map((h, idx) => `${h}: ${values[idx] !== undefined ? values[idx] : ''}`).join(', ');
    rows.push(pairs);
  }
  console.log(`📊 CSV parsé : ${rows.length} ligne(s), ${headers.length} colonne(s) : [${headers.join(', ')}]`);
  return rows.join('\n');
}

async function uploadFile(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Aucun fichier reçu.' });
    }

    const { botId } = req.body;

    if (!botId) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'Le champ botId est requis.' });
    }

    // Protection anti-doublon
    const existing = await findByBotAndName(botId, req.file.originalname);
    if (existing) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({
        success: false,
        message: 'Ce fichier existe déjà pour ce bot. Veuillez le renommer si c\'est une nouvelle version.',
      });
    }

    // Extraction du texte selon le type de fichier
    let content = '';
    const ext = req.file.originalname.split('.').pop().toLowerCase();

    if (req.file.mimetype === 'application/pdf' || ext === 'pdf') {
      console.log('\ud83d\udcc4 Début de l\'extraction PDF...');
      try {
        const buffer = fs.readFileSync(req.file.path);
        const parser = new PDFParse({ data: new Uint8Array(buffer) });
        const result = await parser.getText();
        content = result.text.replace(/\n+/g, ' ').trim();
        console.log(`✅ Texte extrait et sauvegardé (${content.length} caractères).`);
      } catch (pdfErr) {
        console.warn(`⚠️ Impossible d'extraire le texte du PDF (${req.file.originalname}) :`, pdfErr.message);
        content = '';
      }
    } else if (ext === 'txt') {
      console.log('\ud83d\udcdd Extraction TXT...');
      try {
        content = fs.readFileSync(req.file.path, 'utf8').trim();
        console.log(`✅ TXT lu (${content.length} caractères).`);
      } catch (txtErr) {
        console.warn(`⚠️ Lecture TXT échouée (${req.file.originalname}) :`, txtErr.message);
        content = '';
      }
    } else if (ext === 'csv') {
      console.log('\ud83d\udcca Extraction CSV...');
      try {
        content = parseCsvToText(req.file.path);
        console.log(`✅ CSV traité (${content.length} caractères).`);
      } catch (csvErr) {
        console.warn(`⚠️ Parsing CSV échoué (${req.file.originalname}) :`, csvErr.message);
        content = '';
      }
    }

    // Enregistrement en base
    const document = await createDocument({
      botId,
      nomOriginal: req.file.originalname,
      nomFichierGenere: req.file.filename,
      chemin: req.file.path,
      taille: req.file.size,
      content,
    });

    // Vectorisation RAG (asynchrone, ne bloque pas la réponse HTTP)
    if (content.trim().length > 0) {
      vectorService.processAndStoreDocument(document.id, content).catch((vecErr) => {
        console.warn(`⚠️  Vectorisation échouée pour le document ${document.id} :`, vecErr.message);
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Fichier uploadé et enregistré avec succès.',
      data: document,
    });
  } catch (error) {
    console.error('Erreur uploadFile :', error.message);
    if (req.file?.path) {
      try { fs.unlinkSync(req.file.path); } catch { /* fichier peut ne pas exister */ }
    }
    return res.status(500).json({ success: false, message: 'Erreur lors de l\'upload.' });
  }
}

async function getDocuments(req, res) {
  try {
    const { botId } = req.params;
    const documents = await getDocumentsByBot(botId);
    return res.json({ success: true, data: documents });
  } catch (error) {
    console.error('Erreur getDocuments :', error.message);
    return res.status(500).json({ success: false, message: 'Erreur lors de la récupération des documents.' });
  }
}

async function deleteFile(req, res) {
  try {
    const { docId } = req.params;

    const document = await getDocumentById(docId);
    if (!document) {
      return res.status(404).json({ success: false, message: 'Document introuvable.' });
    }

    // Suppression du fichier physique
    try {
      fs.unlinkSync(document.chemin);
    } catch {
      // Le fichier physique peut déjà avoir disparu — on continue quand même
    }

    // Suppression en base
    await deleteDocument(docId);

    return res.json({ success: true, message: 'Document supprimé avec succès.' });
  } catch (error) {
    console.error('Erreur deleteFile :', error.message);
    return res.status(500).json({ success: false, message: 'Erreur lors de la suppression.' });
  }
}

async function addApi(req, res) {
  try {
    const { botId } = req.params;
    const { url } = req.body;
    if (!url || !url.trim()) {
      return res.status(400).json({ success: false, message: "L'URL est requise." });
    }
    // Refus des URL pointant vers le reseau interne (SSRF)
    await verifierUrlSource(url.trim());

    const source = await addApiSource(botId, url.trim());
    return res.status(201).json({ success: true, data: source });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error('Erreur addApi :', error.message);
    return res.status(500).json({ success: false, message: "Erreur lors de l'ajout de la source API." });
  }
}

async function getApis(req, res) {
  try {
    const { botId } = req.params;
    const sources = await getApiSourcesByBot(botId);
    return res.json({ success: true, data: sources });
  } catch (error) {
    console.error('Erreur getApis :', error.message);
    return res.status(500).json({ success: false, message: 'Erreur lors de la récupération des sources API.' });
  }
}

async function deleteApi(req, res) {
  try {
    const { sourceId } = req.params;
    await deleteApiSource(sourceId);
    return res.json({ success: true, message: 'Source API supprimée avec succès.' });
  } catch (error) {
    console.error('Erreur deleteApi :', error.message);
    return res.status(500).json({ success: false, message: 'Erreur lors de la suppression.' });
  }
}

async function viewFile(req, res) {
  try {
    const { docId } = req.params;
    const document = await getDocumentById(docId);
    if (!document) {
      return res.status(404).json({ success: false, message: 'Document introuvable.' });
    }
    // chemin est un chemin absolu enregistré au moment de l'upload
    if (!fs.existsSync(document.chemin)) {
      return res.status(404).json({ success: false, message: 'Fichier physique introuvable sur le serveur.' });
    }
    return res.sendFile(document.chemin);
  } catch (error) {
    console.error('Erreur viewFile :', error.message);
    return res.status(500).json({ success: false, message: 'Erreur lors de la lecture du fichier.' });
  }
}

module.exports = { uploadFile, getDocuments, deleteFile, viewFile, addApi, getApis, deleteApi };


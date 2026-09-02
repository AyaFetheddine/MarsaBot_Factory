# MarsaBot Factory

Plateforme d'administration permettant de créer et d'exploiter des assistants
conversationnels WhatsApp adossés à un LLM exécuté localement.

Un administrateur crée un « bot » depuis une interface web, lui attache une base
de connaissances (documents PDF/TXT/CSV et sources API externes), puis l'appaire
à un compte WhatsApp par QR Code. Toute personne écrivant ensuite au numéro
dialogue avec un assistant qui répond à partir de ces sources, via un pipeline
RAG et un modèle servi par Ollama.

Premier des deux microservices du projet. Le second, **MarsaTrack AI**, couvre la
gestion opérationnelle portuaire et la vision par ordinateur. Les deux sont
indépendants : bases de données, dépôts et cycles de vie distincts.

> **Le canal conversationnel est WhatsApp uniquement.** L'interface web sert à
> l'administration (bots, documents, paramètres) ; elle ne contient pas de
> fenêtre de discussion.

---

## Architecture

```
Administration    React 19 + Vite  :5173  ──axios──▶  Express 5  :3000
Canal             Téléphone → WhatsApp Web → Puppeteer/Chromium (1 par bot)
                                                        │
                                                whatsappService
                       ┌──────────────┬─────────────────┼───────────────┐
                       ▼              ▼                 ▼               ▼
                 vectorService   sources API      historyService   agentService
                       │          (axios)               │               │
                 Ollama :11434   APIs / Google    MySQL messages   Ollama (LLM)
                 nomic-embed     Sheets · Docs                     + Tavily
                       └──────────▶  MySQL :3306  marsabot_db  ◀────────┘
```

Les vecteurs sont stockés dans MySQL (`document_chunks.embedding`, type `JSON`)
et la similarité cosinus est calculée en JavaScript. Il n'y a pas de base
vectorielle dédiée.

---

## Prérequis

À installer manuellement — aucun script du projet ne s'en charge.

| Logiciel | Version | Rôle |
| --- | --- | --- |
| Node.js | 20 ou plus | Backend et frontend |
| MySQL | 8.x | Base `marsabot_db` |
| Ollama | récent | Sert le LLM et les embeddings |
| Docker | optionnel | Uniquement pour le mode conteneurisé |

Chromium est téléchargé automatiquement par Puppeteer lors du `npm install`.
En mode Docker, il est fourni par l'image.

### Modèles Ollama

Les deux sont **obligatoires** — environ 2,3 Go au total :

```bash
ollama pull llama3.2          # génération des réponses
ollama pull nomic-embed-text  # embeddings (768 dimensions)
```

`nomic-embed-text` n'est pas substituable : les vecteurs déjà en base ont sa
dimension. En changer impose de réindexer tous les documents.

Le modèle de génération, lui, se change depuis la page Paramètres sans
redémarrage. `qwen2.5:7b` (4,7 Go) donne de nettement meilleurs résultats que
`llama3.2` sur des données tabulaires — voir *Limites connues*.

### Compte externe

**Tavily** (https://app.tavily.com) — optionnel. Sans clé, la recherche web des
bots « connaissance générale » échoue silencieusement ; tout le reste fonctionne.

---

## Installation en mode natif

### 1. Base de données

```bash
mysql -u root -p < backend/sql/init.sql
```

**Cette étape n'est pas optionnelle hors Docker.** Le script crée les tables
`bots` et `admins`, dont dépendent toutes les clés étrangères. Les tables
`documents`, `document_chunks`, `messages` et `system_settings` sont créées
automatiquement par le serveur à son démarrage.

### 2. Backend

```bash
cd backend
npm install
cp .env.example .env
```

Renseigner `backend/.env` :

| Variable | Obligatoire | Détail |
| --- | --- | --- |
| `DB_HOST` `DB_USER` `DB_PASSWORD` `DB_NAME` | oui | Connexion MySQL, base `marsabot_db` |
| `JWT_SECRET` | **oui** | Sans elle, la connexion renvoie une erreur 500 |
| `DEFAULT_ADMIN_PASSWORD` | oui | Mot de passe de l'admin initial |
| `PORT` | non | 3000 par défaut |
| `OLLAMA_URL` | non | `http://localhost:11434` par défaut |
| `TAVILY_API_KEY` | non | Recherche web désactivée si absente |

Générer un secret :

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Démarrer — il n'y a pas de script `npm start` :

```bash
node src/index.js
```

### 3. Compte administrateur

Une seule fois, serveur démarré :

```bash
curl http://localhost:3000/api/admin/setup
```

Crée `admin@marsamaroc.ma` avec le mot de passe de `DEFAULT_ADMIN_PASSWORD`.
L'appel est refusé si un administrateur existe déjà.

### 4. Frontend

```bash
cd frontend
npm install
npm run dev
```

Interface sur http://localhost:5173.

> L'URL de l'API est **codée en dur** dans `src/services/api.js`
> (`http://localhost:3000/api`). Aucune variable d'environnement ne la surcharge.
> Un backend sur un autre port ou une autre machine impose de modifier ce
> fichier.

---

## Installation par Docker

```bash
cp .env.example .env      # à la racine, lu par Compose
docker compose up -d --build
```

Interface sur http://localhost, API sur http://localhost:3000.

**Ollama doit tourner sur la machine hôte** — il ne fait pas partie de la stack.
Le backend le joint via `host.docker.internal`, et les deux modèles doivent y
être déjà téléchargés.

Le schéma est appliqué automatiquement au premier démarrage de MySQL. Les
sessions WhatsApp et les fichiers uploadés sont persistés par montage de volume.

---

## Utilisation

1. Se connecter avec le compte administrateur.
2. **Mes Bots** — créer un bot. L'option « connaissances générales » autorise le
   LLM à répondre hors documents et active la recherche web.
3. **Base de Connaissances** — sélectionner le bot, déposer des fichiers
   (PDF, TXT, CSV — 20 Mo maximum) ou connecter une URL d'API sous l'onglet
   *Connexion API*. L'extraction, le découpage et la vectorisation sont
   déclenchés automatiquement.
4. **Mes Bots → Générer le QR Code** — scanner depuis WhatsApp du téléphone
   dédié : *Appareils connectés → Connecter un appareil*. La première génération
   peut prendre jusqu'à 60 secondes, le temps que Chromium démarre.
5. Écrire au numéro du bot depuis **un autre téléphone**. Un message qu'on
   s'envoie à soi-même n'est pas reçu par la bibliothèque.

La session est conservée dans `backend/.wwebjs_auth/`. Après un redémarrage du
serveur, les bots au statut `actif` se reconnectent seuls, sans nouveau QR.

### Paramètres

URL d'Ollama et modèle de génération. Les valeurs sont relues **à chaque
message** : changer de modèle ne demande aucun redémarrage. Le nom doit
correspondre exactement à la sortie de `ollama list`.

---

## Ports

| Port | Service | Requis |
| --- | --- | --- |
| 3000 | API backend | oui |
| 5173 | Frontend Vite (développement) | oui en dev |
| 3306 | MySQL | oui — le serveur s'arrête si la connexion échoue |
| 11434 | Ollama | oui — aucune réponse de bot sans lui |
| 80 | Nginx | mode Docker uniquement |

---

## Limites connues

**WhatsApp non officiel.** `whatsapp-web.js` pilote WhatsApp Web dans un
Chromium ; ce n'est pas l'API WhatsApp Business. Le compte utilisé s'expose à
une suspension par Meta. La build de WhatsApp Web est épinglée dans
`whatsappService.js` : une mise à jour de Meta peut casser la bibliothèque, et
il faut alors ajuster la version épinglée.

**Un Chromium par bot actif.** Compter plusieurs centaines de mégaoctets de
mémoire vive par bot, et une centaine sur disque pour son profil de session.

**Recherche vectorielle linéaire.** Chaque message charge tous les chunks du bot
en mémoire pour calculer les similarités. Suffisant pour quelques centaines de
chunks, pas au-delà.

**Fichiers Excel.** Les `.xlsx` sont acceptés à l'upload mais leur contenu n'est
pas extrait : le document est enregistré vide et n'alimente pas les réponses.
Utiliser le format CSV.

**Aucun statut d'indexation.** La vectorisation est lancée sans attente et ses
erreurs ne sont que journalisées. Si Ollama est arrêté au moment de l'upload, le
document apparaît dans la liste sans qu'aucun vecteur ait été produit.

**Qualité selon le modèle.** `llama3.2` (3 milliards de paramètres) confond des
statuts textuels proches dans un tableau — il classe par exemple un équipement
en « Maintenance preventive » parmi les équipements « En panne », de façon
reproductible. `qwen2.5:7b` répond correctement sur les mêmes données.

**Le premier message est lent.** Ollama charge le modèle en mémoire au premier
appel : compter 20 secondes pour un modèle de 2 Go, 90 secondes pour 4,7 Go. Les
suivants tombent sous les 20 secondes tant que le modèle reste chargé.

---

## Dépannage

**Le serveur s'arrête au démarrage** — MySQL est injoignable, ou `init.sql` n'a
pas été exécuté et les tables `bots` / `admins` n'existent pas.

**La connexion renvoie une erreur 500** — `JWT_SECRET` est vide dans
`backend/.env`.

**Le bot ne répond pas** — vérifier dans l'ordre : Ollama écoute sur 11434 ; le
modèle de la page Paramètres existe dans `ollama list` ; le message vient bien
d'un autre numéro ; la table `messages` reçoit une ligne à chaque message
entrant (si elle reste vide, le message n'atteint pas le gestionnaire).

**Le bot répond qu'il n'a pas l'information** — le bot est en mode strict et
aucun contexte pertinent n'a été trouvé. Vérifier que `document_chunks` contient
bien des lignes pour ce bot.

**Le QR Code n'apparaît pas** — Chromium n'a pas démarré. Le message d'erreur
après 60 secondes évoque une session déjà active, ce qui n'est pas toujours la
cause réelle. Relancer détruit la session en cours.

---

## Structure

```
backend/
  sql/init.sql              tables bots et admins
  src/
    config/db.js            pool MySQL
    routes/                 admin, bots, knowledge, settings
    controllers/            logique HTTP
    models/                 accès base et création des tables
    services/
      agentService.js       construction du prompt et appel au LLM
      vectorService.js      découpage, embeddings, recherche
      whatsappService.js    clients WhatsApp et traitement des messages
      historyService.js     mémoire conversationnelle
    middlewares/            authentification JWT, upload multer
frontend/
  src/components/           Login, Dashboard, KnowledgeBase, Settings
  src/services/api.js       client axios
```

---

## Sécurité

Cette version est destinée à un usage de développement et de démonstration.
Avant tout déploiement exposé, traiter au minimum : les URL de sources API,
appelées côté serveur sans validation ; le dossier `/uploads`, servi sans
authentification ; le contenu des documents et des API, injecté brut dans le
prompt ; l'absence de limitation de débit sur la route de connexion ; et la
politique CORS, aujourd'hui ouverte à toutes les origines.

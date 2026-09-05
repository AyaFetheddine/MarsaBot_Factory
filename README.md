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
Administration    React 19 + Vite  :5174  ──axios──▶  Express 5  :3000
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
| `ALLOWED_INTERNAL_HOSTS` | non | Hôtes internes autorisés comme sources API, séparés par des virgules |
| `CORS_ORIGINS` | non | Origines autorisées à appeler l'API depuis un navigateur, séparées par des virgules. Sans elle, seules les origines locales de développement sont acceptées |
| `LOGIN_RATE_LIMIT_WINDOW_MINUTES` | non | Fenêtre de limitation de la connexion, 15 minutes par défaut |
| `LOGIN_RATE_LIMIT_MAX` | non | Tentatives de connexion autorisées par fenêtre et par adresse, 20 par défaut. `0` désactive la limitation |
| `CONTEXTE_MAX_CARACTERES_PAR_SOURCE` | non | Longueur maximale de chaque source injectée dans le prompt, 8000 par défaut |

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
cp .env.example .env       # facultatif : les valeurs par défaut suffisent en local
npm run dev
```

Interface sur **http://localhost:5174**. MarsaBot occupe 5174 et laisse 5173 à
MarsaTrack AI, pour que les deux frontends du projet tournent en même temps. Le
port est fixé dans `vite.config.js`, surchargeable par `FRONTEND_PORT`, et
`strictPort` est actif : si le port est déjà pris, Vite échoue au lieu de
glisser sur un autre port, ce qui produirait une origine refusée par le CORS du
backend.

| Variable | Détail |
| --- | --- |
| `VITE_API_URL` | URL de base de l'API, chemin `/api` compris. Repli : `http://localhost:3000/api` |
| `FRONTEND_PORT` | Port du serveur de développement Vite. 5174 par défaut |

> Vite n'expose au code que les variables préfixées `VITE_`, et fige leur valeur
> dans le bundle au moment du build. Changer d'API impose donc de relancer
> `npm run build`, pas seulement de redémarrer le serveur.

---

## Installation par Docker

```bash
cp .env.example .env           # à la racine, lu par Compose
docker network create marsa_net   # une seule fois, réseau partagé avec MarsaTrack
docker compose up -d --build
```

Interface sur http://localhost, API sur http://localhost:3000.

**Deux réseaux.** `marsabot_interne` est privé au stack et disparaît avec lui.
`marsa_net` est déclaré externe : il doit exister avant le démarrage, survit à
un `docker compose down`, et permet à MarsaBot et à MarsaTrack AI de s'appeler
par leur nom de conteneur. Seul le backend y est raccordé — MySQL et le
frontend restent sur le réseau privé.

Le backend porte un healthcheck qui interroge sa sonde `/health`, laquelle
vérifie réellement MySQL et Ollama. Le conteneur n'est donc déclaré sain que
lorsque ses dépendances répondent.

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

### Affichage depuis le portail MarsaPort AI

La console peut être consultée de deux façons :

- **seule**, sur `http://localhost:5174` — apparence inchangée, barre latérale
  et en-tête compris ;
- **depuis le portail MarsaPort AI**, qui l'affiche dans un cadre. Le portail
  fournissant déjà une navigation et un en-tête, la console détecte
  l'encadrement et masque les siens, pour qu'une seule barre latérale reste
  visible.

Seule la coquille est masquée : aucun contenu, aucune fonctionnalité et aucun
appel à l'API ne changent. Le portail ne fait que référencer l'adresse de la
console, il n'appelle jamais son backend.

⚠️ **Session distincte.** Les deux interfaces vivent sur des ports différents,
donc sur des origines différentes : leurs sessions ne sont pas partagées. À la
première ouverture depuis le portail, la console demande sa propre connexion.
Ce n'est pas une authentification unifiée.

---

## Ports

| Port | Service | Requis |
| --- | --- | --- |
| 3000 | API backend | oui |
| 5174 | Frontend Vite (développement) | oui en dev — 5173 est laissé à MarsaTrack AI |
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

**Sources API et réseau interne.** Les URL de sources sont refusées si elles
pointent vers une adresse privée, `localhost` ou une adresse lien-local, à la
fois à l'enregistrement et à chaque appel. Pour autoriser une exception —
typiquement `localhost:3001` afin d'interroger MarsaTrack AI — la déclarer
dans `ALLOWED_INTERNAL_HOSTS`. Les redirections sont suivies mais chaque saut
est contrôlé ; ce contrôle ne peut pas résoudre le DNS, donc une redirection
vers un nom de domaine pointant vers une adresse interne reste possible.

**Un Chromium par bot actif.** Compter plusieurs centaines de mégaoctets de
mémoire vive par bot, et une centaine sur disque pour son profil de session.

**Recherche vectorielle linéaire.** Chaque message charge tous les chunks du bot
en mémoire pour calculer les similarités. Suffisant pour quelques centaines de
chunks, pas au-delà.

**Indexation asynchrone.** Après un envoi, la vectorisation se poursuit en tâche
de fond : le calcul des embeddings prend plusieurs secondes par morceau de
texte. Le document porte un statut visible dans l'interface — *Indexation en
cours*, *Indexé* ou *Échec d'indexation*, ce dernier accompagné du motif au
survol. **Seuls les documents `indexed` alimentent les réponses du bot** : un
document en échec peut avoir laissé une indexation partielle, et répondre
dessus donnerait une réponse fausse sans que rien ne le signale. Un bouton
*Réindexer* relance l'opération. L'écriture des chunks est transactionnelle,
donc un échec en cours de route ne laisse jamais d'indexation à moitié faite.

**Fichiers Excel.** Les `.xlsx` ne sont **pas** pris en charge et sont refusés à
l'envoi. Ils étaient auparavant acceptés sans que leur contenu soit extrait : le
document était enregistré vide et n'alimentait aucune réponse, sans que rien ne
l'indique. Convertir le classeur en CSV avant de l'importer.

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
  sql/init.sql              schéma de référence de la base
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

### Schéma de la base — où est la source de vérité

`backend/sql/init.sql` **est la référence**. Il décrit les sept tables du
produit, et Docker Compose le monte dans MySQL au tout premier démarrage du
conteneur.

| Table | Rôle |
| --- | --- |
| `bots` | Les agents et leur configuration |
| `admins` | Comptes d'administration |
| `documents` | Fichiers importés, texte extrait, statut d'indexation |
| `document_chunks` | Morceaux de texte et leurs vecteurs |
| `api_sources` | URL d'API interrogées par un bot |
| `system_settings` | Réglages globaux (URL Ollama, modèle par défaut) |
| `messages` | Historique de conversation par bot et par correspondant |

Au démarrage, le backend exécute un `CREATE TABLE IF NOT EXISTS` pour chacune
d'elles. Ces définitions sont **identiques** à celles d'`init.sql` et existent
pour le mode natif, où aucun script d'initialisation n'est joué : elles créent
ce qui manque sans modifier l'existant. Une exception subsiste, un `ALTER TABLE`
défensif sur `messages.bot_id` dans `models/messageModel.js`, qui n'a pas été
touché ici.

> **Base antérieure à septembre 2026.** Le code comportait des `ALTER TABLE` de
> rattrapage qui ajoutaient à chaud les colonnes manquantes en avalant l'erreur
> « colonne déjà existante ». Ils faisaient diverger le schéma réel de celui du
> fichier, et sont retirés. Une base créée avant les colonnes `content` et
> d'indexation doit donc être mise à niveau une fois, à la main :
>
> ```sql
> ALTER TABLE documents
>   ADD COLUMN content LONGTEXT,
>   ADD COLUMN indexing_status ENUM('pending','indexed','failed') NOT NULL DEFAULT 'indexed',
>   ADD COLUMN indexing_error VARCHAR(255);
> ```

Les tables `whatsapp_sessions` et `bot_documents` ont été supprimées d'`init.sql`
en septembre 2026 : aucune ligne, aucune référence dans le code. L'état de
connexion WhatsApp vit en mémoire dans `whatsappService`, et `bot_documents`
avait été remplacée par `documents`. Elles subsistent dans les bases déjà
créées, où elles peuvent être supprimées sans conséquence.

---

## Sécurité

Cette version est destinée à un usage de développement et de démonstration.

En place aujourd'hui : les URL de sources API sont validées contre le SSRF à
l'enregistrement comme à chaque appel ; le dossier `/uploads` n'est plus servi
publiquement ; `helmet` pose les en-têtes de sécurité ; la politique CORS
fonctionne en liste blanche, réduite aux origines locales de développement
quand `CORS_ORIGINS` n'est pas renseignée ; la route de connexion est limitée
en débit par adresse ; et le `botId` de l'URL est vérifié avant tout accès à un
document ou à une source.

### Séparation entre instructions et données

Le prompt est construit en trois zones. Les règles du bot, sa langue et son
identité viennent **avant**. Tout ce que nous n'écrivons pas — documents,
réponses d'API, résultats web, **historique de conversation** — est enfermé dans
un bloc unique `<DONNEES …>`, dont l'identifiant est **tiré au hasard à chaque
requête** : un contenu écrit à l'avance ne peut donc pas le deviner pour fermer
le bloc et se faire passer pour une consigne. Un rappel placé **après** le bloc
réancre le modèle.

Chaque source traverse `utils/neutraliserContexte.js`, qui ne touche qu'à ce qui
a une valeur **structurelle** : marqueurs de rôle en début de ligne, balises de
contrôle de modèle, tentatives de fermeture du délimiteur, caractères de
contrôle et d'inversion de sens de lecture. La prose est laissée intacte — un
document parlant de « règle » ou de « système » dans une phrase, comme une ligne
CSV commençant par `ID_Equipement:`, ressort à l'identique. Chaque source est
tronquée à `CONTEXTE_MAX_CARACTERES_PAR_SOURCE`, la coupe étant annoncée au
modèle plutôt que silencieuse.

Cette protection **réduit** le risque d'injection, elle ne l'annule pas : un
modèle de langage reste faillible face à un contenu adverse. Elle supprime les
vecteurs structurels, pas la persuasion en langage naturel.

### Forme du jeton

`POST /api/admin/login` renvoie un JWT signé en HS256 avec `JWT_SECRET`,
**valable 8 heures**. `JWT_SECRET` n'a aucun repli en dur : sans la variable, la
connexion échoue plutôt que de signer avec une valeur devinable.

```json
{
  "id": 42,
  "email": "admin@marsamaroc.ma",
  "nom": "Administrateur",
  "role": "Admin",
  "iat": 1757000000,
  "exp": 1757028800
}
```

Le claim `role` aligne la forme du jeton sur celle de MarsaTrack AI, où les
rôles `Admin` et `Portiqueur` existent déjà. MarsaBot n'a qu'un seul type de
compte : la valeur est constante, la table `admins` n'a pas de colonne `role`,
et **aucun contrôle d'autorisation ne s'appuie sur ce claim aujourd'hui**. Il
est présent pour que les deux services parlent la même langue le jour d'une
authentification commune. Le jeton ne transporte aucun secret : ni empreinte de
mot de passe, ni clé.

Le jeton est exigé par `/api/bots`, `/api/knowledge` et `/api/settings`.
`/api/admin/login`, `/api/admin/setup`, `/api/health` et `/health` sont
publiques.

### Sondes

| Route | Auth | Ce qu'elle fait |
| --- | --- | --- |
| `/api/health` | non | Déclarative : répond toujours 200 si le serveur HTTP est vivant. Distingue un serveur mort d'une dépendance en panne |
| `/health` | non | Interroge réellement MySQL (`SELECT 1`) et Ollama (`/api/tags`). **200** si les deux répondent, **503** sinon. Sert de healthcheck au conteneur |

```json
{
  "status": "OK",
  "timestamp": "2026-09-04T14:31:23.928Z",
  "dependances": {
    "mysql":  { "statut": "ok", "duree_ms": 119 },
    "ollama": { "statut": "ok", "duree_ms": 108,
                "url": "http://localhost:11434", "modeles": 3 }
  }
}
```

Un Ollama joignable mais sans modèle installé reste en `ok` avec
`"modeles": 0` — de quoi diagnostiquer un bot muet alors que tout semble en
ligne.

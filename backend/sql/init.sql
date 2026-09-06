-- =============================================
-- MarsaBot Factory - Initialisation de la BDD
-- =============================================

CREATE DATABASE IF NOT EXISTS marsabot_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE marsabot_db;

-- -----------------------------------------
-- Table : bots
-- -----------------------------------------
CREATE TABLE IF NOT EXISTS bots (
  id                        INT           AUTO_INCREMENT PRIMARY KEY,
  nom                       VARCHAR(255)  NOT NULL,
  description               TEXT,
  specialite_domaine        VARCHAR(255),
  numero_telephone          VARCHAR(20),
  statut                    ENUM('actif', 'inactif') NOT NULL DEFAULT 'inactif',
  allow_general_knowledge   BOOLEAN       NOT NULL DEFAULT FALSE,
  date_creation             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- -----------------------------------------
-- Table : documents
--
-- La colonne content porte le texte extrait du fichier, et c'est elle qui est
-- decoupee puis vectorisee. Elle figure ici des la creation : le code la
-- rajoutait au demarrage par un ALTER TABLE de rattrapage, ce qui faisait
-- diverger le schema de ce fichier de celui reellement en service.
--
-- indexing_status vaut 'indexed' par defaut plutot que 'pending' : un document
-- deja vectorise par une version anterieure doit rester interrogeable, et un
-- document sans texte n'a rien a indexer.
-- -----------------------------------------
CREATE TABLE IF NOT EXISTS documents (
  id                    INT           AUTO_INCREMENT PRIMARY KEY,
  bot_id                INT           NOT NULL,
  nom_original          VARCHAR(255)  NOT NULL,
  nom_fichier_genere    VARCHAR(255)  NOT NULL,
  chemin                VARCHAR(500)  NOT NULL,
  taille                INT           NOT NULL,
  content               LONGTEXT,
  indexing_status       ENUM('pending', 'indexed', 'failed') NOT NULL DEFAULT 'indexed',
  indexing_error        VARCHAR(255),
  date_ajout            TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_doc_bot
    FOREIGN KEY (bot_id) REFERENCES bots(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB;

-- -----------------------------------------
-- Table : api_sources
-- -----------------------------------------
CREATE TABLE IF NOT EXISTS api_sources (
  id         INT            AUTO_INCREMENT PRIMARY KEY,
  bot_id     INT            NOT NULL,
  url        VARCHAR(2048)  NOT NULL,
  date_ajout TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_apisource_bot
    FOREIGN KEY (bot_id) REFERENCES bots(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB;

-- -----------------------------------------
-- Table : admins
-- -----------------------------------------
-- L'identifiant est le MATRICULE, comme dans MarsaTrack AI : depuis la fusion,
-- la meme personne ouvre les deux modules et ne doit pas retenir deux
-- identifiants differents pour un seul compte.
CREATE TABLE IF NOT EXISTS admins (
  id            INT           AUTO_INCREMENT PRIMARY KEY,
  matricule     VARCHAR(100)  UNIQUE NOT NULL,
  password_hash VARCHAR(255)  NOT NULL,
  nom           VARCHAR(100)
) ENGINE=InnoDB;

-- -----------------------------------------
-- Table : document_chunks
--
-- Un morceau de texte et son vecteur. L'embedding est stocke en JSON : il n'y
-- a pas de base vectorielle, les similarites sont calculees en memoire.
-- -----------------------------------------
CREATE TABLE IF NOT EXISTS document_chunks (
  id           INT  AUTO_INCREMENT PRIMARY KEY,
  document_id  INT  NOT NULL,
  chunk_text   TEXT NOT NULL,
  embedding    JSON,

  CONSTRAINT fk_chunks_document
    FOREIGN KEY (document_id) REFERENCES documents(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB;

-- -----------------------------------------
-- Table : system_settings
--
-- Reglages globaux modifiables depuis la page Parametres : URL d'Ollama et
-- modele par defaut. Les valeurs initiales sont inserees par le backend au
-- demarrage, pas ici.
-- -----------------------------------------
CREATE TABLE IF NOT EXISTS system_settings (
  id            INT           AUTO_INCREMENT PRIMARY KEY,
  setting_key   VARCHAR(100)  UNIQUE NOT NULL,
  setting_value VARCHAR(1024) NOT NULL DEFAULT ''
) ENGINE=InnoDB;

-- -----------------------------------------
-- Table : messages
--
-- Historique de conversation, cloisonne par bot et par correspondant.
-- bot_id est une chaine et non une cle etrangere : l'identifiant provient du
-- client WhatsApp, ou il circule sous forme textuelle.
-- -----------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  id         INT           AUTO_INCREMENT PRIMARY KEY,
  id_groupe  VARCHAR(255)  NOT NULL,
  bot_id     VARCHAR(255)  NOT NULL,
  role       ENUM('user', 'assistant') NOT NULL,
  content    TEXT          NOT NULL,
  created_at TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_messages_groupe_bot (id_groupe, bot_id),
  INDEX idx_messages_created (created_at)
) ENGINE=InnoDB;

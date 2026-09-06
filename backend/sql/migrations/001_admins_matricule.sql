-- ---------------------------------------------------------------------------
-- 001 — L'administrateur s'identifie par son matricule, non par un e-mail
--
-- Depuis la fusion, MarsaPort AI ne presente qu'une application et une seule
-- authentification. La console conserve un acces de secours direct, mais il
-- demandait une adresse e-mail la ou le portail demande un matricule : le meme
-- administrateur devait retenir deux identifiants pour un seul compte, et le
-- decompte des utilisateurs devenait faux.
--
-- A appliquer une seule fois sur une base deja creee. Une base neuve obtient
-- directement la bonne colonne par sql/init.sql.
-- ---------------------------------------------------------------------------

ALTER TABLE admins CHANGE COLUMN email matricule VARCHAR(100) NOT NULL;

-- CHANGE COLUMN conserve la contrainte d'unicite mais garde l'ancien nom
-- d'index : sans ce renommage, le schema porterait encore la trace du champ
-- e-mail des annees apres sa disparition.
ALTER TABLE admins RENAME INDEX email TO matricule;

-- Convertit l'adresse existante en matricule : on garde la partie locale,
-- ce qui transforme admin@marsamaroc.ma en admin.
UPDATE admins SET matricule = SUBSTRING_INDEX(matricule, '@', 1) WHERE matricule LIKE '%@%';

'use strict';

// Filtre de type de fichier : ce qui est accepte a l entree doit correspondre a
// ce que le controleur sait reellement extraire. Le .xlsx passait ce filtre sans
// jamais etre lu ensuite, produisant un document vide et silencieux.

const test = require('node:test');
const assert = require('node:assert');

const upload = require('../src/middlewares/upload');

/** Rejoue le fileFilter de multer sur un type MIME donne. */
function filtrer(mimetype) {
  return new Promise((resolve) => {
    upload.fileFilter({}, { mimetype, originalname: 'fichier' }, (erreur, accepte) =>
      resolve({ erreur, accepte })
    );
  });
}

test('les formats reellement traites sont acceptes', async () => {
  for (const type of ['application/pdf', 'text/plain', 'text/csv']) {
    const { erreur, accepte } = await filtrer(type);
    assert.strictEqual(erreur, null, `${type} ne doit pas etre refuse`);
    assert.strictEqual(accepte, true);
  }
});

test('le type MIME que Windows attribue aux CSV reste accepte', async () => {
  // Windows etiquette frequemment un .csv en application/vnd.ms-excel : le
  // refuser casserait l import de fichiers pourtant traitables.
  const { erreur, accepte } = await filtrer('application/vnd.ms-excel');
  assert.strictEqual(erreur, null);
  assert.strictEqual(accepte, true);
});

test('un classeur xlsx est refuse, puisque son contenu n est pas extrait', async () => {
  const { erreur } = await filtrer(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  assert.ok(erreur, 'le xlsx doit etre refuse');
  assert.strictEqual(erreur.status, 400, 'erreur imputable au client, pas au serveur');
});

test('le message d erreur annonce exactement les formats traites', async () => {
  const { erreur } = await filtrer('application/zip');
  assert.match(erreur.message, /PDF, TXT, CSV/);
  assert.ok(!/XLSX/i.test(erreur.message), 'le xlsx ne doit plus etre annonce');
});

test('les autres types sont refuses', async () => {
  for (const type of ['application/zip', 'image/png', 'application/x-msdownload', 'text/html']) {
    const { erreur } = await filtrer(type);
    assert.ok(erreur, `${type} doit etre refuse`);
    assert.strictEqual(erreur.status, 400);
  }
});

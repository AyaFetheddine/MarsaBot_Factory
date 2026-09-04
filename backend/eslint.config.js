// Configuration ESLint du backend.
// Ecrite en CommonJS parce que le backend l est entierement : package.json n a
// pas de "type": "module". Le frontend, lui, est en ESM et garde sa propre
// configuration ; seules les regles communes sont alignees.

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: ['node_modules/**', 'uploads/**', '.wwebjs_auth/**', '.wwebjs_cache/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Meme reglage que le frontend : une variable en MAJUSCULES peut etre
      // declaree sans etre utilisee (constantes de configuration).
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
];

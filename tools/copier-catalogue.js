// Copie le catalogue dans le dossier des fonctions avant chaque déploiement (Windows, macOS et Linux).
// Firebase lance ce script avec RESOURCE_DIR = le dossier « functions ».
const fs = require('node:fs'), path = require('node:path');
const cible = path.join(process.env.RESOURCE_DIR || path.join(__dirname, '..', 'functions'), 'catalogue');
fs.rmSync(cible, { recursive: true, force: true });
fs.cpSync(path.join(__dirname, '..', 'catalogue'), cible, { recursive: true, filter: (s) => !/__pycache__/.test(s) });
console.log('Catalogue copié dans', cible);

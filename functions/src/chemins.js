'use strict';
/*
 * Où trouver le catalogue (fiches, missions, scènes…). En développement, il est à la racine du projet ; une fois en
 * ligne, le déploiement le copie dans le dossier des fonctions (firebase.json, « predeploy »), car Firebase n'envoie
 * que ce dossier-là.
 */
const fs = require('node:fs');
const path = require('node:path');
const local = path.join(__dirname, '../catalogue');
module.exports = fs.existsSync(local) ? local : path.join(__dirname, '../../catalogue');

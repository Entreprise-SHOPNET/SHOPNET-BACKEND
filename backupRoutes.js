


// backupRoutes.js
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { exportDB } = require('./exportDB'); // Chemin vers ton exportDB.js

// Route pour générer le backup
router.get('/export-db', async (req, res) => {
    try {
        await exportDB();
        res.send('✔ Backup local créé : shopnet_backup_local.sql dans le dossier du projet');
    } catch (err) {
        console.error(err);
        res.status(500).send('Erreur lors de la création du backup');
    }
});

// Route pour télécharger le backup
router.get('/download-backup', (req, res) => {
    const file = path.join(__dirname, 'shopnet_backup_local.sql');
    if (!fs.existsSync(file)) return res.status(404).send('Le fichier backup n’existe pas.');
    res.download(file, 'shopnet_backup_local.sql', err => {
        if (err) console.error(err);
    });
});

module.exports = router;

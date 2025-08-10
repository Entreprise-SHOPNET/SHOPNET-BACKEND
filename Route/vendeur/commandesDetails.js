

const express = require('express');
const router = express.Router();
const db = require('../../db'); // connexion MySQL (mysql2/promise)
const authenticateToken = require('../../middlewares/authMiddleware');

const EXPIRATION_DELAY = 30 * 24 * 60 * 60 * 1000; // 30 jours

// GET /api/commandes/:id
router.get('/:id', authenticateToken, async (req, res) => {
  const commandeId = req.params.id;

  try {
    // 1. Récupérer la commande + client
    const [commandeRows] = await db.query(`
      SELECT 
        c.id AS commandeId, 
        c.date_commande, 
        c.status, 
        c.total, 
        c.mode_paiement,
        u.fullName AS clientNom, 
        u.phone AS clientTel, 
        u.email AS clientEmail, 
        u.address AS clientAdresse
      FROM commandes c
      JOIN utilisateurs u ON c.acheteur_id = u.id
      WHERE c.id = ?
      LIMIT 1
    `, [commandeId]);

    if (commandeRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Commande non trouvée' });
    }

    const commande = commandeRows[0];

    // 2. Vérifier expiration
    const dateCommande = new Date(commande.date_commande);
    const now = new Date();

    if (commande.status !== 'expirée' && now - dateCommande > EXPIRATION_DELAY) {
      await db.query(`UPDATE commandes SET status = 'expirée' WHERE id = ?`, [commandeId]);
      commande.status = 'expirée';
    }

    // 3. Récupérer les produits liés à la commande
    const [produits] = await db.query(`
      SELECT 
        p.id,
        p.title,
        cp.quantite,
        cp.prix_unitaire AS prix_unitaire_commande,
        (
          SELECT pi.absolute_url 
          FROM product_images pi 
          WHERE pi.product_id = p.id 
          ORDER BY pi.id ASC 
          LIMIT 1
        ) AS image_url
      FROM commande_produits cp
      JOIN products p ON cp.produit_id = p.id
      WHERE cp.commande_id = ?
    `, [commandeId]);

    // 4. Réponse JSON
    const response = {
      commandeId: commande.commandeId,
      date_commande: commande.date_commande,
      statut: commande.status,
      total: commande.total,
      mode_paiement: commande.mode_paiement,
      client: {
        nom: commande.clientNom,
        telephone: commande.clientTel,
        email: commande.clientEmail,
        adresse: commande.clientAdresse,
      },
      produits: produits.map(p => ({
        id: p.id,
        nom: p.title,
        prix_unitaire: p.prix_unitaire_commande,
        quantite: p.quantite,
        image: p.image_url || null,
      })),
    };

    res.json({ success: true, commande: response });
  } catch (error) {
    console.error('Erreur récupération commande:', error);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

module.exports = router;

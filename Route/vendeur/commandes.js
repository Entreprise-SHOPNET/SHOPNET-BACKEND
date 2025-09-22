




const express = require('express');
const router = express.Router();
const pool = require('../../db');
const authMiddleware = require('../../middlewares/authMiddleware');
const axios = require('axios');

router.use(authMiddleware);

// --- Créer une commande ---
router.post('/', async (req, res) => {
  try {
    const acheteur_id = req.userId;
    const { produits, adresse_livraison, mode_paiement, commentaire } = req.body;

    if (!produits || !Array.isArray(produits) || produits.length === 0 || !adresse_livraison) {
      return res.status(400).json({ success: false, error: 'Données manquantes ou invalides' });
    }

    const [prodRow] = await pool.query(
      'SELECT seller_id, title, price FROM products WHERE id = ?',
      [produits[0].produit_id]
    );

    if (prodRow.length === 0) {
      return res.status(404).json({ success: false, error: 'Produit non trouvé' });
    }

    const vendeur_id = prodRow[0].seller_id;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Calcul total
      let totalCommande = 0;
      for (const p of produits) {
        const [pRow] = await conn.query('SELECT price FROM products WHERE id = ?', [p.produit_id]);
        totalCommande += pRow[0].price * p.quantite;
      }

      // Dernier numero_commande
      const [rows] = await conn.query(
        'SELECT MAX(numero_commande) AS dernier FROM commandes WHERE vendeur_id = ?',
        [vendeur_id]
      );
      const numero_commande = (rows[0].dernier || 0) + 1;

      // Insérer commande
      const [result] = await conn.query(
        `INSERT INTO commandes 
          (acheteur_id, vendeur_id, numero_commande, status, total, mode_paiement, adresse_livraison, commentaire, date_commande) 
         VALUES (?, ?, ?, 'en_attente', ?, ?, ?, ?, NOW())`,
        [acheteur_id, vendeur_id, numero_commande, totalCommande, mode_paiement || 'especes', adresse_livraison, commentaire || null]
      );

      const commandeId = result.insertId;

      // Lier produits
      for (const p of produits) {
        const [pRow] = await conn.query('SELECT price FROM products WHERE id = ?', [p.produit_id]);
        await conn.query(
          `INSERT INTO commande_produits 
           (commande_id, produit_id, quantite, prix_unitaire) 
           VALUES (?, ?, ?, ?)`,
          [commandeId, p.produit_id, p.quantite, pRow[0].price]
        );
      }

      await conn.commit();
      conn.release();

      return res.json({ success: true, commandeId, numero_commande });
    } catch (err) {
      await conn.rollback();
      conn.release();
      console.error('Transaction commande error:', err);
      return res.status(500).json({ success: false, error: 'Erreur pendant la transaction' });
    }
  } catch (err) {
    console.error('POST /commandes error:', err);
    return res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// --- Voir mes commandes (acheteur ou vendeur) ---
router.get('/', async (req, res) => {
  try {
    const utilisateur_id = req.userId;
    const { role } = req.query;

    let query = `
      SELECT c.*, u1.fullName AS acheteur_nom, u2.fullName AS vendeur_nom, u1.telephone AS acheteur_telephone
      FROM commandes c
      JOIN utilisateurs u1 ON c.acheteur_id = u1.id
      JOIN utilisateurs u2 ON c.vendeur_id = u2.id
    `;
    const params = [];

    if (role === 'vendeur') {
      query += ' WHERE c.vendeur_id = ? ORDER BY c.date_commande DESC';
      params.push(utilisateur_id);
    } else {
      query += ' WHERE c.acheteur_id = ? ORDER BY c.date_commande DESC';
      params.push(utilisateur_id);
    }

    const [rows] = await pool.query(query, params);
    return res.json({ success: true, commandes: rows });
  } catch (err) {
    console.error('GET /commandes error:', err);
    return res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// --- Changer le statut d’une commande + WhatsApp ---
router.put('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const validStatuses = ['en_attente', 'confirmee', 'livree', 'annulee'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: 'Statut invalide' });
    }

    // Mettre à jour le statut
    const [result] = await pool.query(
      'UPDATE commandes SET status = ? WHERE id = ?',
      [status, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Commande non trouvée' });
    }

    // Récup infos acheteur
    const [rows] = await pool.query(
      'SELECT c.numero_commande, u.fullName AS acheteur_nom, u.telephone AS acheteur_telephone FROM commandes c JOIN utilisateurs u ON c.acheteur_id = u.id WHERE c.id = ?',
      [id]
    );
    const commande = rows[0];

    // Préparer message WhatsApp
    let message = '';
    if (status === 'confirmee') {
      message = `Bonjour ${commande.acheteur_nom} 👋, votre commande #${commande.numero_commande} a été **acceptée** par le vendeur. Merci pour votre achat !`;
    } else if (status === 'annulee') {
      message = `Bonjour ${commande.acheteur_nom} 👋, votre commande #${commande.numero_commande} a été **refusée** par le vendeur. Pour plus d’infos, contactez-le.`;
    }

    // Envoyer WhatsApp via wa.me (facultatif)
    if (message) {
      const phone = commande.acheteur_telephone.replace(/^\+?0?/, '243'); // RDC
      const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
      // Ici tu peux soit envoyer via un webhook, soit juste fournir le lien
      console.log('WhatsApp URL:', waUrl);
    }

    return res.json({ success: true, message: 'Statut mis à jour', statut: status });
  } catch (err) {
    console.error('PUT /commandes/:id/status error:', err);
    return res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

module.exports = router;

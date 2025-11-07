


const express = require('express');
const router = express.Router();
const authenticate = require('../../middlewares/authMiddleware');
const db = require('../../db'); // instance mysql2/promise
const sendPushNotification = require('../../utils/sendPushNotification'); // ✅ ajout push

// POST /api/products/:productId/share
router.post('/:productId/share', authenticate, async (req, res) => {
  const userId = req.userId || null;
  const productId = parseInt(req.params.productId, 10);

  if (isNaN(productId)) {
    return res.status(400).json({ success: false, message: 'ID produit invalide' });
  }

  try {
    // Vérifie que le produit existe et récupère seller_id
    const [productRows] = await db.query('SELECT id, seller_id FROM products WHERE id = ?', [productId]);
    if (productRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Produit non trouvé' });
    }
    const product = productRows[0];

    // Incrémente le compteur de partages
    await db.query(`
      UPDATE products
      SET shares_count = shares_count + 1
      WHERE id = ?`, [productId]);

    // Log dans la table des partages
    await db.query(
      'INSERT INTO product_shares (product_id, user_id) VALUES (?, ?)',
      [productId, userId]
    );

    // 🔔 Notification push au vendeur
    const [sellerRows] = await db.query('SELECT expoPushToken FROM utilisateurs WHERE id = ?', [product.seller_id]);
    if (sellerRows.length > 0 && sellerRows[0].expoPushToken) {
      await sendPushNotification(
        sellerRows[0].expoPushToken,
        'Produit Partagé !',
        `🚀 Super ! Votre produit gagne en visibilité sur SHOPNET. Chaque partage attire de nouveaux clients et renforce votre présence !`
        ,
                { productId }
      );
    }

    return res.json({ success: true, message: 'Partage enregistré' });

  } catch (err) {
    console.error('Erreur lors du partage :', err);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

module.exports = router;

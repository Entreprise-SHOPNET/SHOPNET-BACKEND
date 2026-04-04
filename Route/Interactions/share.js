


const express = require('express');
const router = express.Router();

const authenticate = require('../../middlewares/authMiddleware');
const db = require('../../db');
const sendPushNotification = require('../../utils/sendPushNotification');

/**
 * POST /api/products/:productId/share
 */
router.post('/:productId/share', authenticate, async (req, res) => {
  const userId = req.userId || null;
  const productId = parseInt(req.params.productId, 10);

  if (isNaN(productId)) {
    return res.status(400).json({
      success: false,
      message: 'ID produit invalide'
    });
  }

  try {
    // 🔹 Vérifier produit
    const [productRows] = await db.query(
      'SELECT id, seller_id FROM products WHERE id = ?',
      [productId]
    );

    if (productRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Produit non trouvé'
      });
    }

    const product = productRows[0];

    // 🔹 Incrémenter shares
    await db.query(
      `UPDATE products 
       SET shares_count = shares_count + 1 
       WHERE id = ?`,
      [productId]
    );

    // 🔹 Logger partage
    await db.query(
      'INSERT INTO product_shares (product_id, user_id) VALUES (?, ?)',
      [productId, userId]
    );

    console.log('🔹 Partage enregistré:', { productId, userId });

    // 🔔 NOTIFICATION FCM (CORRIGÉE)
    const [sellerRows] = await db.query(
      'SELECT fcm_token FROM fcm_tokens WHERE user_id = ?',
      [product.seller_id]
    );

    if (sellerRows.length > 0 && sellerRows[0].fcm_token) {
      await sendPushNotification(
        sellerRows[0].fcm_token,
        '🚀 Produit partagé !',
        'Votre produit gagne en visibilité sur SHOPNET',
        { productId }
      );
    } else {
      console.warn('⚠️ Aucun token FCM vendeur:', product.seller_id);
    }

    return res.json({
      success: true,
      message: 'Partage enregistré'
    });

  } catch (err) {
    console.error('❌ Erreur lors du partage :', err);
    return res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
});

module.exports = router;

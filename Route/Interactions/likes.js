



const express = require('express');
const router = express.Router();

const authenticate = require('../../middlewares/authMiddleware');
const db = require('../../db');
const sendPushNotification = require('../../utils/sendPushNotification');

/**
 * POST /api/interactions/:productId/like
 */
router.post('/:productId/like', authenticate, async (req, res) => {
  const userId = req.userId;
  const productId = parseInt(req.params.productId, 10);

  console.log('🔹 Début handle like:', { userId, productId });

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

    // 🔹 Vérifier like existant
    const [existingLikes] = await db.query(
      'SELECT id FROM product_likes WHERE product_id = ? AND user_id = ?',
      [productId, userId]
    );

    if (existingLikes.length === 0) {
      // ➕ LIKE
      await db.query(
        'INSERT INTO product_likes (product_id, user_id) VALUES (?, ?)',
        [productId, userId]
      );

      await db.query(
        'UPDATE products SET likes_count = likes_count + 1 WHERE id = ?',
        [productId]
      );

      console.log('🔹 Like ajouté:', productId);

      // 🔔 NOUVEAU SYSTÈME FCM (CORRIGÉ)
      const [sellerRows] = await db.query(
        'SELECT fcm_token FROM fcm_tokens WHERE user_id = ?',
        [product.seller_id]
      );

      if (sellerRows.length > 0 && sellerRows[0].fcm_token) {
        console.log('🔹 Envoi notification vendeur:', product.seller_id);

        await sendPushNotification(
          sellerRows[0].fcm_token,
          '💥 Nouveau Like !',
          'Votre produit attire de l’attention sur SHOPNET',
          { productId }
        );
      } else {
        console.warn('⚠️ Aucun token FCM pour vendeur:', product.seller_id);
      }

      return res.json({
        success: true,
        liked: true,
        message: 'Like ajouté'
      });

    } else {
      // ❌ UNLIKE
      await db.query(
        'DELETE FROM product_likes WHERE product_id = ? AND user_id = ?',
        [productId, userId]
      );

      await db.query(
        `UPDATE products 
         SET likes_count = CASE WHEN likes_count > 0 THEN likes_count - 1 ELSE 0 END 
         WHERE id = ?`,
        [productId]
      );

      console.log('🔹 Like retiré:', productId);

      return res.json({
        success: true,
        liked: false,
        message: 'Like retiré'
      });
    }

  } catch (error) {
    console.error('❌ Erreur lors du like:', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
});

module.exports = router;

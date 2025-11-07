



const express = require('express');
const router = express.Router();

const authenticate = require('../../middlewares/authMiddleware');
const db = require('../../db'); // mysql2/promise
const sendPushNotification = require('../../utils/sendPushNotification'); // push

/**
 * POST /api/interactions/:productId/like
 * Permet à un utilisateur de liker ou disliker un produit (toggle).
 */
router.post('/:productId/like', authenticate, async (req, res) => {
  const userId = req.userId;
  const productId = parseInt(req.params.productId, 10);

  console.log('🔹 Début handle like:', { userId, productId });

  if (isNaN(productId)) {
    console.warn('⚠️ ID produit invalide:', req.params.productId);
    return res.status(400).json({ success: false, message: 'ID produit invalide' });
  }

  try {
    // Vérifie si le produit existe
    const [productRows] = await db.query(
      'SELECT id, seller_id FROM products WHERE id = ?',
      [productId]
    );
    if (productRows.length === 0) {
      console.warn('⚠️ Produit non trouvé:', productId);
      return res.status(404).json({ success: false, message: 'Produit non trouvé' });
    }
    const product = productRows[0];
    console.log('🔹 Produit trouvé:', product);

    // Vérifie si l'utilisateur a déjà liké
    const [existingLikes] = await db.query(
      'SELECT id FROM product_likes WHERE product_id = ? AND user_id = ?',
      [productId, userId]
    );

    if (existingLikes.length === 0) {
      // Ajoute un like
      await db.query(
        'INSERT INTO product_likes (product_id, user_id) VALUES (?, ?)',
        [productId, userId]
      );
      await db.query(
        'UPDATE products SET likes_count = likes_count + 1 WHERE id = ?',
        [productId]
      );
      console.log('🔹 Like ajouté pour productId:', productId);

      // Récupère le token du vendeur
      const [sellerRows] = await db.query(
        'SELECT expoPushToken FROM utilisateurs WHERE id = ?',
        [product.seller_id]
      );
      console.log('🔹 Seller info:', sellerRows);

      if (sellerRows.length > 0 && sellerRows[0].expoPushToken) {
        console.log('🔹 Envoi notification au vendeur:', product.seller_id);
        await sendPushNotification(
          sellerRows[0].expoPushToken,
          'Nouveau Like !',
          `💥 Votre produit attire l'attention sur SHOPNET !`,
          { productId }
        );
      } else {
        console.warn('⚠️ Pas de token Expo pour le vendeur:', product.seller_id);
      }

      return res.json({ success: true, liked: true, message: 'Like ajouté' });
    } else {
      // Supprime le like
      await db.query(
        'DELETE FROM product_likes WHERE product_id = ? AND user_id = ?',
        [productId, userId]
      );
      await db.query(
        `UPDATE products SET likes_count = CASE WHEN likes_count > 0 THEN likes_count - 1 ELSE 0 END WHERE id = ?`,
        [productId]
      );
      console.log('🔹 Like retiré pour productId:', productId);

      return res.json({ success: true, liked: false, message: 'Like retiré' });
    }
  } catch (error) {
    console.error('❌ Erreur lors du like:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

module.exports = router;

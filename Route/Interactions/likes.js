

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

      // ---------------------------------------------------------
      // 🖼️ RÉCUPÉRER IMAGE PRODUIT
      // ---------------------------------------------------------
      const [imageRows] = await db.query(
        'SELECT image_path FROM product_images WHERE product_id = ? LIMIT 1',
        [productId]
      );

      let imageUrl = null;

      if (imageRows.length > 0) {
        const CLOUDINARY_BASE = `https://res.cloudinary.com/${process.env.CLOUD_NAME}/image/upload/`;

        imageUrl = imageRows[0].image_path.startsWith("http")
          ? imageRows[0].image_path
          : `${CLOUDINARY_BASE}${imageRows[0].image_path}`;
      }

      // ---------------------------------------------------------
      // 🔔 NOTIFICATION VENDEUR AVEC IMAGE
      // ---------------------------------------------------------
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
          {
            productId,
            image: imageUrl
          }
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




router.post('/trend/push', async (req, res) => {
  try {

    // =====================================================
    // 🔥 TOP PRODUITS TREND
    // =====================================================
    const [products] = await db.query(`
      SELECT 
        p.id,
        p.title,
        p.seller_id,
        COUNT(DISTINCT l.id) AS likes,
        COUNT(DISTINCT v.id) AS views,
        COUNT(DISTINCT c.user_id) AS carts
      FROM products p
      LEFT JOIN product_likes l ON l.product_id = p.id
      LEFT JOIN product_views v ON v.product_id = p.id
      LEFT JOIN carts c ON c.product_id = p.id
      GROUP BY p.id
      ORDER BY (
        COUNT(DISTINCT l.id)*3 + 
        COUNT(DISTINCT v.id) + 
        COUNT(DISTINCT c.user_id)*2
      ) DESC
      LIMIT 5
    `);

    if (!products.length) {
      return res.json({
        success: true,
        message: 'Aucun produit tendance'
      });
    }

    const trending = products[0];

    // =====================================================
    // 🖼 IMAGE PRODUIT
    // =====================================================
    const [imageRows] = await db.query(
      'SELECT image_path FROM product_images WHERE product_id = ? LIMIT 1',
      [trending.id]
    );

    let imageUrl = null;

    if (imageRows.length > 0) {
      const CLOUDINARY_BASE = `https://res.cloudinary.com/${process.env.CLOUD_NAME}/image/upload/`;

      imageUrl = imageRows[0].image_path.startsWith('http')
        ? imageRows[0].image_path
        : CLOUDINARY_BASE + imageRows[0].image_path;
    }

    // =====================================================
    // 👥 USERS
    // =====================================================
    const [users] = await db.query(`
      SELECT u.id, f.fcm_token
      FROM utilisateurs u
      JOIN fcm_tokens f ON f.user_id = u.id
      WHERE f.fcm_token IS NOT NULL
    `);

    // =====================================================
    // 🔔 PUSH NOTIFICATION
    // =====================================================
    for (const user of users) {
      await sendPushNotification(
        user.fcm_token,
        '🔥 Produit tendance sur SHOPNET',
        `${trending.title} est très populaire en ce moment`,
        {
          productId: trending.id,
          type: 'trend',
          image: imageUrl
        }
      );
    }

    return res.json({
      success: true,
      message: 'Trend push envoyé',
      productId: trending.id,
      users: users.length
    });

  } catch (error) {
    console.error('❌ Trend push error:', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
});

module.exports = router;




const express = require('express');
const router = express.Router();

const authenticate = require('../../middlewares/authMiddleware');
const db = require('../../db');
const sendPushNotification = require('../../utils/sendPushNotification');



// -----------------------------------------------------
// 🚀 PARTAGE PRODUIT + NOTIFICATION VENDEUR
// -----------------------------------------------------
router.post('/:productId/share', authenticate, async (req, res) => {
  const userId = req.userId;
  const productId = parseInt(req.params.productId, 10);

  if (isNaN(productId)) {
    return res.status(400).json({
      success: false,
      message: 'ID produit invalide'
    });
  }

  try {

    // -------------------------------------------------
    // 1️⃣ Vérifier produit
    // -------------------------------------------------
    const [productRows] = await db.query(
      'SELECT id, seller_id, title FROM products WHERE id = ?',
      [productId]
    );

    if (productRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Produit introuvable'
      });
    }

    const product = productRows[0];



    // -------------------------------------------------
    // 2️⃣ UPDATE shares_count
    // -------------------------------------------------
    await db.query(
      `UPDATE products 
       SET shares_count = COALESCE(shares_count, 0) + 1 
       WHERE id = ?`,
      [productId]
    );



    // -------------------------------------------------
    // 3️⃣ LOG SHARE
    // -------------------------------------------------
    await db.query(
      `INSERT INTO product_shares (product_id, user_id) VALUES (?, ?)`,
      [productId, userId]
    );

    console.log('🔹 Partage enregistré:', { productId, userId });



    // -------------------------------------------------
    // 4️⃣ PUSH NOTIFICATION VENDEUR (FCM SAFE)
    // -------------------------------------------------
    if (product.seller_id) {

      const [sellerRows] = await db.query(
        'SELECT fcm_token FROM fcm_tokens WHERE user_id = ?',
        [product.seller_id]
      );

      const token = sellerRows[0]?.fcm_token;

      if (token) {
        try {
          await sendPushNotification(
            token,
            '🚀 Produit partagé !',
            `Ton produit "${product.title}" est partagé et gagne en visibilité sur SHOPNET`,
            {
              productId,
              type: 'share'
            }
          );

          console.log('🔔 Notification partage envoyée');

        } catch (err) {
          console.error('❌ FCM SHARE ERROR:', err.message);
        }
      } else {
        console.warn('⚠️ Aucun token FCM vendeur:', product.seller_id);
      }
    }



    return res.json({
      success: true,
      message: 'Partage enregistré avec succès'
    });

  } catch (err) {
    console.error('❌ SHARE ERROR:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      details: err.message
    });
  }
});

module.exports = router;

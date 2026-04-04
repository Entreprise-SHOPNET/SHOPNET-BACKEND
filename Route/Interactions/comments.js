

const express = require('express');
const router = express.Router();

const authMiddleware = require('../../middlewares/authMiddleware');
const db = require('../../db');
const sendPushNotification = require('../../utils/sendPushNotification');



// -----------------------------------------------------
// 💬 AJOUT COMMENTAIRE + NOTIFICATION VENDEUR
// -----------------------------------------------------
router.post('/:productId/comment', authMiddleware, async (req, res) => {
  const userId = req.userId;
  const productId = parseInt(req.params.productId, 10);

  let { comment, parent_id } = req.body;

  if (!comment || typeof comment !== 'string' || comment.trim() === '') {
    return res.status(400).json({
      success: false,
      message: 'Commentaire vide'
    });
  }

  comment = comment.trim();
  parent_id = parent_id ? parseInt(parent_id, 10) : null;

  try {

    // -------------------------------------------------
    // 1️⃣ PRODUIT
    // -------------------------------------------------
    const [productRows] = await db.query(
      'SELECT id, seller_id FROM products WHERE id = ?',
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
    // 2️⃣ INSERT COMMENTAIRE
    // -------------------------------------------------
    await db.query(
      `INSERT INTO product_comments 
      (product_id, user_id, parent_id, comment) 
      VALUES (?, ?, ?, ?)`,
      [productId, userId, parent_id, comment]
    );

    console.log('🔹 Commentaire ajouté:', { productId, userId });



    // -------------------------------------------------
    // 3️⃣ NOTIFICATION VENDEUR (FCM SAFE)
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
            '💬 Nouveau commentaire',
            'Quelqu’un a commenté votre produit sur SHOPNET',
            {
              productId,
              type: 'comment'
            }
          );

          console.log('🔔 Notification commentaire envoyée');

        } catch (err) {
          console.error('❌ FCM COMMENT ERROR:', err.message);
        }
      } else {
        console.warn('⚠️ Aucun token FCM vendeur:', product.seller_id);
      }
    }



    return res.json({
      success: true,
      message: 'Commentaire ajouté avec succès'
    });

  } catch (error) {
    console.error('❌ Erreur commentaire:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      details: error.message
    });
  }
});



// -----------------------------------------------------
// 📥 GET commentaires
// -----------------------------------------------------
router.get('/:productId/comments', async (req, res) => {
  const productId = parseInt(req.params.productId, 10);

  try {
    const [comments] = await db.query(
      `SELECT c.*, u.fullName 
       FROM product_comments c
       LEFT JOIN utilisateurs u ON c.user_id = u.id
       WHERE c.product_id = ?
       ORDER BY c.created_at ASC`,
      [productId]
    );

    return res.json({
      success: true,
      comments
    });

  } catch (error) {
    console.error('❌ GET comments error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
});



// -----------------------------------------------------
// 🔢 COUNT commentaires
// -----------------------------------------------------
router.get('/:productId/comments/count', async (req, res) => {
  const productId = parseInt(req.params.productId, 10);

  try {
    const [rows] = await db.query(
      'SELECT COUNT(*) AS total FROM product_comments WHERE product_id = ?',
      [productId]
    );

    return res.json({
      success: true,
      count: rows[0].total
    });

  } catch (error) {
    console.error('❌ COUNT comments error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
});

module.exports = router;

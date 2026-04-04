

const express = require('express');
const router = express.Router();

const authMiddleware = require('../../middlewares/authMiddleware');
const db = require('../../db');
const sendPushNotification = require('../../utils/sendPushNotification');

/**
 * POST - Ajouter commentaire / réponse
 */
router.post('/:productId/comment', authMiddleware, async (req, res) => {
  const userId = req.userId;
  const productId = parseInt(req.params.productId, 10);
  let { comment, parent_id } = req.body;

  if (!comment || typeof comment !== 'string' || comment.trim() === '') {
    return res.status(400).json({
      success: false,
      message: 'Le commentaire est vide.'
    });
  }

  comment = comment.trim();
  parent_id = parent_id ? parseInt(parent_id, 10) : null;
  if (isNaN(parent_id)) parent_id = null;

  try {
    // 🔹 Vérifier produit
    const [productCheck] = await db.query(
      'SELECT id, seller_id FROM products WHERE id = ?',
      [productId]
    );

    if (productCheck.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Produit introuvable.'
      });
    }

    const product = productCheck[0];

    // 🔹 Vérifier utilisateur
    const [userCheck] = await db.query(
      'SELECT id FROM utilisateurs WHERE id = ?',
      [userId]
    );

    if (userCheck.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Utilisateur non reconnu.'
      });
    }

    // 🔹 Vérifier parent commentaire
    if (parent_id !== null) {
      const [parentCheck] = await db.query(
        'SELECT id FROM product_comments WHERE id = ? AND product_id = ?',
        [parent_id, productId]
      );

      if (parentCheck.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Commentaire parent introuvable.'
        });
      }
    }

    // 🔹 Insérer commentaire
    await db.query(
      'INSERT INTO product_comments (product_id, user_id, parent_id, comment) VALUES (?, ?, ?, ?)',
      [productId, userId, parent_id, comment]
    );

    console.log('🔹 Commentaire ajouté:', { productId, userId });

    // 🔔 NOTIFICATION FCM
    const [sellerRows] = await db.query(
      'SELECT fcm_token FROM fcm_tokens WHERE user_id = ?',
      [product.seller_id]
    );

    if (sellerRows.length > 0 && sellerRows[0].fcm_token) {
      await sendPushNotification(
        sellerRows[0].fcm_token,
        '💬 Nouveau commentaire',
        'Un utilisateur a commenté votre produit sur SHOPNET',
        { productId }
      );
    } else {
      console.warn('⚠️ Aucun token FCM vendeur:', product.seller_id);
    }

    return res.json({
      success: true,
      message: 'Commentaire ajouté avec succès'
    });

  } catch (error) {
    console.error('❌ Erreur ajout commentaire :', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
});

/**
 * GET - Récupérer les commentaires
 */
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
    console.error('❌ Erreur récupération commentaires :', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
});

/**
 * GET - Compteur de commentaires
 */
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
    console.error('❌ Erreur compteur commentaires :', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
});

// ✅ IMPORTANT (corrige ton crash)
module.exports = router;

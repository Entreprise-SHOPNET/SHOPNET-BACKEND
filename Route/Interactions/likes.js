



const express = require('express');
const router = express.Router();

const authenticate = require('../../middlewares/authMiddleware');
const db = require('../../db'); // mysql2/promise

/**
 * POST /api/interactions/:productId/like
 * Permet à un utilisateur de liker ou disliker un produit (toggle).
 */
router.post('/:productId/like', authenticate, async (req, res) => {
  const userId = req.userId;
  const productId = parseInt(req.params.productId, 10);

  if (isNaN(productId)) {
    return res.status(400).json({ success: false, message: 'ID produit invalide' });
  }

  try {
    // Vérifie si le produit existe
    const [productRows] = await db.query('SELECT id FROM products WHERE id = ?', [productId]);
    if (productRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Produit non trouvé' });
    }

    // Vérifie si l'utilisateur a déjà liké le produit
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

      // Incrémente le compteur de likes
      await db.query(
        'UPDATE products SET likes_count = likes_count + 1 WHERE id = ?',
        [productId]
      );

      return res.json({ success: true, liked: true, message: 'Like ajouté' });
    } else {
      // Supprime le like
      await db.query(
        'DELETE FROM product_likes WHERE product_id = ? AND user_id = ?',
        [productId, userId]
      );

      // Décrémente le compteur de likes avec sécurité
      await db.query(
        `UPDATE products SET likes_count = CASE WHEN likes_count > 0 THEN likes_count - 1 ELSE 0 END WHERE id = ?`,
        [productId]
      );

      return res.json({ success: true, liked: false, message: 'Like retiré' });
    }
  } catch (error) {
    console.error('Erreur lors du like:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

module.exports = router;

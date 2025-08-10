


const express = require('express');
const router = express.Router();
const authenticate = require('../../middlewares/authMiddleware');
const db = require('../../db'); // instance mysql2/promise

// POST /api/products/:productId/share
router.post('/:productId/share', authenticate, async (req, res) => {
  const userId = req.userId || null;
  const productId = parseInt(req.params.productId, 10);

  if (isNaN(productId)) {
    return res.status(400).json({ success: false, message: 'ID produit invalide' });
  }

  try {
    // Vérifie que le produit existe
    const [productRows] = await db.query('SELECT id FROM products WHERE id = ?', [productId]);
    if (productRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Produit non trouvé' });
    }

    // Incrémente le compteur
    await db.query(`
      UPDATE products
      SET shares_count = shares_count + 1
      WHERE id = ?`, [productId]);

    // (Optionnel) Log dans une table de logs
    await db.query(
      'INSERT INTO product_shares (product_id, user_id) VALUES (?, ?)',
      [productId, userId]
    );

    return res.json({ success: true, message: 'Partage enregistré' });

  } catch (err) {
    console.error('Erreur lors du partage :', err);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

module.exports = router;

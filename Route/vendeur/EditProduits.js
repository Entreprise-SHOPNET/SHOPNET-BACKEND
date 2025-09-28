

// Route/productsUpdate.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../../middlewares/authMiddleware');

// Catégories autorisées (reprend ton frontend)
const ALLOWED_CATEGORIES = ["Tendance", "Mode", "Tech", "Maison", "Beauté"];

/**
 * PUT /api/products/:id
 */
router.put('/:id', authMiddleware, async (req, res, next) => {
  const db = req.db; // pool mysql2/promise injecté dans server.js
  const productId = req.params.id;
  const userId = req.userId;

  try {
    const { title, description, price, category } = req.body ?? {};

    // Validation des champs
    if (!title || title.trim().length < 2) {
      return res.status(400).json({ success: false, message: 'Titre invalide' });
    }
    if (!description || description.trim().length < 5) {
      return res.status(400).json({ success: false, message: 'Description invalide' });
    }
    if (price === undefined || isNaN(Number(price)) || Number(price) < 0) {
      return res.status(400).json({ success: false, message: 'Prix invalide' });
    }
    if (!category || !ALLOWED_CATEGORIES.includes(category)) {
      return res.status(400).json({ success: false, message: 'Catégorie invalide' });
    }

    // Vérifier que le produit existe
    const [rows] = await db.execute('SELECT id, seller_id FROM products WHERE id = ?', [productId]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Produit non trouvé' });
    }
    const product = rows[0];

    // Vérifier l'appartenance
    if (String(product.seller_id) !== String(userId)) {
      return res.status(403).json({ success: false, message: 'Accès refusé : vous ne possédez pas ce produit' });
    }

    // Mise à jour
    const updateQuery = `
      UPDATE products
      SET title = ?, description = ?, price = ?, category = ?, updated_at = NOW()
      WHERE id = ?
    `;
    const [result] = await db.execute(updateQuery, [title.trim(), description.trim(), Number(price), category, productId]);

    if (result.affectedRows === 0) {
      return res.status(500).json({ success: false, message: 'Erreur lors de la mise à jour' });
    }

    // Récupérer le produit mis à jour
    const [updatedRows] = await db.execute(
      'SELECT id, title, description, price, category, seller_id, updated_at FROM products WHERE id = ?',
      [productId]
    );

    return res.status(200).json({ success: true, message: 'Produit mis à jour', product: updatedRows[0] });

  } catch (err) {
    console.error('Erreur PUT /products/:id', err);
    next(err);
  }
});

module.exports = router;

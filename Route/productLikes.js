/**

// routes/productLikes.js
const express = require('express');
const router = express.Router();
const db = require('../db'); // connexion MySQL configurée

// Middleware pour vérifier que seller_id est fourni (à adapter selon ton système d'auth)
function verifySellerId(req, res, next) {
  const sellerId = req.body.seller_id || req.query.seller_id;
  if (!sellerId) return res.status(400).json({ error: 'seller_id requis' });
  next();
}

// Ajouter un like (ou ignorer si déjà liké)
router.post('/like', verifySellerId, async (req, res) => {
  const { product_id, seller_id } = req.body;
  if (!product_id) return res.status(400).json({ error: 'product_id requis' });

  try {
    // On utilise INSERT IGNORE pour éviter doublon (car PRIMARY KEY composite)
    const sql = `INSERT IGNORE INTO product_likes (product_id, seller_id) VALUES (?, ?)`;
    const [result] = await db.execute(sql, [product_id, seller_id]);

    if (result.affectedRows === 0) {
      return res.status(200).json({ message: 'Déjà liké' });
    }

    res.status(201).json({ message: 'Like ajouté' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Retirer un like
router.post('/unlike', verifySellerId, async (req, res) => {
  const { product_id, seller_id } = req.body;
  if (!product_id) return res.status(400).json({ error: 'product_id requis' });

  try {
    const sql = `DELETE FROM product_likes WHERE product_id = ? AND seller_id = ?`;
    const [result] = await db.execute(sql, [product_id, seller_id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Like non trouvé' });
    }

    res.status(200).json({ message: 'Like retiré' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Récupérer le nombre de likes d'un produit
router.get('/count/:product_id', async (req, res) => {
  const product_id = req.params.product_id;
  try {
    const sql = `SELECT COUNT(*) AS like_count FROM product_likes WHERE product_id = ?`;
    const [rows] = await db.execute(sql, [product_id]);
    res.json({ product_id, like_count: rows[0].like_count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

*/
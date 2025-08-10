

const express = require('express');
const router = express.Router();
const authMiddleware = require('../../middlewares/authMiddleware');
const db = require('../../db'); // mysql2 promise pool

// POST - Ajouter un commentaire ou réponse
router.post('/:productId/comment', authMiddleware, async (req, res) => {
  const userId = req.userId;
  const productId = parseInt(req.params.productId, 10);
  let { comment, parent_id } = req.body;

  if (!comment || typeof comment !== 'string' || comment.trim() === '') {
    return res.status(400).json({ success: false, message: 'Le commentaire est vide.' });
  }

  comment = comment.trim();
  parent_id = parent_id !== null && parent_id !== undefined ? parseInt(parent_id, 10) : null;
  if (isNaN(parent_id)) parent_id = null;

  try {
    // Vérifier existence produit
    const [productCheck] = await db.query('SELECT id FROM products WHERE id = ?', [productId]);
    if (productCheck.length === 0) {
      return res.status(404).json({ success: false, message: 'Produit introuvable.' });
    }

    // Vérifier existence utilisateur
    const [userCheck] = await db.query('SELECT id FROM utilisateurs WHERE id = ?', [userId]);
    if (userCheck.length === 0) {
      return res.status(401).json({ success: false, message: 'Utilisateur non reconnu.' });
    }

    // Si réponse, vérifier que commentaire parent existe
    if (parent_id !== null) {
      const [parentCheck] = await db.query(
        'SELECT id FROM product_comments WHERE id = ? AND product_id = ?',
        [parent_id, productId]
      );
      if (parentCheck.length === 0) {
        return res.status(400).json({ success: false, message: 'Commentaire parent introuvable.' });
      }
    }

    // Insérer le commentaire
    await db.query(
      'INSERT INTO product_comments (product_id, user_id, parent_id, comment) VALUES (?, ?, ?, ?)',
      [productId, userId, parent_id, comment]
    );

    return res.status(200).json({ success: true, message: 'Commentaire ajouté avec succès.' });
  } catch (error) {
    console.error('Erreur ajout commentaire :', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
});

// Fonction récursive pour créer l'arborescence
function buildCommentTree(comments, parentId = null) {
  return comments
    .filter(comment => comment.parent_id === parentId)
    .map(comment => ({
      ...comment,
      children: buildCommentTree(comments, comment.id),
    }));
}

// GET - Récupérer les commentaires avec noms utilisateurs (arborescence)
router.get('/:productId/comments', authMiddleware, async (req, res) => {
  const productId = parseInt(req.params.productId, 10);

  try {
    const [productRows] = await db.query('SELECT id FROM products WHERE id = ?', [productId]);
    if (productRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Produit introuvable.' });
    }

    const [comments] = await db.query(
      `SELECT c.id, c.product_id, c.user_id, c.parent_id, c.comment, c.created_at,
              COALESCE(u.fullName, 'Utilisateur') AS user_fullname
       FROM product_comments c
       LEFT JOIN utilisateurs u ON c.user_id = u.id
       WHERE c.product_id = ?
       ORDER BY c.created_at ASC`,
      [productId]
    );

    const commentTree = buildCommentTree(comments);
    return res.status(200).json({ success: true, comments: commentTree });
  } catch (error) {
    console.error('Erreur récupération commentaires :', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
});

// ✅ NOUVELLE ROUTE - Récupérer le nombre total de commentaires (parent + réponses)
router.get('/:productId/comments/count', async (req, res) => {
  const productId = parseInt(req.params.productId, 10);

  try {
    const [rows] = await db.query(
      'SELECT COUNT(*) AS total FROM product_comments WHERE product_id = ?',
      [productId]
    );

    return res.status(200).json({ success: true, count: rows[0].total });
  } catch (error) {
    console.error('Erreur récupération compteur de commentaires :', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
});

module.exports = router;

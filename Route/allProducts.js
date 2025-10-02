

const express = require('express');
const router = express.Router();

// Fonction utilitaire pour parser JSON sécurisé
const safeJsonParse = (str) => {
  try {
    return str ? JSON.parse(str) : [];
  } catch {
    return [];
  }
};

// GET /all-products — Liste complète sans auth obligatoire
router.get('/', async (req, res) => {
  try {
    const [products] = await req.db.query(`
      SELECT 
        p.*,
        u.id AS seller_id,
        u.fullName AS seller_name,
        u.profile_photo AS seller_avatar,
        IFNULL((SELECT JSON_ARRAYAGG(pi.image_path) FROM product_images pi WHERE pi.product_id = p.id), JSON_ARRAY()) AS images,
        IFNULL((SELECT JSON_ARRAYAGG(pi.absolute_url) FROM product_images pi WHERE pi.product_id = p.id), JSON_ARRAY()) AS image_urls
      FROM products p
      LEFT JOIN utilisateurs u ON p.seller_id = u.id
      ORDER BY p.created_at DESC
    `);

    if (!products || products.length === 0) {
      return res.status(404).json({ success: false, error: 'Aucun produit trouvé' });
    }

    const formatted = products.map(product => ({
      id: product.id,
      title: product.title ?? "Titre non disponible",
      description: product.description ?? "Description non disponible",
      price: parseFloat(product.price) || 0,
      original_price: product.original_price ? parseFloat(product.original_price) : null,
      category: product.category || 'autre',
      condition: product.condition || 'neuf',
      stock: parseInt(product.stock) || 0,
      likes: product.likes_count || 0,
      shares: product.shares_count || 0,
      views: product.views_count || 0,
      delivery_options: safeJsonParse(product.delivery_options),
      images: product.images || [],
      image_urls: product.image_urls || [],
      created_at: product.created_at,
      updated_at: product.updated_at,
      seller: {
        id: product.seller_id?.toString() || null,
        name: product.seller_name || "Vendeur inconnu",
        avatar: product.seller_avatar
          ? (product.seller_avatar.startsWith('http')
              ? product.seller_avatar
              : `${req.protocol}://${req.get('host')}${product.seller_avatar}`)
          : null
      }
    }));

    res.json({
      success: true,
      count: formatted.length,
      products: formatted
    });

  } catch (err) {
    console.error('Erreur GET /all-products:', err.message);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

module.exports = router;

// ----------------------------
// ROUTES PRODUCTS: /latest, /popular, /feed
// Description: Routes pour le fil d'actualité intelligent
// ----------------------------
const express = require('express');
const router = express.Router();
const db = require('../../db');
const authMiddleware = require('../../middlewares/authMiddleware');

// Utilitaire pour parser JSON sans erreur
const safeJsonParse = (str) => {
  try { 
    return str ? JSON.parse(str) : []; 
  } catch { 
    return []; 
  }
};

// =============================================================================
// ROUTE GET /api/products/latest
// Description: Retourne les produits les plus récents (tri par date de création)
// Utilisation: GET /api/products/latest?page=1&limit=20
// Authentification: Requise (JWT token)
// =============================================================================
router.get('/latest', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId; // Récupéré depuis authMiddleware
    const page = parseInt(req.query.page) || 1; // Page actuelle (défaut: 1)
    const limit = parseInt(req.query.limit) || 20; // Produits par page (défaut: 20)
    const offset = (page - 1) * limit; // Calcul de l'offset pour la pagination

    console.log(`📥 Requête /latest - User: ${userId}, Page: ${page}, Limit: ${limit}`);

    // Requête SQL pour récupérer les produits les plus récents
    const [products] = await db.query(`
      SELECT 
        p.*,
        u.id AS seller_id,
        u.fullName AS seller_name,
        u.profile_photo AS seller_avatar,
        u.ville AS seller_city,
        -- Récupération des images du produit
        IFNULL((SELECT JSON_ARRAYAGG(pi.image_path) FROM product_images pi WHERE pi.product_id = p.id), JSON_ARRAY()) AS images,
        IFNULL((SELECT JSON_ARRAYAGG(pi.absolute_url) FROM product_images pi WHERE pi.product_id = p.id), JSON_ARRAY()) AS image_urls,
        -- Comptage des commentaires
        (SELECT COUNT(*) FROM product_comments pc WHERE pc.product_id = p.id) AS comments_count,
        -- Vérification si l'utilisateur a liké le produit
        EXISTS (
          SELECT 1 FROM product_likes pl WHERE pl.product_id = p.id AND pl.user_id = ?
        ) AS isLiked
      FROM products p
      LEFT JOIN utilisateurs u ON p.seller_id = u.id
      -- Tri par date de création (du plus récent au plus ancien)
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `, [userId, limit, offset]);

    // Vérification si des produits ont été trouvés
    if (!products.length) {
      console.log(`⚠️ Aucun produit trouvé pour la page ${page}`);
      return res.json({ 
        success: true, 
        message: "Aucun produit trouvé pour cette page",
        products: [],
        page,
        count: 0,
        hasMore: false
      });
    }

    // Formatage des produits pour la réponse
    const formatted = products.map(product => ({
      id: product.id,
      title: product.title || "Titre non disponible",
      description: product.description || "Description non disponible",
      price: parseFloat(product.price) || 0,
      original_price: product.original_price ? parseFloat(product.original_price) : null,
      category: product.category,
      condition: product.condition || "neuf",
      stock: parseInt(product.stock) || 0,
      location: product.location || product.seller_city || 'Ville inconnue',
      delivery_options: safeJsonParse(product.delivery_options),
      created_at: product.created_at,
      updated_at: product.updated_at,
      // Statistiques d'engagement
      likes: product.likes_count || 0,
      shares: product.shares_count || 0,
      comments: product.comments_count || 0,
      views: product.views_count || 0,
      sales: product.sales || 0,
      isLiked: Boolean(product.isLiked),
      // Images
      images: product.images || [],
      image_urls: product.image_urls || [],
      // Informations du vendeur
      seller: {
        id: product.seller_id?.toString() || null,
        name: product.seller_name || "Vendeur inconnu",
        avatar: product.seller_avatar
          ? (product.seller_avatar.startsWith('http')
              ? product.seller_avatar
              : `${req.protocol}://${req.get('host')}${product.seller_avatar}`)
          : null,
        city: product.seller_city || null
      }
    }));

    console.log(`✅ ${formatted.length} produits récents récupérés pour la page ${page}`);

    // Réponse JSON structurée
    res.json({
      success: true,
      page: page,
      limit: limit,
      count: formatted.length,
      hasMore: formatted.length === limit, // Indique s'il y a plus de pages
      products: formatted
    });

  } catch (error) {
    console.error('❌ Erreur GET /latest:', error.message);
    res.status(500).json({ 
      success: false, 
      error: 'Erreur serveur lors de la récupération des produits récents',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// =============================================================================
// ROUTE GET /api/products/popular
// Description: Retourne les produits les plus populaires
// Critères de popularité: likes, vues, commentaires, partages, ventes
// Score = (likes*2) + (views*1.5) + (comments*3) + (shares*4) + (sales*5)
// Utilisation: GET /api/products/popular?page=1&limit=20
// Authentification: Requise (JWT token)
// =============================================================================
router.get('/popular', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    console.log(`📥 Requête /popular - User: ${userId}, Page: ${page}, Limit: ${limit}`);

    // Requête SQL avec calcul du score de popularité
    const [products] = await db.query(`
      SELECT 
        p.*,
        u.id AS seller_id,
        u.fullName AS seller_name,
        u.profile_photo AS seller_avatar,
        u.ville AS seller_city,
        -- Récupération des images
        IFNULL((SELECT JSON_ARRAYAGG(pi.image_path) FROM product_images pi WHERE pi.product_id = p.id), JSON_ARRAY()) AS images,
        IFNULL((SELECT JSON_ARRAYAGG(pi.absolute_url) FROM product_images pi WHERE pi.product_id = p.id), JSON_ARRAY()) AS image_urls,
        -- Comptage des commentaires
        (SELECT COUNT(*) FROM product_comments pc WHERE pc.product_id = p.id) AS comments_count,
        -- Vérification du like utilisateur
        EXISTS (
          SELECT 1 FROM product_likes pl WHERE pl.product_id = p.id AND pl.user_id = ?
        ) AS isLiked,
        -- Calcul du score de popularité
        (
          (COALESCE(p.likes_count, 0) * 2) + 
          (COALESCE(p.views_count, 0) * 1.5) + 
          (COALESCE((SELECT COUNT(*) FROM product_comments pc WHERE pc.product_id = p.id), 0) * 3) +
          (COALESCE(p.shares_count, 0) * 4) +
          (COALESCE(p.sales, 0) * 5) +
          -- Bonus pour les produits récents (moins de 7 jours)
          (CASE WHEN DATEDIFF(NOW(), p.created_at) <= 7 THEN 10 ELSE 0 END)
        ) AS popularity_score
        
      FROM products p
      LEFT JOIN utilisateurs u ON p.seller_id = u.id
      -- Tri par score de popularité (décroissant)
      ORDER BY popularity_score DESC, p.created_at DESC
      LIMIT ? OFFSET ?
    `, [userId, limit, offset]);

    // Vérification si des produits ont été trouvés
    if (!products.length) {
      console.log(`⚠️ Aucun produit populaire trouvé pour la page ${page}`);
      return res.json({ 
        success: true, 
        message: "Aucun produit populaire trouvé",
        products: [],
        page,
        count: 0,
        hasMore: false
      });
    }

    // Formatage des produits pour la réponse
    const formatted = products.map(product => ({
      id: product.id,
      title: product.title || "Titre non disponible",
      description: product.description || "Description non disponible",
      price: parseFloat(product.price) || 0,
      original_price: product.original_price ? parseFloat(product.original_price) : null,
      category: product.category,
      condition: product.condition || "neuf",
      stock: parseInt(product.stock) || 0,
      location: product.location || product.seller_city || 'Ville inconnue',
      delivery_options: safeJsonParse(product.delivery_options),
      created_at: product.created_at,
      updated_at: product.updated_at,
      // Statistiques d'engagement
      likes: product.likes_count || 0,
      shares: product.shares_count || 0,
      comments: product.comments_count || 0,
      views: product.views_count || 0,
      sales: product.sales || 0,
      isLiked: Boolean(product.isLiked),
      popularity_score: product.popularity_score || 0, // Score calculé
      // Images
      images: product.images || [],
      image_urls: product.image_urls || [],
      // Informations du vendeur
      seller: {
        id: product.seller_id?.toString() || null,
        name: product.seller_name || "Vendeur inconnu",
        avatar: product.seller_avatar
          ? (product.seller_avatar.startsWith('http')
              ? product.seller_avatar
              : `${req.protocol}://${req.get('host')}${product.seller_avatar}`)
          : null,
        city: product.seller_city || null
      }
    }));

    console.log(`✅ ${formatted.length} produits populaires récupérés pour la page ${page}`);

    // Réponse JSON structurée
    res.json({
      success: true,
      page: page,
      limit: limit,
      count: formatted.length,
      hasMore: formatted.length === limit,
      products: formatted
    });

  } catch (error) {
    console.error('❌ Erreur GET /popular:', error.message);
    res.status(500).json({ 
      success: false, 
      error: 'Erreur serveur lors de la récupération des produits populaires',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// =============================================================================
// ROUTE GET /api/products/feed
// Description: Retourne un feed personnalisé selon les préférences utilisateur
// Algorithm: Score de pertinence basé sur:
//   - Catégories likées par l'utilisateur
//   - Proximité géographique
//   - Popularité du produit
//   - Actualité du produit
// Utilisation: GET /api/products/feed?page=1&limit=20
// Authentification: Requise (JWT token)
// =============================================================================
// =============================================================================
// ROUTE GET /api/products/feed
// Description: Retourne un feed personnalisé selon les préférences utilisateur
// =============================================================================
router.get('/feed', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    console.log(`📥 Requête /feed - User: ${userId}, Page: ${page}, Limit: ${limit}`);

    // Récupération infos utilisateur
    const [userRows] = await db.query(
      'SELECT ville, preferences FROM utilisateurs WHERE id = ?', 
      [userId]
    );
    const user = userRows[0];
    const userCity = user?.ville || '';
    const userPreferences = user?.preferences ? JSON.parse(user.preferences) : {};
    console.log(`👤 User ${userId} - Ville: ${userCity}, Préférences:`, userPreferences);

    // Catégories likées
const [userLikes] = await db.query(`
  SELECT p.category
  FROM product_likes pl
  JOIN products p ON pl.product_id = p.id
  WHERE pl.user_id = ?
  GROUP BY p.category
  ORDER BY MAX(pl.created_at) DESC
  LIMIT 10
`, [userId]);

    const likedCategories = userLikes.map(like => like.category);
    console.log(`❤️ Catégories likées:`, likedCategories);

    // Construction paramètres pour la requête
    let queryParams = [userId]; // pour isLiked dans SELECT

    // Liste des placeholders pour les catégories likées
    const categoryPlaceholders = likedCategories.map(() => '?').join(',');

    // Requête principale feed
    const [products] = await db.query(`
      SELECT 
        p.*,
        u.id AS seller_id,
        u.fullName AS seller_name,
        u.profile_photo AS seller_avatar,
        u.ville AS seller_city,
        IFNULL((SELECT JSON_ARRAYAGG(pi.image_path) FROM product_images pi WHERE pi.product_id = p.id), JSON_ARRAY()) AS images,
        IFNULL((SELECT JSON_ARRAYAGG(pi.absolute_url) FROM product_images pi WHERE pi.product_id = p.id), JSON_ARRAY()) AS image_urls,
        (SELECT COUNT(*) FROM product_comments pc WHERE pc.product_id = p.id) AS comments_count,
        EXISTS (SELECT 1 FROM product_likes pl WHERE pl.product_id = p.id AND pl.user_id = ?) AS isLiked,
        (
          (COALESCE(p.likes_count,0)*2) +
          (COALESCE(p.views_count,0)*1.5) +
          (COALESCE((SELECT COUNT(*) FROM product_comments pc WHERE pc.product_id = p.id),0)*3) +
          (COALESCE(p.shares_count,0)*4) +
          (COALESCE(p.sales,0)*5) +
          (CASE WHEN DATEDIFF(NOW(), p.created_at) <= 7 THEN 15 ELSE 0 END) +
          ${likedCategories.length > 0 ? `(CASE WHEN p.category IN (${categoryPlaceholders}) THEN 20 ELSE 0 END) +` : ''}
          (CASE WHEN u.ville = ? THEN 10 ELSE 0 END) +
          (CASE WHEN p.seller_id != ? THEN 5 ELSE 0 END) +
          (CASE WHEN p.is_featured = 1 THEN 8 ELSE 0 END)
        ) AS relevance_score
      FROM products p
      LEFT JOIN utilisateurs u ON p.seller_id = u.id
      WHERE p.seller_id != ?
      ORDER BY relevance_score DESC, p.created_at DESC
      LIMIT ? OFFSET ?
    `, [
      ...queryParams,
      ...(likedCategories.length > 0 ? likedCategories : []),
      userCity,
      userId,
      userId,
      limit,
      offset
    ]);

    // Formatage du feed
    const formatted = products.map(product => ({
      id: product.id,
      title: product.title,
      description: product.description,
      price: parseFloat(product.price),
      original_price: product.original_price ? parseFloat(product.original_price) : null,
      category: product.category,
      condition: product.condition || 'neuf',
      stock: product.stock,
      location: product.location || product.seller_city || 'Ville inconnue',
      delivery_options: product.delivery_options ? JSON.parse(product.delivery_options) : [],
      created_at: product.created_at,
      updated_at: product.updated_at,
      likes: product.likes_count || 0,
      shares: product.shares_count || 0,
      comments: product.comments_count || 0,
      views: product.views_count || 0,
      sales: product.sales || 0,
      isLiked: Boolean(product.isLiked),
      relevance_score: product.relevance_score || 0,
      is_featured: Boolean(product.is_featured),
      images: product.images || [],
      image_urls: product.image_urls || [],
      seller: {
        id: product.seller_id?.toString() || null,
        name: product.seller_name || "Vendeur inconnu",
        avatar: product.seller_avatar
          ? (product.seller_avatar.startsWith('http')
              ? product.seller_avatar
              : `${req.protocol}://${req.get('host')}${product.seller_avatar}`)
          : null,
        city: product.seller_city || null
      }
    }));

    res.json({
      success: true,
      page,
      limit,
      count: formatted.length,
      hasMore: formatted.length === limit,
      products: formatted,
      user_preferences: {
        city: userCity,
        liked_categories: likedCategories,
        preferences: userPreferences
      }
    });

  } catch (error) {
    console.error('❌ Erreur GET /feed:', error.message);
    res.status(500).json({ 
      success: false,
      error: 'Erreur serveur lors de la génération du feed personnalisé',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;

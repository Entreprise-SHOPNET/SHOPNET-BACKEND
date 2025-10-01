

const express = require('express');
const router = express.Router();
const pool = require('../db');

const categoryMap = {
  'bébé': ['baby', 'enfant', 'kid', 'clothing', 'poussette'],
  'chaussure': ['shoes', 'basket', 'sneakers'],
  'téléphone': ['phone', 'samsung', 'iphone', 'itel', 'redmi', 'mobile'],
  'ordinateur': ['laptop', 'pc', 'ordinateur', 'portable'],
  'soin': ['beauté', 'parfum', 'maquillage', 'cosmétique'],
};

const similarBrands = {
  'samsung': ['itel', 'infinix', 'xiaomi', 'iphone'],
  'iphone': ['samsung', 'redmi'],
  'chaussure': ['basket', 'sneakers'],
};

router.get('/', async (req, res) => {
  try {
    const { search, location, category, condition, page = 1, limit = 20 } = req.query;

    if (!search || search.trim() === '') {
      return res.status(400).json({ error: 'Mot-clé requis pour la recherche.' });
    }

    const keyword = search.trim().toLowerCase();
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 20;
    const offset = (pageNum - 1) * limitNum;

    const escapedKeyword = pool.escape(keyword);

    let suggestions = [];
    Object.entries(categoryMap).forEach(([key, mots]) => {
      if (mots.some(m => keyword.includes(m))) suggestions.push(key);
    });

    let similar = [];
    Object.keys(similarBrands).forEach(key => {
      if (keyword.includes(key)) similar = similarBrands[key];
    });

    const whereClauses = [];

    whereClauses.push(`(
      MATCH(p.title, p.description, p.category) AGAINST(${escapedKeyword} IN NATURAL LANGUAGE MODE)
      OR LOWER(u.fullName) LIKE ${escapedKeyword}
      OR LOWER(u.email) LIKE ${escapedKeyword}
      OR LOWER(u.companyName) LIKE ${escapedKeyword}
    )`);

    if (category) {
      whereClauses.push(`p.category = ${pool.escape(category)}`);
    }
    if (condition) {
      whereClauses.push(`p.condition = ${pool.escape(condition)}`);
    }
    if (location) {
      whereClauses.push(`p.location LIKE ${pool.escape('%' + location + '%')}`);
    }

    const whereSQL = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

    const sql = `
      SELECT 
        p.id, p.title, p.description, p.price, p.original_price, p.category, 
        p.condition, p.stock, p.location, p.created_at, p.views,
        u.id AS seller_id, u.fullName, u.email, u.phone, u.companyName,
        pi.image_path AS filename, pi.absolute_url AS url,
        MATCH(p.title, p.description, p.category) AGAINST(${escapedKeyword} IN NATURAL LANGUAGE MODE) AS relevance
      FROM products p
      LEFT JOIN utilisateurs u ON p.seller_id = u.id
      LEFT JOIN product_images pi ON pi.product_id = p.id
      ${whereSQL}
      ORDER BY relevance DESC, p.views DESC, p.created_at DESC
      LIMIT ${limitNum} OFFSET ${offset}
    `;

    console.log('SQL:\n', sql);

    const [rows] = await pool.query(sql);

    const grouped = {};
    for (const item of rows) {
      if (!grouped[item.id]) {
        grouped[item.id] = {
          id: item.id,
          title: item.title,
          description: item.description,
          price: item.price,
          originalPrice: item.original_price,
          category: item.category,
          condition: item.condition,
          stock: item.stock,
          location: item.location,
          createdAt: item.created_at,
          views: item.views,
          relevance: item.relevance,
          seller: {
            id: item.seller_id,
            name: item.fullName,
            email: item.email,
            phone: item.phone,
            company: item.companyName
          },
          images: []
        };
      }
      if (item.filename && item.url) {
        grouped[item.id].images.push({ filename: item.filename, url: item.url });
      }
    }

    const results = Object.values(grouped);

    if (results.length === 0) {
      return res.status(200).json({
        message: 'Aucun résultat trouvé.',
        suggestions: Object.keys(categoryMap),
        similar
      });
    }

    res.json({
      success: true,
      count: results.length,
      page: pageNum,
      limit: limitNum,
      products: results,
      suggestions,
      similar
    });

  } catch (err) {
    console.error('❌ Erreur de recherche:', err);
    res.status(500).json({ error: 'Erreur serveur lors de la recherche.' });
  }
});





// ======================
// NOUVEAU ROUTEUR DÉCOUVRIR - Produits populaires
// ======================
// ======================
// NOUVEAU ROUTEUR DÉCOUVRIR - Produits populaires optimisé
// ======================
router.get('/discover', async (req, res) => {
  try {
    const userId = req.headers['user-id'] || null; // Optionnel, si connecté
    const { sort_by = 'likes', limit = 20, page = 1 } = req.query;

    // Validation des inputs
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100); // max 100
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const offset = (pageNum - 1) * limitNum;

    const validSort = {
      likes: 'p.likes_count',
      views: 'p.views_count',
      comments: 'comments_count',
      shares: 'p.shares_count',
      cart: 'cart_count',
      orders: 'orders_count'
    };
    const sortColumn = validSort[sort_by] || 'p.likes_count';

    // Requête optimisée avec jointures et total count
    const [products] = await pool.query(
      `
      SELECT 
        p.id, p.title, p.description, p.price, p.original_price, p.category, p.condition,
        p.stock, p.location, p.created_at, p.likes_count, p.shares_count, p.views_count,
        IFNULL(pc.comment_count, 0) AS comments_count,
        IFNULL(c.cart_count, 0) AS cart_count,
        IFNULL(op.order_count, 0) AS orders_count,
        ${userId ? `EXISTS(SELECT 1 FROM product_likes pl WHERE pl.user_id = ? AND pl.product_id = p.id) AS isLiked,` : '0 AS isLiked,'}
        IFNULL(JSON_ARRAYAGG(pi.absolute_url), JSON_ARRAY()) AS images
      FROM products p
      LEFT JOIN (
        SELECT product_id, COUNT(*) AS comment_count 
        FROM product_comments GROUP BY product_id
      ) pc ON pc.product_id = p.id
      LEFT JOIN (
        SELECT product_id, COUNT(*) AS cart_count 
        FROM carts GROUP BY product_id
      ) c ON c.product_id = p.id
      LEFT JOIN (
        SELECT produit_id, COUNT(*) AS order_count 
        FROM commande_produits GROUP BY produit_id
      ) op ON op.produit_id = p.id
      LEFT JOIN product_images pi ON pi.product_id = p.id
      GROUP BY p.id
      ORDER BY ${sortColumn} DESC, p.created_at DESC
      LIMIT ? OFFSET ?
      `,
      userId ? [userId, limitNum, offset] : [limitNum, offset]
    );

    // Total count pour pagination
    const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM products');

    const formatted = products.map(p => ({
      id: p.id,
      title: p.title,
      description: p.description,
      price: parseFloat(p.price) || 0,
      original_price: p.original_price ? parseFloat(p.original_price) : null,
      category: p.category,
      condition: p.condition,
      stock: parseInt(p.stock) || 0,
      location: p.location,
      created_at: p.created_at,
      likes: p.likes_count || 0,
      shares: p.shares_count || 0,
      comments: p.comments_count || 0,
      views: p.views_count || 0,
      inCart: p.cart_count || 0,
      ordered: p.orders_count || 0,
      isLiked: Boolean(p.isLiked),
      images: Array.isArray(p.images) ? p.images : JSON.parse(p.images || '[]')
    }));

    res.json({
      success: true,
      count: formatted.length,
      total: total,
      page: pageNum,
      limit: limitNum,
      products: formatted
    });

  } catch (err) {
    console.error('Erreur /discover optimisé:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur lors de la récupération des produits populaires.' });
  }
});



module.exports = router;

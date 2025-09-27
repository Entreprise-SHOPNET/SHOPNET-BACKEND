

const express = require('express');
const router = express.Router();
const db = require('../db'); // ta connexion MySQL
const authMiddleware = require('../middlewares/authMiddleware');

router.get('/discover', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const userLat = parseFloat(req.query.lat) || null;
    const userLon = parseFloat(req.query.lon) || null;
    const cloudinaryBase = 'https://res.cloudinary.com/<cloud_name>/image/upload/';

    // Fonctions utilitaires
    const formatProduct = (p) => ({
      id: p.id,
      title: p.title,
      price: p.price,
      image_urls: p.image_urls.length ? p.image_urls : p.images.map(img => img.image_path ? `${cloudinaryBase}${img.image_path}` : ''),
      description: p.description,
      stock: p.stock,
      category: p.category,
    });

    // 1. Featured (sponsorisés)
    const [featuredRaw] = await db.query(
      `SELECT p.*, IFNULL(JSON_ARRAYAGG(pi.image_path), JSON_ARRAY()) AS images,
              IFNULL(JSON_ARRAYAGG(pi.absolute_url), JSON_ARRAY()) AS image_urls
       FROM products p
       LEFT JOIN product_images pi ON pi.product_id = p.id
       WHERE p.is_featured = 1
       GROUP BY p.id
       ORDER BY p.created_at DESC
       LIMIT 5`
    );
    const featured = featuredRaw.map(formatProduct);

    // 2. Recent (nouveaux)
    const [recentRaw] = await db.query(
      `SELECT p.*, IFNULL(JSON_ARRAYAGG(pi.image_path), JSON_ARRAY()) AS images,
              IFNULL(JSON_ARRAYAGG(pi.absolute_url), JSON_ARRAY()) AS image_urls
       FROM products p
       LEFT JOIN product_images pi ON pi.product_id = p.id
       GROUP BY p.id
       ORDER BY p.created_at DESC
       LIMIT 5`
    );
    const recent = recentRaw.map(formatProduct);

    // 3. Popular (plus de ventes ou likes)
    const [popularRaw] = await db.query(
      `SELECT p.*, IFNULL(JSON_ARRAYAGG(pi.image_path), JSON_ARRAY()) AS images,
              IFNULL(JSON_ARRAYAGG(pi.absolute_url), JSON_ARRAY()) AS image_urls
       FROM products p
       LEFT JOIN product_images pi ON pi.product_id = p.id
       GROUP BY p.id
       ORDER BY p.sales DESC
       LIMIT 5`
    );
    const popular = popularRaw.map(formatProduct);

    // 4. Recommended (par catégorie aléatoire pour l'instant)
    const [recommendedRaw] = await db.query(
      `SELECT p.*, IFNULL(JSON_ARRAYAGG(pi.image_path), JSON_ARRAY()) AS images,
              IFNULL(JSON_ARRAYAGG(pi.absolute_url), JSON_ARRAY()) AS image_urls
       FROM products p
       LEFT JOIN product_images pi ON pi.product_id = p.id
       GROUP BY p.id
       ORDER BY RAND()
       LIMIT 5`
    );
    const recommended = recommendedRaw.map(formatProduct);

    // 5. Nearby (si lat/lon fournis)
    let nearby = [];
    if (userLat && userLon) {
      const [nearbyRaw] = await db.query(
        `SELECT p.*, IFNULL(JSON_ARRAYAGG(pi.image_path), JSON_ARRAY()) AS images,
                IFNULL(JSON_ARRAYAGG(pi.absolute_url), JSON_ARRAY()) AS image_urls,
                (6371 * ACOS(COS(RADIANS(?)) * COS(RADIANS(p.latitude)) *
                COS(RADIANS(p.longitude) - RADIANS(?)) + SIN(RADIANS(?)) * SIN(RADIANS(p.latitude)))) AS distance
         FROM products p
         LEFT JOIN product_images pi ON pi.product_id = p.id
         WHERE p.latitude IS NOT NULL AND p.longitude IS NOT NULL
         GROUP BY p.id
         ORDER BY distance ASC
         LIMIT 5`,
         [userLat, userLon, userLat]
      );
      nearby = nearbyRaw.map(formatProduct);
    }

    // 6. Trending categories
    const [categoriesRaw] = await db.query(
      `SELECT category, COUNT(*) AS count
       FROM products
       GROUP BY category
       ORDER BY count DESC
       LIMIT 10`
    );

    res.json({
      success: true,
      featured,
      recent,
      popular,
      recommended,
      nearby,
      trendingCategories: categoriesRaw,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

module.exports = router;







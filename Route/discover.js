

const express = require("express");
const router = express.Router();
const db = require("../db");
const haversine = require("haversine-distance");

// Cloudinary config
const CLOUD_NAME = "dddr7gb6w";
const CLOUD_BASE_URL = `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/`;

// Middleware pour vérifier JWT
const jwt = require("jsonwebtoken");
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ success: false, message: "Token manquant" });

  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ success: false, message: "Token invalide" });
    req.userId = decoded.id;
    next();
  });
};

// Formater les produits avec images Cloudinary
async function formatProductsWithImages(products) {
  if (!products || products.length === 0) return [];

  const productIds = products.map(p => p.id);
  if (productIds.length === 0) return [];

  const [images] = await db.query(
    `SELECT product_id, image_path FROM product_images WHERE product_id IN (${productIds.map(() => "?").join(",")})`,
    productIds
  );

  const imageMap = {};
  images.forEach(img => {
    if (!imageMap[img.product_id]) imageMap[img.product_id] = [];
    imageMap[img.product_id].push(img.image_path);
  });

  return products.map(prod => {
    const imagePaths = imageMap[prod.id] || [];
    const image_urls = imagePaths.map(p => p.startsWith("http") ? p : `${CLOUD_BASE_URL}${p}`);
    return { ...prod, images: imagePaths, image_urls };
  });
}

// GET /discover
router.get("/discover", verifyToken, async (req, res) => {
  try {
    const { lat, lon } = req.query;
    const userId = req.userId;

    // Produits récents
    const [recentRaw] = await db.query(`SELECT * FROM products ORDER BY created_at DESC LIMIT 10`);
    const recent = await formatProductsWithImages(recentRaw);

    // Produits populaires
    const [popularRaw] = await db.query(`SELECT * FROM products ORDER BY views DESC, sales DESC LIMIT 10`);
    const popular = await formatProductsWithImages(popularRaw);

    // Produits mis en avant
    const [featuredRaw] = await db.query(`SELECT * FROM products WHERE is_featured = 1 ORDER BY updated_at DESC LIMIT 10`);
    const featured = await formatProductsWithImages(featuredRaw);

    // Produits proches
    let nearby = [];
    if (lat && lon) {
      const [all] = await db.query(`SELECT * FROM products WHERE latitude IS NOT NULL AND longitude IS NOT NULL`);
      const nearbyFiltered = all.filter(p => {
        const from = { latitude: parseFloat(lat), longitude: parseFloat(lon) };
        const to = { latitude: parseFloat(p.latitude), longitude: parseFloat(p.longitude) };
        return haversine(from, to) / 1000 <= 30;
      }).slice(0, 10);
      nearby = await formatProductsWithImages(nearbyFiltered);
    }

    // Produits recommandés
    let recommended = [];
    if (userId) {
      const [categoriesViewed] = await db.query(`
        SELECT p.category, MAX(v.viewed_at) AS last_viewed
        FROM product_views v
        INNER JOIN products p ON p.id = v.product_id
        WHERE v.user_id = ?
        GROUP BY p.category
        ORDER BY last_viewed DESC
        LIMIT 3
      `, [userId]);

      if (categoriesViewed.length > 0) {
        const categories = categoriesViewed.map(c => c.category);
        const placeholders = categories.map(() => "?").join(",");
        const [recoRaw] = await db.query(`
          SELECT * FROM products
          WHERE category IN (${placeholders})
          ORDER BY RAND()
          LIMIT 10
        `, categories);

        recommended = await formatProductsWithImages(recoRaw);
      }
    }

    // Catégories tendances
    const [trendingCategories] = await db.query(`
      SELECT category, COUNT(*) AS count
      FROM products
      GROUP BY category
      ORDER BY count DESC
      LIMIT 5
    `);

    // Debug console
    console.log({
      recent: recent.length,
      popular: popular.length,
      featured: featured.length,
      nearby: nearby.length,
      recommended: recommended.length
    });

    res.json({
      recent,
      popular,
      featured,
      nearby,
      recommended,
      trendingCategories
    });
  } catch (err) {
    console.error("Erreur Discover:", err);
    res.status(500).json({ success: false, message: "Erreur serveur discover" });
  }
});

module.exports = router;

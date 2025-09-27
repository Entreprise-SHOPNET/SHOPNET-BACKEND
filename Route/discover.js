

const express = require('express');
const router = express.Router();
const db = require('../db');
const haversine = require('haversine-distance');
const cloudinary = require('cloudinary').v2;

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET,
});

// Helper pour formater les produits avec images
async function formatProductsWithImages(products) {
  if (!products || products.length === 0) return [];

  const productIds = products.map(p => p.id);
  if (productIds.length === 0) return [];

  const [images] = await db.query(
    `SELECT product_id, image_path FROM product_images WHERE product_id IN (${productIds.map(() => '?').join(',')})`,
    productIds
  );

  const imageMap = {};
  images.forEach(img => {
    if (!imageMap[img.product_id]) imageMap[img.product_id] = [];
    imageMap[img.product_id].push(img.image_path);
  });

  return products.map(prod => {
    const imagePaths = imageMap[prod.id] || [];
    const image_urls = imagePaths.map(p =>
      p.startsWith('http') ? p : cloudinary.url(p, { secure: true })
    );
    return { ...prod, images: imagePaths, image_urls };
  });
}

// GET /discover
router.get('/discover', async (req, res) => {
  try {
    const { lat, lon } = req.query;

    // ----------------------------
    // 1️⃣ Produits sponsorisés
    // ----------------------------
    const [featuredRaw] = await db.query(
      `SELECT * FROM products WHERE is_featured = 1 ORDER BY updated_at DESC LIMIT 10`
    );
    const featured = await formatProductsWithImages(featuredRaw);

    // ----------------------------
    // 2️⃣ Produits récents
    // ----------------------------
    const [recentRaw] = await db.query(
      `SELECT * FROM products ORDER BY created_at DESC LIMIT 10`
    );
    const recent = await formatProductsWithImages(recentRaw);

    // ----------------------------
    // 3️⃣ Catégories tendances
    // ----------------------------
    const [trendingCategories] = await db.query(
      `SELECT category, COUNT(*) AS count FROM products GROUP BY category ORDER BY count DESC LIMIT 5`
    );

    // ----------------------------
    // 4️⃣ Produits proches
    // ----------------------------
    let nearby = [];
    if (lat && lon) {
      const [allProducts] = await db.query(
        `SELECT * FROM products WHERE latitude IS NOT NULL AND longitude IS NOT NULL`
      );
      const nearbyFiltered = allProducts.filter(p => {
        const from = { latitude: parseFloat(lat), longitude: parseFloat(lon) };
        const to = { latitude: parseFloat(p.latitude), longitude: parseFloat(p.longitude) };
        return haversine(from, to) / 1000 <= 30; // distance en km
      }).slice(0, 10);
      nearby = await formatProductsWithImages(nearbyFiltered);
    }

    // ----------------------------
    // 5️⃣ Nouveautés
    // ----------------------------
    const [newRaw] = await db.query(
      `SELECT * FROM products ORDER BY created_at DESC LIMIT 10`
    );
    const newProducts = await formatProductsWithImages(newRaw);

    // ----------------------------
    // 6️⃣ Recommandés pour vous
    // ----------------------------
    let recommended = [];
    const [categoriesViewed] = await db.query(
      `SELECT p.category, MAX(v.viewed_at) AS last_viewed
       FROM product_views v
       INNER JOIN products p ON p.id = v.product_id
       GROUP BY p.category
       ORDER BY last_viewed DESC
       LIMIT 3`
    );
    if (categoriesViewed.length > 0) {
      const categories = categoriesViewed.map(c => c.category);
      const placeholders = categories.map(() => '?').join(',');
      const [recoRaw] = await db.query(
        `SELECT * FROM products WHERE category IN (${placeholders}) ORDER BY RAND() LIMIT 10`,
        categories
      );
      recommended = await formatProductsWithImages(recoRaw);
    }

    // ----------------------------
    // 7️⃣ Produits populaires
    // ----------------------------
    const [popularRaw] = await db.query(
      `SELECT * FROM products ORDER BY views DESC, sales DESC LIMIT 10`
    );
    const popular = await formatProductsWithImages(popularRaw);

    // ----------------------------
    // Réponse finale
    // ----------------------------
    res.json({
      featured,           // 🔥 en première position
      recent,
      trendingCategories,
      nearby,
      newProducts,
      recommended,
      popular
    });

  } catch (err) {
    console.error('Erreur Discover:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur discover' });
  }
});

module.exports = router;

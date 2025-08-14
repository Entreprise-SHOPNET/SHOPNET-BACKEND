


const express = require("express");
const router = express.Router();
const db = require("../db"); // mysql2 pool configuré
const haversine = require("haversine-distance");

// Configuration Cloudinary
const CLOUD_NAME = "dddr7gb6w";

// Fonction pour formater les produits avec images Cloudinary
async function formatProductsWithImages(products) {
  const productIds = products.map(p => p.id);
  if (productIds.length === 0) return [];

  // Récupérer toutes les images associées à ces produits
  const [images] = await db.query(`
    SELECT product_id, image_path
    FROM product_images
    WHERE product_id IN (${productIds.map(() => '?').join(',')})
  `, productIds);

  const imageMap = {};
  images.forEach(img => {
    if (!imageMap[img.product_id]) imageMap[img.product_id] = [];
    imageMap[img.product_id].push(img.image_path);
  });

  // Ajouter images et image_urls dans chaque produit
  return products.map(prod => {
    const imagePaths = imageMap[prod.id] || [];

    const image_urls = imagePaths.map(path => {
      // Si c'est déjà une URL complète, on la renvoie
      if (path.startsWith("http")) return path;

      // Sinon, on construit l'URL Cloudinary
      return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/${path}`;
    });

    return {
      ...prod,
      images: imagePaths,
      image_urls,
    };
  });
}

router.get("/discover", async (req, res) => {
  try {
    const { lat, lon, userId } = req.query;

    // 1️⃣ Produits récents
    const [recentRaw] = await db.query(`
      SELECT * FROM products ORDER BY created_at DESC LIMIT 10
    `);
    const recent = await formatProductsWithImages(recentRaw);

    // 2️⃣ Produits populaires
    const [popularRaw] = await db.query(`
      SELECT * FROM products ORDER BY views DESC, sales DESC LIMIT 10
    `);
    const popular = await formatProductsWithImages(popularRaw);

    // 3️⃣ Produits mis en avant
    const [featuredRaw] = await db.query(`
      SELECT * FROM products WHERE is_featured = 1 ORDER BY updated_at DESC LIMIT 10
    `);
    const featured = await formatProductsWithImages(featuredRaw);

    // 4️⃣ Produits proches
    let nearby = [];
    if (lat && lon) {
      const [all] = await db.query(`
        SELECT * FROM products WHERE latitude IS NOT NULL AND longitude IS NOT NULL
      `);

      const nearbyFiltered = all.filter(product => {
        const from = { latitude: parseFloat(lat), longitude: parseFloat(lon) };
        const to = { latitude: parseFloat(product.latitude), longitude: parseFloat(product.longitude) };
        const distance = haversine(from, to) / 1000; // en km
        return distance <= 30;
      }).slice(0, 10);

      nearby = await formatProductsWithImages(nearbyFiltered);
    }

    // 5️⃣ Produits recommandés
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
        const placeholders = categories.map(() => '?').join(',');

        const [recoRaw] = await db.query(`
          SELECT * FROM products
          WHERE category IN (${placeholders})
          ORDER BY RAND()
          LIMIT 10
        `, categories);

        recommended = await formatProductsWithImages(recoRaw);
      }
    }

    // 6️⃣ Catégories tendances
    const [trendingCategories] = await db.query(`
      SELECT category, COUNT(*) AS count
      FROM products
      GROUP BY category
      ORDER BY count DESC
      LIMIT 5
    `);

    // Réponse finale
    res.status(200).json({
      recent,
      popular,
      featured,
      nearby,
      recommended,
      trendingCategories
    });

  } catch (err) {
    console.error("Erreur Discover:", err);
    res.status(500).json({ message: "Erreur serveur discover." });
  }
});

module.exports = router;

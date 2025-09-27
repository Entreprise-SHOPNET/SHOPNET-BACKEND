

const express = require('express');
const router = express.Router();
const db = require('../db');
const haversine = require('haversine-distance');
const cloudinary = require('cloudinary').v2;
const cors = require('cors');

router.use(cors({
  origin: [
    'http://localhost',
    'http://100.64.134.89',
    'https://shopnet-backend.onrender.com'
  ],
  methods: ['GET', 'POST']
}));

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.CLOUD_SECRET
});

// Formater les produits avec leurs images Cloudinary
async function formatProducts(products) {
  if (!products || products.length === 0) return [];

  const productIds = products.map(p => p.id);

  const [images] = await db.query(`
    SELECT product_id, image_path 
    FROM product_images 
    WHERE product_id IN (${productIds.map(() => '?').join(',')})
  `, productIds);

  const imageMap = {};
  images.forEach(img => {
    if (!imageMap[img.product_id]) imageMap[img.product_id] = [];
    imageMap[img.product_id].push(`${cloudinary.config().cloud_name ? `https://res.cloudinary.com/${cloudinary.config().cloud_name}/image/upload/` : ''}${img.image_path}`);
  });

  return products.map(prod => ({
    ...prod,
    image_urls: imageMap[prod.id] || []
  }));
}

// GET /discover?page=1&lat=...&lon=...
router.get('/discover', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 5;
    const offset = (page - 1) * limit;
    const { lat, lon } = req.query;

    // Produits récents
    const [recentRaw] = await db.query(`SELECT * FROM products ORDER BY created_at DESC LIMIT ? OFFSET ?`, [limit, offset]);
    const recent = await formatProducts(recentRaw);

    // Produits populaires
    const [popularRaw] = await db.query(`SELECT * FROM products ORDER BY views DESC, sales DESC LIMIT ? OFFSET ?`, [limit, offset]);
    const popular = await formatProducts(popularRaw);

    // Produits sponsorisés (featured)
    const [featuredRaw] = await db.query(`SELECT * FROM products WHERE is_featured = 1 ORDER BY updated_at DESC LIMIT ? OFFSET ?`, [limit, offset]);
    const featured = await formatProducts(featuredRaw);

    // Produits proches (via lat/lon)
    let nearby = [];
    if (lat && lon) {
      const [all] = await db.query(`SELECT * FROM products WHERE latitude IS NOT NULL AND longitude IS NOT NULL`);
      const nearbyFiltered = all.filter(p => {
        const from = { latitude: parseFloat(lat), longitude: parseFloat(lon) };
        const to = { latitude: parseFloat(p.latitude), longitude: parseFloat(p.longitude) };
        return haversine(from, to) / 1000 <= 30;
      }).slice(offset, offset + limit);
      nearby = await formatProducts(nearbyFiltered);
    }

    res.json({
      success: true,
      page,
      pageSize: limit,
      recent,
      popular,
      featured,
      nearby
    });

  } catch (err) {
    console.error('Erreur Discover:', err.message);
    res.status(500).json({ success: false, error: 'Erreur serveur Discover' });
  }
});

module.exports = router;

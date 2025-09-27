
const express = require('express');
const router = express.Router();
const db = require('../db');
const authMiddleware = require('../middlewares/authMiddleware');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;

// CORS
router.use(cors({
  origin: [
    'http://localhost',
    'http://100.64.134.89',
    'https://shopnet-backend.onrender.com'
  ],
  methods: ['GET', 'POST']
}));

// Config Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET,
});

// GET /discover?page=1
router.get('/', authMiddleware, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 5;
    const offset = (page - 1) * limit;

    // Récupérer les produits
    const [products] = await db.query(`
      SELECT p.*,
             IFNULL((SELECT JSON_ARRAYAGG(pi.absolute_url) 
                     FROM product_images pi 
                     WHERE pi.product_id = p.id), JSON_ARRAY()) AS image_urls
      FROM products p
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `, [limit, offset]);

    if (!products || products.length === 0) {
      return res.status(404).json({ success: false, error: 'Produit introuvable' });
    }

    // Formater les produits
    const formatted = products.map(p => ({
      id: p.id,
      title: p.title,
      description: p.description,
      price: parseFloat(p.price),
      stock: p.stock,
      category: p.category,
      created_at: p.created_at,
      image_urls: p.image_urls || []
    }));

    res.json({
      success: true,
      page,
      pageSize: limit,
      totalProducts: formatted.length,
      totalPages: Math.ceil(formatted.length / limit),
      products: formatted
    });

  } catch (err) {
    console.error('Erreur /discover:', err.message);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

module.exports = router;



// routes/discover.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const router = express.Router();
const db = require('../db');
const authMiddleware = require('../middlewares/authMiddleware');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;

router.use(cors({
  origin: [
    'http://localhost', 
    'http://100.64.134.89',
    'https://shopnet-backend.onrender.com'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE']
}));

// Configuration Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET,
});

// Route GET /discover pour récupérer les nouveaux produits
router.get('/discover', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const page = parseInt(req.query.page) || 1;
    const limit = 5;
    const offset = (page - 1) * limit;

    // Récupération des derniers produits
    const [productsRaw] = await db.query(`
      SELECT p.*, 
             IFNULL(JSON_ARRAYAGG(pi.image_path), JSON_ARRAY()) AS images,
             IFNULL(JSON_ARRAYAGG(pi.absolute_url), JSON_ARRAY()) AS image_urls
      FROM products p
      LEFT JOIN product_images pi ON pi.product_id = p.id
      GROUP BY p.id
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `, [limit, offset]);

    if (!productsRaw.length) {
      return res.status(404).json({ success: false, error: 'Produit introuvable' });
    }

    const products = productsRaw.map(p => ({
      id: p.id,
      title: p.title,
      description: p.description || null,
      price: parseFloat(p.price) || 0,
      stock: parseInt(p.stock) || 0,
      category: p.category || 'autre',
      image_urls: p.image_urls.length 
        ? p.image_urls 
        : (p.images || []).map(img => cloudinary.url(img)), // génère le lien Cloudinary
      created_at: p.created_at,
    }));

    // Total produits pour pagination
    const [[{ total }]] = await db.query('SELECT COUNT(*) AS total FROM products');

    res.json({
      success: true,
      page,
      pageSize: limit,
      totalProducts: total,
      totalPages: Math.ceil(total / limit),
      products
    });

  } catch (err) {
    console.error('Erreur GET /discover:', err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

module.exports = router;

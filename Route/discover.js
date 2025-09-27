

const express = require('express');
const router = express.Router();
const cloudinary = require('cloudinary').v2;
const authMiddleware = require('../middlewares/authMiddleware');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET,
});

// Pagination: page par défaut = 1, limit = 5
router.get('/all', authMiddleware, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 5;

    // Récupère toutes les images Cloudinary
    const cloudResult = await cloudinary.api.resources({
      type: 'upload',
      max_results: 500, // max autorisé par Cloudinary par appel
      prefix: 'products/', // si tes images sont sous un dossier "products"
    });

    const allImages = cloudResult.resources.map(img => ({
      id: img.public_id,
      title: img.context?.custom?.title || 'Produit',
      price: img.context?.custom?.price || '0',
      category: img.context?.custom?.category || 'autre',
      image_url: img.secure_url
    }));

    // Pagination
    const total = allImages.length;
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;
    const products = allImages.slice(offset, offset + limit);

    res.json({
      success: true,
      page,
      pageSize: limit,
      totalProducts: total,
      totalPages,
      products
    });
  } catch (error) {
    console.error('Erreur Discover Cloudinary:', error);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

module.exports = router;

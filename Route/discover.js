

const express = require('express');
const router = express.Router();
const db = require('../db');
const cloudinary = require('cloudinary').v2;

// Configuration Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET,
});

// Fonction pour formater les produits avec images Cloudinary
function formatProducts(products) {
  return products.map(p => {
    let image_urls = [];
    // Si tu as plusieurs images dans un champ JSON, par exemple p.images
    if (p.images && Array.isArray(p.images)) {
      image_urls = p.images.map(img => cloudinary.url(img, { secure: true }));
    } 
    // Sinon juste une image dans p.image
    else if (p.image) {
      image_urls = [cloudinary.url(p.image, { secure: true })];
    }
    return {
      ...p,
      image_urls
    };
  });
}

// GET /discover/all
router.get('/discover/all', async (req, res) => {
  try {
    const [allProducts] = await db.query('SELECT * FROM products');

    if (!allProducts || allProducts.length === 0) {
      return res.status(404).json({ success: false, error: 'Produit introuvable' });
    }

    const products = formatProducts(allProducts);

    res.status(200).json({
      success: true,
      count: products.length,
      products
    });

  } catch (err) {
    console.error('Erreur Discover All:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur discover' });
  }
});

module.exports = router;

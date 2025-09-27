

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

// Formater les produits avec URL Cloudinary
function formatProducts(products) {
  return products.map(p => {
    let image_urls = [];
    // Si plusieurs images stockées dans un champ JSON (ex: p.images)
    if (p.images && Array.isArray(p.images)) {
      image_urls = p.images.map(img => cloudinary.url(img, { secure: true }));
    } 
    // Sinon une seule image dans p.image
    else if (p.image) {
      image_urls = [cloudinary.url(p.image, { secure: true })];
    }
    return {
      ...p,
      image_urls
    };
  });
}

// GET /discover/all?page=1
router.get('/discover/all', async (req, res) => {
  try {
    let { page } = req.query;
    page = parseInt(page) || 1;
    const pageSize = 5;

    // Récupérer tous les produits
    const [allProducts] = await db.query('SELECT * FROM products');

    if (!allProducts || allProducts.length === 0) {
      return res.status(404).json({ success: false, error: 'Produit introuvable' });
    }

    const totalProducts = allProducts.length;
    const totalPages = Math.ceil(totalProducts / pageSize);

    // Pagination
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const productsPage = allProducts.slice(startIndex, endIndex);

    // Formater les images Cloudinary
    const products = formatProducts(productsPage);

    res.status(200).json({
      success: true,
      page,
      pageSize,
      totalProducts,
      totalPages,
      products
    });

  } catch (err) {
    console.error('Erreur Discover All Pagination:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur discover' });
  }
});

module.exports = router;
;

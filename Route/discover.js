

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

// Helper pour formater les produits avec URL Cloudinary
function formatProducts(products) {
  return products.map(p => ({
    ...p,
    image_urls: p.image ? [cloudinary.url(p.image, { secure: true })] : []
  }));
}

// GET /discover
router.get('/discover', async (req, res) => {
  try {
    let { lat, lon, page } = req.query;
    page = parseInt(page) || 1;
    const pageSize = 5;

    // Récupérer tous les produits
    const [allProducts] = await db.query('SELECT * FROM products');

    let productsFiltered = allProducts;

    // Filtrage par distance si lat/lon fournis
    if (lat && lon) {
      const from = { latitude: parseFloat(lat), longitude: parseFloat(lon) };
      productsFiltered = allProducts.filter(p => {
        if (!p.latitude || !p.longitude) return false;
        const to = { latitude: parseFloat(p.latitude), longitude: parseFloat(p.longitude) };
        const distanceKm = haversine(from, to) / 1000;
        return distanceKm <= 30;
      });
    }

    const totalProducts = productsFiltered.length;
    const totalPages = Math.ceil(totalProducts / pageSize);

    // Pagination
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const productsPage = productsFiltered.slice(startIndex, endIndex);

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
    console.error('Erreur Discover V1 Pagination :', err);
    res.status(500).json({ success: false, message: 'Erreur serveur discover' });
  }
});

module.exports = router;

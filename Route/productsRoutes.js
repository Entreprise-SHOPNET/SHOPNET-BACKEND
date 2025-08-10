

const express = require('express');
const router = express.Router();

// Exemple route GET /api/products
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await req.db.query('SELECT * FROM products');
    res.json({ success: true, products: rows });
  } catch (err) {
    next(err);
  }
});

// Exemple route POST /api/products
router.post('/', async (req, res, next) => {
  try {
    const { name, price } = req.body;
    if (!name || !price) {
      return res.status(400).json({ success: false, error: 'Name and price are required' });
    }
    const [result] = await req.db.query('INSERT INTO products (name, price) VALUES (?, ?)', [name, price]);
    res.status(201).json({ success: true, productId: result.insertId });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

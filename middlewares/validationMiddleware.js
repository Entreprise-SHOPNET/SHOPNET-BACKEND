


const { body, validationResult } = require('express-validator');

const validateProduct = [
  // Validation pour la création de produit
  body('title')
    .trim()
    .isLength({ min: 3 })
    .withMessage('Le titre doit contenir au moins 3 caractères'),
  
  body('price')
    .isFloat({ gt: 0 })
    .withMessage('Le prix doit être un nombre positif'),
  
  body('original_price')
    .optional()
    .isFloat({ gt: 0 })
    .withMessage('Le prix original doit être un nombre positif'),
  
  body('category')
    .optional()
    .isString()
    .withMessage('La catégorie doit être une chaîne de caractères'),
  
  body('condition')
    .optional()
    .isIn(['neuf', 'occasion', 'reconditionné'])
    .withMessage('Condition invalide'),
  
  body('stock')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Le stock doit être un nombre entier positif'),
  
  body('description')
    .optional()
    .isString()
    .withMessage('La description doit être une chaîne de caractères'),
  
  body('location')
    .optional()
    .isString()
    .withMessage('La localisation doit être une chaîne de caractères'),
  
  // Middleware pour gérer les erreurs
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false,
        errors: errors.array().map(err => err.msg) 
      });
    }
    next();
  }
];

module.exports = {
  validateProduct
};
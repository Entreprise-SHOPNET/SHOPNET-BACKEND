


// middlewares/errorHandler.js

function errorHandler(err, req, res, next) {
  console.error('❌ Erreur attrapée :', err);

  const statusCode = res.statusCode !== 200 ? res.statusCode : 500;

  res.status(statusCode).json({
    success: false,
    message: err.message || 'Une erreur est survenue sur le serveur.',
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
  });
}

module.exports = errorHandler;

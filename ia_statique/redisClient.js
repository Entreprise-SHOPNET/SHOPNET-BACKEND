

// ia_statique/redisClient.js
const redis = require('redis');
require('dotenv').config(); // Charge les variables d'environnement depuis .env

// Création du client Redis pour Render
// On utilise l'URL construite à partir des variables REDIS_HOST, REDIS_PORT, REDIS_USERNAME et REDIS_PASSWORD
const REDIS_URL = `redis://${process.env.REDIS_USERNAME}:${process.env.REDIS_PASSWORD}@${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`;

const redisClient = redis.createClient({
  url: REDIS_URL,
  socket: {
    reconnectStrategy: retries => {
      console.warn(`🔁 Redis reconnexion tentative #${retries}`);
      return Math.min(retries * 50, 5000); // max 5 secondes
    }
  }
});

// Gestion des événements pour éviter les crashes
redisClient.on('connect', () => {
  console.log('✅ Redis PROD connecté');
});

redisClient.on('ready', () => {
  console.log('🟢 Redis PROD prêt');
});

redisClient.on('error', (err) => {
  console.error('⚠️ Redis PROD error :', err.message);
});

redisClient.on('end', () => {
  console.warn('⚠️ Redis PROD déconnecté');
});

// Connexion au démarrage
(async () => {
  try {
    await redisClient.connect();
  } catch (err) {
    console.error('❌ Impossible de se connecter à Redis PROD :', err.message);
    // Ne pas arrêter le serveur si Redis n’est pas accessible
  }
})();

module.exports = redisClient;

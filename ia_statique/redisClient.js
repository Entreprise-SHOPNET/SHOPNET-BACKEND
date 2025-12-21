

// ia_statique/redisClient.js
const redis = require('redis');
require('dotenv').config(); // Charge les variables .env

// On utilise uniquement l'URL Redis locale
const redisClient = redis.createClient({
  url: process.env.REDIS_URL, // doit être redis://127.0.0.1:6379 dans ton .env
  socket: {
    reconnectStrategy: retries => {
      console.warn(`🔁 Redis reconnexion tentative #${retries}`);
      return Math.min(retries * 50, 5000); // max 5 sec
    }
  }
});

// Gestion des événements pour éviter les crashes
redisClient.on('connect', () => {
  console.log('✅ Redis LOCAL connecté');
});

redisClient.on('ready', () => {
  console.log('🟢 Redis LOCAL prêt');
});

redisClient.on('error', (err) => {
  console.error('⚠️ Redis LOCAL error :', err.message);
});

redisClient.on('end', () => {
  console.warn('⚠️ Redis LOCAL déconnecté');
});

// Connexion au démarrage
(async () => {
  try {
    await redisClient.connect();
  } catch (err) {
    console.error('❌ Impossible de se connecter à Redis LOCAL :', err.message);
    // Ne plus arrêter le serveur si Redis local n’est pas accessible
  }
})();

module.exports = redisClient;

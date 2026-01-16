

const redis = require('redis');
require('dotenv').config(); // Charge les variables .env

// Crée le client Redis avec les variables d'environnement
const redisClient = redis.createClient({
  socket: {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT),
    reconnectStrategy: retries => {
      console.warn(`🔁 Tentative de reconnexion Redis #${retries}`);
      return Math.min(retries * 50, 5000); // max 5 sec
    }
  },
  username: process.env.REDIS_USERNAME,
  password: process.env.REDIS_PASSWORD
});

// Gestion des événements pour logs et sécurité
redisClient.on('connect', () => {
  console.log('✅ Redis connecté');
});

redisClient.on('ready', () => {
  console.log('🟢 Redis prêt');
});

redisClient.on('error', (err) => {
  console.error('⚠️ Redis error :', err.message);
});

redisClient.on('end', () => {
  console.warn('⚠️ Redis déconnecté');
});

// Connexion au démarrage
(async () => {
  try {
    await redisClient.connect();
  } catch (err) {
    console.error('❌ Impossible de se connecter à Redis :', err.message);
    // Le serveur continue de tourner malgré l'erreur
  }
})();

module.exports = redisClient;

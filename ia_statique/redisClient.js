// ia_statique/redisClient.js
const redis = require('redis');
require('dotenv').config(); // Assure que les variables .env sont chargées

// Vérification des variables d'environnement
const { REDIS_HOST, REDIS_PORT, REDIS_USERNAME, REDIS_PASSWORD } = process.env;

if (!REDIS_HOST || !REDIS_PORT || !REDIS_PASSWORD) {
  console.error('❌ Erreur : Les variables REDIS_HOST, REDIS_PORT ou REDIS_PASSWORD ne sont pas définies.');
  process.exit(1); // Stoppe le serveur pour éviter de se connecter à localhost par erreur
}

const redisClient = redis.createClient({
  socket: {
    host: REDIS_HOST,
    port: parseInt(REDIS_PORT, 10),
    reconnectStrategy: retries => {
      console.warn(`Redis reconnect attempt #${retries}`);
      return Math.min(retries * 50, 5000); // max 5 sec
    }
  },
  username: REDIS_USERNAME || undefined,
  password: REDIS_PASSWORD
});

// Connexion au démarrage
(async () => {
  try {
    await redisClient.connect();
    console.log(`✅ Redis connecté sur ${REDIS_HOST}:${REDIS_PORT}`);
  } catch (err) {
    console.error('❌ Impossible de se connecter à Redis :', err);
    process.exit(1); // Stoppe le serveur si Redis est inaccessible
  }
})();

module.exports = redisClient;


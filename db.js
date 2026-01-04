

// db.js
// db.js
require('dotenv').config();
const mysql = require('mysql2/promise');

// ✅ Connexion MySQL PROD Railway
const host = process.env.DB_HOST || 'mysql.railway.internal';
const port = process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 3306;
const user = process.env.DB_USER || 'root';
const password = process.env.DB_PASSWORD || 'qyDCoLRmSqsoBHQqpVAEsdrsDzXcITne';
const database = process.env.DB_NAME || 'railway';

if (!host || !user || !password || !database) {
  throw new Error("❌ Variables d'environnement MySQL non définies !");
}

let pool;

function createPool() {
  pool = mysql.createPool({
    host,
    user,
    password,
    database,
    port,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });

  pool.on('connection', () => {
    console.log(`🔗 Nouvelle connexion MySQL établie sur ${host}:${port}`);
  });

  pool.on('error', (err) => {
    console.error('❌ Erreur MySQL dans le pool:', err);
    if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ETIMEDOUT') {
      console.log('🔄 Tentative de reconnexion automatique...');
      createPool();
    } else {
      throw err;
    }
  });
}

// Créer le pool initial
createPool();

// Test de connexion
(async () => {
  try {
    const conn = await pool.getConnection();
    console.log(`✅ Connecté à MySQL Railway sur ${host}:${port}, base "${database}"`);
    conn.release();
  } catch (err) {
    console.error('❌ Erreur de connexion MySQL Railway:', err.message);
    console.log('🔄 Nouvelle tentative dans 5 secondes...');
    setTimeout(async () => { await testConnection(); }, 5000);
  }
})();

module.exports = pool;

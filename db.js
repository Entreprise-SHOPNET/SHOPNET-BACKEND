



// db.js — Aiven MySQL (production ready)
// db.js — Aiven MySQL (production ready)
require('dotenv').config();
const mysql = require('mysql2/promise');

// Variables d'environnement
const {
  MYSQL_HOST,
  MYSQL_PORT,
  MYSQL_USER,
  MYSQL_PASSWORD,
  MYSQL_DATABASE,
  MYSQL_SSL_CERT,
} = process.env;

if (!MYSQL_HOST || !MYSQL_PORT || !MYSQL_USER || !MYSQL_PASSWORD || !MYSQL_DATABASE || !MYSQL_SSL_CERT) {
  throw new Error('❌ Variables MySQL Aiven manquantes dans le fichier .env');
}

let pool;

function createPool() {
  pool = mysql.createPool({
    host: MYSQL_HOST,
    port: Number(MYSQL_PORT),
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    database: MYSQL_DATABASE,

    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,

    // SSL Aiven à partir de la variable d'environnement
    ssl: {
      ca: MYSQL_SSL_CERT.replace(/\\n/g, '\n'),
      rejectUnauthorized: true,
    },
  });

  pool.on('connection', () => {
    console.log('🔗 Nouvelle connexion MySQL via Aiven');
  });

  pool.on('error', (err) => {
    console.error('❌ Erreur MySQL:', err);
    if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ETIMEDOUT') {
      console.log('🔄 Reconnexion automatique MySQL...');
      createPool();
    } else {
      throw err;
    }
  });
}

// Création initiale du pool
createPool();

// Test de connexion au démarrage
async function testConnection() {
  let conn;
  try {
    conn = await pool.getConnection();
    console.log('✅ Connecté à MySQL Aiven avec succès (SSL OK)');
  } catch (err) {
    console.error('❌ Échec connexion MySQL Aiven:', err.message);
    console.log('🔄 Nouvelle tentative dans 5 secondes...');
    setTimeout(testConnection, 5000);
  } finally {
    if (conn) conn.release();
  }
}

testConnection();

module.exports = pool;

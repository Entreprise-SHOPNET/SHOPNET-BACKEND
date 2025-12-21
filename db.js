

require('dotenv').config();
const mysql = require('mysql2/promise');

const host = process.env.MYSQL_HOST || 'localhost';
const port = process.env.MYSQL_PORT ? parseInt(process.env.MYSQL_PORT) : 3306;
const user = process.env.MYSQL_USER || 'root';
const password = process.env.MYSQL_PASSWORD || '';
const database = process.env.MYSQL_DATABASE || 'shopnet_local_db';

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
    console.log('🔗 Nouvelle connexion MySQL établie');
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
async function testConnection() {
  let connection;
  try {
    connection = await pool.getConnection();
    console.log(`✅ Connecté à MySQL en local sur ${host}:${port} base "${database}"`);
  } catch (err) {
    console.error('❌ Erreur de connexion MySQL:', err.message);
    console.log('🔄 Nouvelle tentative dans 5 secondes...');
    setTimeout(testConnection, 5000);
  } finally {
    if (connection) connection.release();
  }
}

testConnection();

module.exports = pool;

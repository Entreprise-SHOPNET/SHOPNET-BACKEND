

// db.js
require('dotenv').config();
const mysql = require('mysql2/promise');
const url = require('url');

if (!process.env.MYSQL_PUBLIC_URL) {
  console.error("❌ La variable d'environnement MYSQL_PUBLIC_URL est manquante.");
  process.exit(1);
}

const params = url.parse(process.env.MYSQL_PUBLIC_URL);

if (!params.auth || !params.hostname || !params.pathname) {
  console.error("❌ MYSQL_PUBLIC_URL invalide dans .env");
  process.exit(1);
}

const [user, password] = params.auth.split(':');
const database = params.pathname.replace('/', '');
const host = params.hostname;
const port = params.port ? parseInt(params.port) : 3306;

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

  pool.on('connection', (connection) => {
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

// Fonction pour tester la connexion au démarrage
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


// Lancer le test initial
testConnection();

module.exports = pool;


// db.js
require('dotenv').config();
const mysql = require('mysql2/promise');

// Utilisation de l'URL publique Railway pour Render
const databaseUrl = process.env.MYSQL_PUBLIC_URL;

if (!databaseUrl) {
  throw new Error("❌ MYSQL_PUBLIC_URL non défini dans le .env");
}

let pool;

function createPool() {
  // Crée le pool MySQL avec l'URL publique
  pool = mysql.createPool(databaseUrl + '?connectionLimit=10');

  pool.on('connection', () => {
    console.log('🔗 Nouvelle connexion MySQL via Railway PUBLIC URL');
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

// Test de connexion avec reconnexion automatique
async function testConnection() {
  let conn;
  try {
    conn = await pool.getConnection();
    console.log('✅ Connecté à MySQL Railway via PUBLIC URL');
  } catch (err) {
    console.error('❌ Erreur de connexion MySQL Railway:', err.message);
    console.log('🔄 Nouvelle tentative dans 5 secondes...');
    setTimeout(testConnection, 5000);
  } finally {
    if (conn) conn.release();
  }
}

// Lancer le test au démarrage
testConnection();

module.exports = pool;

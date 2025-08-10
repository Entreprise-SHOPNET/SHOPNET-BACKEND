

// db.js - Version corrigée et optimisée
const mysql = require('mysql2/promise'); // Modification cruciale ici

// Configuration du pool de connexions
const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: 'MySQL_2025#Pass',
  database: 'shopnet',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Test de connexion au démarrage
async function testConnection() {
  let connection;
  try {
    connection = await pool.getConnection();
    console.log('✅ Connecté à MySQL');
  } catch (err) {
    console.error('❌ Erreur de connexion MySQL:', err.message);
    process.exit(1);
  } finally {
    if (connection) connection.release();
  }
}

// Exécution du test
testConnection();

// Export direct du pool (qui a déjà les méthodes promises)
module.exports = pool;
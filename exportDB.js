const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

// Fonction pour exporter la base Railway
async function exportDB() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'tramway.proxy.rlwy.net',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'ttMMcidXhgqyBMILkIOKnqEZwFufzlkb',
        database: process.env.DB_NAME || 'railway',
        port: process.env.DB_PORT || 13291
    });

    const [tables] = await connection.query("SHOW TABLES");
    let sqlDump = '';

    for (const t of tables) {
        const tableName = Object.values(t)[0];
        const [create] = await connection.query(`SHOW CREATE TABLE \`${tableName}\``);
        sqlDump += `${create[0]['Create Table']};\n\n`;

        const [rows] = await connection.query(`SELECT * FROM \`${tableName}\``);
        rows.forEach(row => {
            const cols = Object.keys(row).map(c => `\`${c}\``).join(',');
            const vals = Object.values(row).map(v => connection.escape(v)).join(',');
            sqlDump += `INSERT INTO \`${tableName}\` (${cols}) VALUES (${vals});\n`;
        });
        sqlDump += '\n\n';
    }

    // Sauvegarde dans le dossier du projet Render
    const filePath = path.join(__dirname, 'railway_backup.sql');
    fs.writeFileSync(filePath, sqlDump);
    console.log(`✔ Backup créé : ${filePath}`);

    await connection.end();
}

module.exports = { exportDB };

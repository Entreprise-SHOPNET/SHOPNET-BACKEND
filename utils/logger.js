

// utils/logger.js
const fs = require('fs');
const path = require('path');
const { format } = require('date-fns');

const LOGS_DIR = path.resolve(__dirname, '../../logs');
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR);
}

const logStream = fs.createWriteStream(
  path.join(LOGS_DIR, 'activity.log'), 
  { flags: 'a' }
);

module.exports.logActivity = (action, details, level = 'info') => {
  const timestamp = format(new Date(), 'yyyy-MM-dd HH:mm:ss');
  const message = `[${timestamp}] [${level.toUpperCase()}] ${action}: ${details}\n`;
  
  logStream.write(message);
  
  if (level === 'error') {
    console.error(message);
  } else if (level === 'warn') {
    console.warn(message);
  } else {
    console.log(message);
  }
};
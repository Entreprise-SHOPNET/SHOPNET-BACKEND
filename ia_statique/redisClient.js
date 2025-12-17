// redisClient.js
const redis = require('redis');

const redisClient = redis.createClient({
  socket: {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT),
  },
  username: process.env.REDIS_USERNAME,
  password: process.env.REDIS_PASSWORD
});

redisClient.connect()
  .then(() => console.log('✅ Redis connecté'))
  .catch(console.error);

module.exports = redisClient;




// presenceManager.js

class PresenceManager {
  constructor(io) {
    this.io = io;
    this.connectedUsers = new Map();
  }

  init() {
    this.io.on('connection', (socket) => {
      console.log(`📡 Nouveau client connecté : ${socket.id}`);

      socket.on('registerUser', (userId) => {
        if (!userId) return;
        this.connectedUsers.set(userId, socket);
        this.broadcastOnlineUsers();
      });

      socket.on('disconnect', () => {
        for (const [userId, s] of this.connectedUsers.entries()) {
          if (s.id === socket.id) {
            this.connectedUsers.delete(userId);
            this.broadcastOnlineUsers();
            break;
          }
        }
      });
    });
  }

  broadcastOnlineUsers() {
    const onlineUserIds = Array.from(this.connectedUsers.keys());
    this.io.emit('online_users', onlineUserIds);
  }

  isUserOnline(userId) {
    return this.connectedUsers.has(userId);
  }
}

module.exports = PresenceManager;

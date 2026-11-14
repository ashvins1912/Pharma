export function createMongooseDatabaseAdapter({ mongoose, uri, database, options = {} } = {}) {
  if (!mongoose || typeof mongoose.connect !== 'function' || typeof mongoose.disconnect !== 'function') {
    throw new TypeError('A Mongoose instance is required.');
  }
  if (!uri || typeof uri !== 'string') throw new TypeError('A MongoDB connection URI is required.');

  let connected = false;
  return Object.freeze({
    provider: 'mongodb',
    async connect() {
      if (mongoose.connection?.readyState === 1) {
        connected = true;
        return mongoose.connection;
      }
      await mongoose.connect(uri, { dbName: database, ...options });
      connected = true;
      return mongoose.connection;
    },
    isReady() {
      return connected && mongoose.connection?.readyState === 1;
    },
    async ping() {
      if (!this.isReady()) return false;
      await mongoose.connection.db.admin().ping();
      return true;
    },
    async disconnect() {
      if (mongoose.connection?.readyState && mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
      connected = false;
    }
  });
}

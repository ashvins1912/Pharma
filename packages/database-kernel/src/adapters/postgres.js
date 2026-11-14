export function createPostgresDatabaseAdapter({ Pool, connectionString, poolOptions = {} } = {}) {
  if (typeof Pool !== 'function') throw new TypeError('The PostgreSQL Pool constructor must be supplied by the service.');
  if (!connectionString || typeof connectionString !== 'string') throw new TypeError('A PostgreSQL connection string is required.');

  let pool;
  let connected = false;
  const getPool = () => {
    if (!pool) pool = new Pool({ connectionString, ...poolOptions });
    return pool;
  };

  return Object.freeze({
    provider: 'postgresql',
    async connect() {
      const currentPool = getPool();
      await currentPool.query('SELECT 1');
      connected = true;
      return currentPool;
    },
    isReady() { return connected && Boolean(pool); },
    async ping() {
      if (!connected || !pool) return false;
      await pool.query('SELECT 1');
      return true;
    },
    async query(text, values = []) {
      if (!connected) throw new Error('PostgreSQL adapter is not connected.');
      return pool.query(text, values);
    },
    async withTransaction(work) {
      if (!connected) throw new Error('PostgreSQL adapter is not connected.');
      if (typeof work !== 'function') throw new TypeError('Transaction work callback is required.');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await work({ query: (text, values = []) => client.query(text, values) });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try { await client.query('ROLLBACK'); }
        catch (rollbackError) { error.rollbackError = rollbackError; }
        throw error;
      } finally {
        client.release();
      }
    },
    async disconnect() {
      if (pool) await pool.end();
      pool = undefined;
      connected = false;
    }
  });
}

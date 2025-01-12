import pg from 'pg';

export async function setupDatabase() {
    // Disable SSL verification entirely for now
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    
    const pool = new pg.Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: {
            rejectUnauthorized: false
        },
        max: 3,                      // Further reduce max connections
        idleTimeoutMillis: 5000,     // Close idle clients faster
        connectionTimeoutMillis: 2000,// Return error after 2s
        maxUses: 1000,               // Recycle connections more frequently
        allowExitOnIdle: true        // Allow pool to exit when idle
    });

    // Add connection error handler
    pool.on('error', (err) => {
        console.error('Unexpected error on idle client', err);
        // Don't throw error here, just log it
    });

    // Add connection limit warning
    pool.on('connect', () => {
        pool.query('SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database()')
            .then(result => {
                const count = parseInt(result.rows[0].count);
                if (count > 2) { // Warning at 66% of max
                    console.warn(`High connection count: ${count}, closing idle connections...`);
                    pool.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = \'idle\'');
                }
            })
            .catch(err => console.error('Connection count check failed:', err));
    });

    try {
        // Test the connection
        const client = await pool.connect();
        try {
            await client.query('SELECT NOW()');
            console.log('Database connection successful');
            return pool;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Database connection failed:', error);
        throw error;
    }
}

// Helper functions for common operations
export const dbHelpers = {
    async withTransaction(db, callback) {
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const result = await callback(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    },

    async healthCheck(db) {
        try {
            const client = await db.connect();
            try {
                await client.query('SELECT 1');
                return true;
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('Health check failed:', error);
            return false;
        }
    }
};
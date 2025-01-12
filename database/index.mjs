import pg from 'pg';

let isConnecting = false;

export async function setupDatabase() {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    
    if (isConnecting) {
        throw new Error('Connection attempt already in progress');
    }
    
    isConnecting = true;
    
    try {
        const pool = new pg.Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: {
                rejectUnauthorized: false
            },
            max: 1,                      // Single connection only
            idleTimeoutMillis: 1000,     // Close idle clients very quickly
            connectionTimeoutMillis: 5000,// Longer timeout for initial connection
            maxUses: 100,                // Recycle connections frequently
            allowExitOnIdle: true        // Allow pool to exit when idle
        });

        // Add error handler
        pool.on('error', (err) => {
            console.error('Unexpected error on idle client', err);
            if (!pool.ending) {
                // Only reconnect if not already ending
                setupDatabase().catch(console.error);
            }
        });

        // Test the connection
        await pool.query('SELECT 1');
        console.log('Database connection successful');
        
        return pool;
    } finally {
        isConnecting = false;
    }
}

export const dbHelpers = {
    async withTransaction(db, callback) {
        if (!db || db.ending) {
            throw new Error('Database not connected');
        }
        
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
            client.release(true);
        }
    }
};
import pg from 'pg';

export async function setupDatabase() {
    // Disable SSL verification entirely for now
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    
    let pool = new pg.Pool({
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

    // Add connection error handler
    pool.on('error', (err) => {
        console.error('Unexpected error on idle client', err);
    });

    // Add connection monitoring
    pool.on('connect', () => {
        console.log('New database connection established');
    });

    pool.on('remove', () => {
        console.log('Database connection removed from pool');
    });

    // Retry connection with increasing delays
    for (let attempt = 1; attempt <= 5; attempt++) {
        try {
            // Wait before attempting connection
            if (attempt > 1) {
                const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
                console.log(`Waiting ${delay}ms before attempt ${attempt}...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }

            // Test the connection
            await pool.query('SELECT 1');
            console.log('Database connection successful');
            return pool;
        } catch (error) {
            console.error(`Database connection attempt ${attempt} failed:`, error.message);
            
            if (attempt === 5) {
                console.error('All connection attempts failed');
                throw error;
            }

            // Force cleanup between attempts
            try {
                await pool.end();
            } catch (endError) {
                console.error('Error ending pool:', endError.message);
            }

            // Create new pool for next attempt
            pool = new pg.Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: { rejectUnauthorized: false },
                max: 1,
                idleTimeoutMillis: 1000,
                connectionTimeoutMillis: 5000,
                maxUses: 100,
                allowExitOnIdle: true
            });
        }
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
            client.release(true); // Force release
        }
    },

    async healthCheck(db) {
        try {
            const client = await db.connect();
            try {
                await client.query('SELECT 1');
                return true;
            } finally {
                client.release(true); // Force release
            }
        } catch (error) {
            console.error('Health check failed:', error);
            return false;
        }
    }
};
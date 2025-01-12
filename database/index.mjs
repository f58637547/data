import pg from 'pg';

export async function setupDatabase() {
    // Disable SSL verification entirely for now
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    
    const pool = new pg.Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: {
            rejectUnauthorized: false
        },
        max: 2,                      // Limit to 2 connections
        idleTimeoutMillis: 1000,     // Close idle clients very quickly
        connectionTimeoutMillis: 2000,// Return error after 2s
        maxUses: 100,                // Recycle connections frequently
        allowExitOnIdle: true        // Allow pool to exit when idle
    });

    // Add connection error handler
    pool.on('error', (err) => {
        console.error('Unexpected error on idle client', err);
        // Don't throw error here, just log it
    });

    // Add connection monitoring without extra queries
    let connectionCount = 0;
    pool.on('connect', () => {
        connectionCount++;
        if (connectionCount > 1) {
            console.warn(`Active connections: ${connectionCount}`);
        }
    });

    pool.on('remove', () => {
        connectionCount = Math.max(0, connectionCount - 1);
    });

    // Retry connection setup with backoff
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const client = await pool.connect();
            try {
                await client.query('SELECT NOW()');
                console.log('Database connection successful');
                return pool;
            } finally {
                client.release(true); // Force release
            }
        } catch (error) {
            console.error(`Database connection attempt ${attempt} failed:`, error);
            if (attempt === 3) throw error;
            // Wait before retry with exponential backoff
            await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
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
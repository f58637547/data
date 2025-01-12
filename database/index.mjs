import pg from 'pg';

export async function setupDatabase() {
    // Disable SSL verification entirely for now
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    
    // Parse existing connection string
    const connectionString = process.env.DATABASE_URL;
    const match = connectionString.match(/postgres:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
    
    if (!match) {
        throw new Error('Invalid DATABASE_URL format');
    }

    // Reconstruct with superuser role
    const [, user, pass, host, port, db] = match;
    const superuserUrl = `postgres://postgres:${pass}@${host}:${port}/${db}`;
    
    const pool = new pg.Pool({
        connectionString: superuserUrl,
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
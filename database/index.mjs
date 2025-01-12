import pg from 'pg';

export async function setupDatabase() {
    const db = new pg.Pool({
        connectionString: process.env.DATABASE_URL,
        max: 20,                 // Maximum number of clients
        idleTimeoutMillis: 30000, // Close idle clients after 30s
        connectionTimeoutMillis: 2000 // Return an error after 2s if connection not established
    });

    // Add error logging
    db.on('connect', () => {
        console.log('Database connected');
    });

    db.on('error', (err) => {
        console.error('Unexpected database error:', err);
    });

    db.on('acquire', () => {
        console.debug('Client acquired from pool');
    });

    db.on('remove', () => {
        console.debug('Client removed from pool');
    });

    // Test connection
    try {
        const client = await db.connect();
        await client.query('SELECT NOW()');
        client.release();
        console.log('Database connection verified');
    } catch (error) {
        console.error('Database connection failed:', error);
        throw error;
    }

    return db;
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
import pg from 'pg';
import fs from 'fs';

export async function setupDatabase() {
    const pool = new pg.Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: {
            ca: fs.readFileSync('ca-certificate.crt').toString(),
            rejectUnauthorized: true
        }
    });

    // Add error logging on pool
    pool.on('connect', () => {
        console.log('Database pool client connected');
    });

    pool.on('error', (err, client) => {
        console.error('Unexpected error on idle client', err);
    });

    try {
        // Test the connection
        await pool.query('SELECT NOW()');
        console.log('Database connection successful');
        return pool;
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
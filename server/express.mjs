import express from 'express';
import { dbHelpers } from '../database/index.mjs';

export async function setupExpress() {
    const app = express();
    const port = process.env.PORT || 3008;

    // Middleware
    app.use(express.json());
    app.use((_req, res, next) => {
        res.setHeader('X-Service-Version', process.env.APP_VERSION || '1.0.0');
        next();
    });

    // Basic health check endpoint
    app.get('/health', async (req, res) => {
        try {
            const dbStatus = await dbHelpers.healthCheck(req.app.locals.db);
            res.json({
                status: 'ok',
                timestamp: new Date().toISOString(),
                version: process.env.APP_VERSION || '1.0.0',
                database: dbStatus ? 'connected' : 'disconnected'
            });
        } catch (error) {
            res.status(500).json({
                status: 'error',
                message: 'Health check failed',
                timestamp: new Date().toISOString()
            });
        }
    });

    // Root endpoint
    app.get('/', (_req, res) => {
        res.json({
            message: 'API is running',
            version: process.env.APP_VERSION || '1.0.0'
        });
    });

    // Error handling middleware
    app.use((err, _req, res, _next) => {
        console.error('Express error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Internal server error'
        });
    });

    // Start server
    return new Promise((resolve, reject) => {
        try {
            const server = app.listen(port, () => {
                console.log(`Express server running on port ${port}`);
                resolve(app);
            });

            // Handle server errors
            server.on('error', (error) => {
                console.error('Express server error:', error);
                reject(error);
            });
        } catch (error) {
            console.error('Failed to start Express server:', error);
            reject(error);
        }
    });
}
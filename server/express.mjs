import express from 'express';
import { dbHelpers } from '../database/index.mjs';

export async function setupExpress() {
    const app = express();
    const port = process.env.PORT || 3008;

    // Middleware
    app.use(express.json());
    app.use((req, res, next) => {
        res.setHeader('X-Service-Version', process.env.APP_VERSION || '1.0.0');
        next();
    });

    // Basic health check
    app.get('/', (_req, res) => {
        res.send('Service is running');
    });

    // Detailed status endpoint
    app.get('/status', async (_req, res) => {
        const services = global.services || {};
        const health = {
            status: 'ok',
            timestamp: new Date().toISOString(),
            version: process.env.APP_VERSION || '1.0.0',
            services: {
                db: await dbHelpers.healthCheck(services.db),
                discord: services.bot?.isReady() || false,
                api: true
            },
            uptime: process.uptime(),
            memory: process.memoryUsage()
        };

        const isHealthy = Object.values(health.services).every(Boolean);
        res.status(isHealthy ? 200 : 503).json(health);
    });

    // Metrics endpoint
    app.get('/metrics', (_req, res) => {
        const metrics = {
            process: {
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                cpu: process.cpuUsage()
            },
            services: global.services?.health || {}
        };
        res.json(metrics);
    });

    // Error handling
    app.use((err, _req, res, _next) => {
        console.error('Express error:', err);
        res.status(500).json({
            error: 'Internal server error',
            message: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    });

    const server = app.listen(port, () => {
        console.log(`Server running on port ${port}`);
    });

    // Handle server errors
    server.on('error', (error) => {
        console.error('Express server error:', error);
    });

    return server; // Return server instead of app for proper cleanup
}
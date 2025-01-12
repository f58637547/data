// Main entry point
import dotenv from 'dotenv';
import { startDiscordBot } from './services/discord.mjs';
import { setupDatabase } from './database/index.mjs';
import { setupExpress } from './server/express.mjs';
import { setupTemplates } from './templates/index.mjs';

dotenv.config();

// Track services for cleanup
const services = {
    db: null,
    app: null,
    bot: null,
    health: {
        db: false,
        app: false,
        bot: false,
        lastCheck: null
    }
};

// Health check function
async function checkHealth() {
    try {
        // Check DB
        if (services.db) {
            await services.db.query('SELECT 1');
            services.health.db = true;
        }

        // Check Discord
        if (services.bot?.isReady()) {
            services.health.bot = true;
        }

        // Check Express
        if (services.app?.listening) {
            services.health.app = true;
        }

        services.health.lastCheck = new Date();
        return services.health;
    } catch (error) {
        console.error('Health check failed:', error);
        return false;
    }
}

// Reconnection logic
async function reconnect(service) {
    console.log(`Attempting to reconnect ${service}...`);
    try {
        switch(service) {
            case 'db':
                if (services.db) await services.db.end();
                services.db = await setupDatabase();
                break;
            case 'bot':
                if (services.bot) await services.bot.destroy();
                services.bot = await startDiscordBot({
                    db: services.db,
                    templates: await setupTemplates()
                });
                break;
            default:
                throw new Error(`Unknown service: ${service}`);
        }
        console.log(`${service} reconnected successfully`);
        return true;
    } catch (error) {
        console.error(`Failed to reconnect ${service}:`, error);
        return false;
    }
}

// Enhanced cleanup
async function cleanup(code = 0) {
    console.log('Cleaning up services...');
    try {
        const tasks = [];
        if (services.bot) {
            tasks.push(services.bot.destroy()
                .catch(e => console.error('Bot cleanup error:', e)));
        }
        if (services.db) {
            tasks.push(services.db.end()
                .catch(e => console.error('DB cleanup error:', e)));
        }
        if (services.app) {
            tasks.push(new Promise(resolve => {
                services.app.close(err => {
                    if (err) console.error('Express cleanup error:', err);
                    resolve();
                });
            }));
        }
        await Promise.allSettled(tasks);
    } catch (error) {
        console.error('Cleanup error:', error);
    } finally {
        process.exit(code);
    }
}

// Service monitoring
function startMonitoring() {
    // Health checks every 30 seconds
    setInterval(async () => {
        const health = await checkHealth();

        // Attempt reconnection for failed services
        if (!health.db) await reconnect('db');
        if (!health.bot) await reconnect('bot');

        // Log status
        console.log('Service health:', health);
    }, 30000);
}

async function main() {
    try {
        // Initialize components
        services.db = await setupDatabase();
        const templates = await setupTemplates();
        services.app = await setupExpress();
        services.bot = await startDiscordBot({
            db: services.db,
            templates
        });

        console.log('All services started successfully');

        // Start monitoring
        startMonitoring();

        // Handle cleanup
        process.on('SIGTERM', () => cleanup(0));
        process.on('SIGINT', () => cleanup(0));
        process.on('uncaughtException', (error) => {
            console.error('Uncaught exception:', error);
            cleanup(1);
        });
        process.on('unhandledRejection', (error) => {
            console.error('Unhandled rejection:', error);
            cleanup(1);
        });

    } catch (error) {
        console.error('Startup error:', error);
        await cleanup(1);
    }
}

main();
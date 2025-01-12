// Main entry point
import 'dotenv/config';
import { startDiscordBot } from './services/discord.mjs';
import { setupDatabase } from './database/index.mjs';
import { setupExpress } from './server/express.mjs';
import { loadTemplates } from './templates/index.mjs';

let db = null;
let app = null;
let bot = null;

async function reconnect() {
    console.log('Attempting to reconnect...');
    
    if (db) {
        try {
            await db.end();
        } catch (err) {
            console.error('Error ending db pool:', err.message);
        }
    }
    
    try {
        db = await setupDatabase();
        console.log('Database reconnected');
    } catch (error) {
        console.error('Failed to reconnect db:', error);
    }
}

async function main() {
    try {
        // Load templates first since they don't depend on connections
        const templates = await loadTemplates();
        
        // Setup database
        db = await setupDatabase();
        
        // Setup express after db is ready
        app = await setupExpress();
        app.locals.db = db;
        
        // Start bot last since it depends on both db and templates
        bot = await startDiscordBot({ db, templates });
        
        console.log('All services started successfully');
        
        // Handle cleanup
        process.on('SIGTERM', cleanup);
        process.on('SIGINT', cleanup);
        
    } catch (error) {
        console.error('Startup error:', error);
        await cleanup();
        process.exit(1);
    }
}

async function cleanup() {
    console.log('Cleaning up services...');
    
    if (bot) {
        try {
            bot.destroy();
        } catch (err) {
            console.error('Error destroying bot:', err);
        }
    }
    
    if (db) {
        try {
            await db.end();
        } catch (err) {
            console.error('Error closing db:', err);
        }
    }
}

main().catch(console.error);
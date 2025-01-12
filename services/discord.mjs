import { Client, GatewayIntentBits } from 'discord.js';
import { processMessage } from './processor.mjs';

export async function startDiscordBot({ db, templates }) {
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
        ],
    });

    // Channel mappings
    const channelMappings = {
        [process.env.DISCORD_CHANNEL_1]: { table: 'memories', type: 'crypto' },
        [process.env.DISCORD_CHANNEL_2]: { table: 'memories', type: 'trades' },
        [process.env.DISCORD_CHANNEL_3]: { table: 'memories', type: 'ainews' },
        [process.env.DISCORD_CHANNEL_4]: { table: 'memories', type: 'aiusers' },
    };

    client.on('messageCreate', async (message) => {
        if (message.author.id === client.user.id) return;

        const channelMapping = channelMappings[message.channel.id];
        if (!channelMapping) return;

        try {
            const result = await processMessage({
                message,
                db,
                templates,
                channelMapping
            });

            if (result.skip) {
                console.log(`Skipped: ${result.reason}`);
                return;
            }

            console.log(`Processed message in ${channelMapping.type}`);
        } catch (error) {
            console.error('Message processing error:', error);
        }
    });

    await client.login(process.env.DISCORD_BOT_TOKEN);
    return client;
}
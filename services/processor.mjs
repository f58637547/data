import { v4 as uuidv4 } from 'uuid';
import { generateEmbedding } from './openai.mjs';
import { extractEntities } from '../templates/index.mjs';

export async function processMessage({ message, db, channelMapping }) {
    try {
        // 1. Get plain text from Discord
        let rawText = message.content || '';
        if (message.embeds?.length > 0) {
            const embedText = message.embeds
                .map(embed => embed.description)
                .filter(Boolean)
                .join(' ');
            rawText = rawText + ' ' + embedText;
        }

        rawText = rawText.trim();
        if (!rawText) {
            return { skip: true, reason: 'no_content' };
        }

        // Clean text but keep important stuff
        const cleanText = rawText
            .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}]/gu, '') // Remove emojis
            .replace(/https?:\/\/\S+/g, '') // Remove URLs
            .replace(/[^\w\s$.,!?#@/-]/g, '') // Keep alphanumeric, $, #, @, /, basic punctuation
            .replace(/\s+/g, ' ')
            .trim();

        if (cleanText.length < 10) {
            return { skip: true, reason: 'no_content' };
        }

        // 2. Generate embedding for similarity check
        const newEmbedding = await generateEmbedding(cleanText);

        // 3. Check similarity against ALL posts from last 24h across ALL types
        const similarityCheck = await db.query(`
            SELECT 
                content->>'original' as text,
                type,
                1 - (embedding <-> $1::vector) as similarity
            FROM memories
            WHERE "createdAt" > NOW() - INTERVAL '24 hours'
            AND type IN ('crypto', 'trades', 'ainews', 'aiusers')
            AND 1 - (embedding <-> $1::vector) > 0.65
            ORDER BY similarity DESC
        `, [`[${newEmbedding}]`]);

        if (similarityCheck.rows.length > 0) {
            console.log('Similar content found:', {
                new_text: cleanText,
                similar_count: similarityCheck.rows.length,
                top_match: {
                    text: similarityCheck.rows[0].text,
                    type: similarityCheck.rows[0].type,
                    similarity: (similarityCheck.rows[0].similarity * 100).toFixed(2) + '%'
                }
            });
            return { skip: true, reason: 'similar_content' };
        }

        // 4. Process and validate content
        const parsedContent = await extractEntities(cleanText, channelMapping.type);

        // Add validation here before saving
        const validEventTypes = {
            crypto: [
                // PROJECT NEWS
                'LISTING',        // New listings
                'DELISTING',      // Removals
                'DEVELOPMENT',    // Code updates
                'UPGRADE',        // Protocol changes
                
                // MARKET EVENTS
                'MARKET_MOVE',    // General market movement
                'WHALE_MOVE',     // Large transactions
                'FUND_FLOW',      // Institutional money
                'VOLUME_SPIKE',   // Trading volume spikes
                'PRICE_ALERT',    // Price movements
                'ACCUMULATION',   // Buying zones
                'DISTRIBUTION',   // Selling zones
                
                // SECURITY
                'HACK',           // Breaches
                'EXPLOIT',        // Vulnerabilities
                'RUGPULL',        // Scams
                
                // BUSINESS
                'PARTNERSHIP',    // Deals
                'ACQUISITION',    // Mergers
                'REGULATION',     // Legal updates
                
                // OTHERS
                'UPDATE',         // General updates
                'INTEGRATION',    // Platform integrations
                'AIRDROP',        // Token distributions
                'TOKENOMICS',     // Supply changes
                'FORK',           // Chain splits
                'BRIDGE'          // Cross-chain
            ],
            trades: [
                // ENTRY SIGNALS
                'SPOT_ENTRY',     // Spot buys
                'FUTURES_ENTRY',  // Futures positions
                'LEVERAGE_ENTRY', // Margin trades
                
                // EXIT SIGNALS
                'TAKE_PROFIT',    // Profit targets
                'STOP_LOSS',      // Stop hits
                'POSITION_EXIT',  // General exits
                
                // ANALYSIS
                'BREAKOUT',       // Pattern breaks
                'REVERSAL',       // Trend changes
                'ACCUMULATION',   // Buying zones
                'DISTRIBUTION',   // Selling zones
                'MARKET_MOVE',    // General market movement
                'WHALE_MOVE',     // Large transactions
                'FUND_FLOW',      // Institutional money
                'VOLUME_SPIKE',   // Unusual trading volume
                'PRICE_ALERT',    // Significant price moves
            ]
        };

        // Validate before saving
        if (!validEventTypes[channelMapping.type].includes(parsedContent.event?.type)) {
            console.log('Skipping: Invalid event type:', parsedContent.event?.type);
            return { skip: true, reason: 'invalid_event_type' };
        }

        // 5. Process and save unique content
        await db.query(`
            INSERT INTO ${channelMapping.table}
            (id, "createdAt", type, "agentId", content, embedding)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [
            uuidv4(),
            new Date(),
            channelMapping.type,
            process.env.AGENT_ID,
            JSON.stringify({
                original: cleanText,
                entities: parsedContent,
                type: channelMapping.type
            }),
            `[${newEmbedding}]` // Reuse the embedding we already generated
        ]);

        console.log('Saved new content:', {
            type: channelMapping.type,
            preview: cleanText.substring(0, 100) + '...'
        });

        return { success: true };

    } catch (error) {
        console.error('Processing error:', {
            error: error.message,
            preview: message.content?.substring(0, 100) || 
                    message.embeds?.[0]?.description?.substring(0, 100) || 
                    'No preview available'
        });
        return { skip: true, reason: 'processing_error' };
    }
}

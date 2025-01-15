import { v4 as uuidv4 } from 'uuid';
import { generateEmbedding } from './openai.mjs';
import { extractEntities } from '../templates/index.mjs';

export async function processMessage({ message, db, channelMapping }) {
    try {
        // Log original message
        console.log('\n=== Original Message ===');
        console.log('Content:', message.content);
        console.log('Embeds:', message.embeds);

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

        // Log cleaned text
        console.log('\n=== Cleaned Text ===');
        console.log(cleanText);

        // Parse content
        const parsedContent = await extractEntities(cleanText, channelMapping.type);
        console.log('\n=== Parsed Content ===');
        console.log(JSON.stringify(parsedContent, null, 2));

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
                'BRIDGE',         // Cross-chain
                'DELEGATE',       // Staking
                'REBASE',         // Price rebalancing
                'LIQUIDITY_POOL', // Liquidity pools
                'DEX',            // Decentralized exchanges
                'DEFI',           // Decentralized finance
                'DEX_POOL',       // Decentralized exchange pools
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

        // Log validation
        console.log('\n=== Event Type Validation ===');
        console.log('Type:', parsedContent.event?.type);
        console.log('Valid Types:', validEventTypes[channelMapping.type]);
        console.log('Is Valid:', validEventTypes[channelMapping.type].includes(parsedContent.event?.type));

        // Keep validation
        if (!validEventTypes[channelMapping.type].includes(parsedContent.event?.type)) {
            console.log('Skipping: Invalid event type:', parsedContent.event?.type);
            return { skip: true, reason: 'invalid_event_type' };
        }

        // 3. THEN generate embedding
        const newEmbedding = await generateEmbedding(cleanText);

        // 4. THEN do similarity check
        console.log('Running similarity checks...');
        const similarityCheck = await db.query(`
            SELECT 
                content->>'original' as text,
                type,
                -- Only vector similarity
                1 - (embedding <-> $1::vector) as vector_similarity,
                -- Get metrics for comparison
                content->'entities'->'metrics'->>'impact' as impact,
                content->'entities'->'metrics'->>'confidence' as confidence
            FROM memories
            WHERE "createdAt" > NOW() - INTERVAL '48 hours'
            AND type IN ('crypto', 'trades', 'ainews', 'aiusers')
            AND (
                -- Vector similarity threshold
                1 - (embedding <-> $1::vector) > 0.65 OR
                
                -- For crypto: check token + metrics
                (type = 'crypto' AND
                    content->'entities'->'tokens'->>'primary' = $2 AND
                    ABS((content->'entities'->'metrics'->>'impact')::int - $3::int) < 20 AND
                    ABS((content->'entities'->'metrics'->>'confidence')::int - $4::int) < 20
                )
                OR
                -- For trades: check position token + metrics
                (type = 'trades' AND
                    content->'entities'->'position'->>'token' = $2 AND
                    ABS((content->'entities'->'metrics'->>'impact')::int - $3::int) < 20 AND
                    ABS((content->'entities'->'metrics'->>'confidence')::int - $4::int) < 20
                )
            )
            ORDER BY vector_similarity DESC
        `, [
            `[${newEmbedding}]`,
            parsedContent?.tokens?.primary || '',  // For exact token match
            parsedContent?.metrics?.impact || 50,
            parsedContent?.metrics?.confidence || 50
        ]);

        if (similarityCheck.rows.length > 0) {
            console.log('Similar content found:', {
                new_text: cleanText.substring(0, 100) + '...',
                similar_count: similarityCheck.rows.length,
                matches: similarityCheck.rows.map(row => ({
                    text: row.text.substring(0, 100) + '...',
                    type: row.type,
                    vector_sim: (row.vector_similarity * 100).toFixed(2) + '%',
                    text_sim: (row.text_similarity * 100).toFixed(2) + '%',
                    token_sim: row.token_similarity ? 
                        (row.token_similarity * 100).toFixed(2) + '%' : 'N/A'
                }))
            });
            return { skip: true, reason: 'similar_content' };
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
            `[${newEmbedding}]`
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

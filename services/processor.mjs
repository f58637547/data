import { v4 as uuidv4 } from 'uuid';
import { generateEmbedding } from './openai.mjs';
import { extractEntities } from '../templates/index.mjs';

function extractTwitterUsername(text) {
    const twitterUrlRegex = /twitter\.com\/([^\/]+)/;
    const match = text.match(twitterUrlRegex);
    return match ? match[1] : null;
}

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

        let author = null;
        let rtAuthor = null;

        // Extract usernames from URLs
        if (message.content) {
            const urls = message.content.match(/https:\/\/twitter\.com\/[^\s]+/g) || [];
            if (urls.length > 0) {
                author = extractTwitterUsername(urls[0]);
                if (urls.length > 1) {
                    rtAuthor = extractTwitterUsername(urls[1]);
                }
            }
        }

        // Clean text but keep important stuff
        const cleanText = rawText
            .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}]/gu, '') // Remove emojis
            .replace(/<:[^>]+>/g, '') // Remove Discord emotes
            .replace(/https?:\/\/\S+/g, '') // Remove URLs
            .replace(/[^\w\s$.,!?#@/-]/g, '') // Keep alphanumeric, $, #, @, /, basic punctuation
            .replace(/\s+/g, ' ')
            .trim();

        if (cleanText.length < 10) {
            return { skip: true, reason: 'no_content' };
        }

        // Only keep the basic channel mapping validation
        if (!channelMapping || !channelMapping.table) {
            console.error('Invalid channel mapping:', channelMapping);
            return { skip: true, reason: 'invalid_channel_mapping' };
        }

        // Log cleaned text
        console.log('\n=== Cleaned Text ===');
        console.log(cleanText);

        // Parse content with author info - using table name for template
        const parsedContent = await extractEntities(
            cleanText, 
            channelMapping.table,  // Use table name for template selection
            {
                author: author,
                rtAuthor: rtAuthor
            }
        );
        console.log('\n=== Parsed Content ===');
        console.log(JSON.stringify(parsedContent, null, 2));

        // Add logging for channelMapping
        console.log('\n=== Channel Mapping ===');
        console.log('Mapping:', channelMapping);

        // Validate event type
        const validEventTypes = {
            crypto: [
                // Platform Events
                'LISTING',        // New exchange/platform listings
                'DELISTING',      // Removals
                'INTEGRATION',    // Platform integrations
                'DEX',           // Decentralized exchanges
                'DEX_POOL',      // DEX pools
                'LIQUIDITY_POOL', // Liquidity pools
                
                // Protocol Events
                'DEVELOPMENT',    // Code updates
                'UPGRADE',        // Protocol changes
                'FORK',          // Chain splits
                'BRIDGE',        // Cross-chain
                'DEFI',          // Decentralized finance
                
                // Market Events
                'MARKET_MOVE',    // General market movement
                'WHALE_MOVE',     // Large transactions
                'FUND_FLOW',      // Institutional money
                'VOLUME_SPIKE',   // Trading volume spikes
                'PRICE_ALERT',    // Price movements
                'ACCUMULATION',   // Buying zones
                'DISTRIBUTION',   // Selling zones
                
                // Security Events
                'HACK',          // Breaches
                'EXPLOIT',       // Vulnerabilities
                'RUGPULL',       // Scams
                
                // Business Events
                'PARTNERSHIP',    // Deals
                'ACQUISITION',    // Mergers
                'REGULATION',     // Legal updates
                
                // Token Events
                'AIRDROP',       // Token distributions
                'TOKENOMICS',    // Supply changes
                'DELEGATE',      // Staking
                'REBASE',        // Price rebalancing
                'UPDATE'         // General updates
            ],
            trades: [
                // Trade Entry Events
                'SPOT_ENTRY',     // Spot buys
                'FUTURES_ENTRY',  // Futures positions
                'LEVERAGE_ENTRY', // Margin trades
                
                // Trade Exit Events
                'TAKE_PROFIT',    // Profit targets
                'STOP_LOSS',      // Stop hits
                'POSITION_EXIT',  // General exits
                
                // Technical Analysis Events
                'BREAKOUT',       // Pattern breaks (triangles, ranges)
                'REVERSAL',       // Trend changes
                'ACCUMULATION',   // Buying zone identified
                'DISTRIBUTION',   // Selling zone identified
                
                // Market Analysis Events
                'MARKET_MOVE',    // General price movement
                'WHALE_MOVE',     // Large wallet transactions
                'FUND_FLOW',      // Institutional money flow
                'VOLUME_SPIKE',   // Unusual trading volume
                'PRICE_ALERT'     // Significant price levels
            ]
        };

        // Log validation
        console.log('\n=== Event Type Validation ===');
        console.log('Type:', parsedContent.event?.type);
        console.log('Channel Type:', channelMapping.table);
        console.log('Valid Types:', validEventTypes[channelMapping.table]);

        // Add type validation
        if (!validEventTypes[channelMapping.table]) {
            console.error('Invalid channel type for event validation:', channelMapping.table);
            return { skip: true, reason: 'invalid_channel_type' };
        }

        // Then check if event type is valid
        if (!validEventTypes[channelMapping.table].includes(parsedContent.event?.type)) {
            console.log('Skipping: Invalid event type:', parsedContent.event?.type);
            return { skip: true, reason: 'invalid_event_type' };
        }

        // After event type validation, add impact check
        if (parsedContent.metrics.impact < 40) {  // 40 is our LOW IMPACT threshold
            console.log('Skipping: Low impact score:', parsedContent.metrics.impact);
            return { skip: true, reason: 'low_impact' };
        }

        // Or more detailed version:
        const impactThresholds = {
            crypto: {
                // Platform Events
                LISTING: 70,      // Major listings need high impact
                DEX: 60,         // DEX launches are significant
                
                // Protocol Events
                DEVELOPMENT: 60,  // Core updates
                UPGRADE: 70,     // Major upgrades
                
                // Market Events
                MARKET_MOVE: 50,  // General moves
                FUND_FLOW: 60,   // Institutional flows
                WHALE_MOVE: 50,  // Large transactions
                
                // Security Events
                HACK: 80,        // Critical security
                EXPLOIT: 70,     // Vulnerabilities
                RUGPULL: 70,     // Scams
                
                // Business Events
                PARTNERSHIP: 60,  // Major deals
                REGULATION: 70,   // Regulatory impact
                
                default: 40      // Base threshold
            },
            trades: {
                // Trade Entry Events
                SPOT_ENTRY: 50,
                FUTURES_ENTRY: 60,
                LEVERAGE_ENTRY: 70,
                
                // Trade Exit Events
                TAKE_PROFIT: 60,
                STOP_LOSS: 60,
                
                // Technical Analysis
                BREAKOUT: 60,
                REVERSAL: 60,
                
                default: 40
            }
        };

        const minImpact = impactThresholds[channelMapping.table][parsedContent.event.type] || 
                         impactThresholds[channelMapping.table].default;

        if (parsedContent.metrics.impact < minImpact) {
            console.log(`Skipping: Impact ${parsedContent.metrics.impact} below threshold ${minImpact} for ${parsedContent.event.type}`);
            return { skip: true, reason: 'low_impact' };
        }

        // 3. THEN generate embedding
        const newEmbedding = await generateEmbedding(cleanText);

        // 4. THEN do similarity check
        console.log('Running similarity checks...');
        const similarityCheck = await db.query(`
            SELECT 
                content->>'original' as text,
                type,
                author,
                rt_author,
                1 - (embedding <-> $1::vector) as vector_similarity,
                content->'entities'->'metrics'->>'impact' as impact,
                content->'entities'->'metrics'->>'confidence' as confidence
            FROM (
                -- Check crypto table
                SELECT *, 'crypto' as source_table FROM crypto 
                WHERE type = 'post'
                AND "createdAt" > NOW() - INTERVAL '48 hours'
                UNION ALL
                -- Check trades table
                SELECT *, 'trades' as source_table FROM trades 
                WHERE type = 'post'
                AND "createdAt" > NOW() - INTERVAL '48 hours'
            ) combined
            WHERE (
                -- Vector similarity threshold
                1 - (embedding <-> $1::vector) > 0.85 OR
                
                -- For crypto: check token + metrics + author
                (source_table = 'crypto' AND
                    content->'entities'->'tokens'->>'primary' = $2 AND
                    author = $5 AND
                    ABS((content->'entities'->'metrics'->>'impact')::int - $3::int) < 20 AND
                    ABS((content->'entities'->'metrics'->>'confidence')::int - $4::int) < 20
                )
                OR
                -- For trades: check token + metrics + author
                (source_table = 'trades' AND
                    content->'entities'->'tokens'->>'primary' = $2 AND
                    author = $5 AND
                    ABS((content->'entities'->'metrics'->>'impact')::int - $3::int) < 20 AND
                    ABS((content->'entities'->'metrics'->>'confidence')::int - $4::int) < 20
                )
            )
            ORDER BY vector_similarity DESC
        `, [
            `[${newEmbedding}]`,
            parsedContent?.tokens?.primary || '',  // For exact token match
            parsedContent?.metrics?.impact || 50,
            parsedContent?.metrics?.confidence || 50,
            author || 'none'  // Add author parameter
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

        // 5. Process and save unique content - save as 'raw'
        await db.query(`
            INSERT INTO ${channelMapping.table}
            (id, "createdAt", type, "agentId", content, embedding)
            VALUES ($1, $2, 'raw', $4, $5, $6)
        `, [
            uuidv4(),
            new Date(),
            process.env.AGENT_ID,
            JSON.stringify({
                original: cleanText,
                entities: parsedContent,
                type: 'raw',
                author: author || 'none',
                rt_author: rtAuthor || null
            }),
            `[${newEmbedding}]`
        ]);

        console.log('Saved new content:', {
            type: channelMapping.table,
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

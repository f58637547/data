import { v4 as uuidv4 } from 'uuid';
import { generateEmbedding } from './openai.mjs';
import { extractEntities } from '../templates/index.mjs';

function extractTwitterUsername(text) {
    // Extract username from Twitter URL
    const twitterUrlRegex = /twitter\.com\/([^\/]+)\/status/;
    const match = text.match(twitterUrlRegex);
    if (match && match[1]) {
        return match[1];  // Return username like 'trader1sz'
    }
    return null;
}

export async function processMessage({ message, db, channelMapping }) {
    try {
        // Log original message
        console.log('\n=== Original Message ===');
        console.log('Content:', message.content);
        console.log('Embeds:', message.embeds);

        // 1. Get plain text from Discord - combine text from related messages
        let rawText = '';

        // Get text from main message content
        if (message.content) {
            rawText = message.content;
        }

        // Get text from embeds
        if (message.embeds?.length > 0) {
            const embedText = message.embeds
                .map(embed => {
                    // Get text from rich embeds (tweets)
                    if (embed.data?.type === 'rich' && embed.data?.description) {
                        return embed.data.description;
                    }
                    // Get text from image embeds if they have alt text
                    if (embed.data?.type === 'image' && embed.data?.description) {
                        return embed.data.description;
                    }
                    return null;
                })
                .filter(Boolean)
                .join(' ');

            // Combine with existing text
            if (embedText) {
                rawText = rawText ? `${rawText} ${embedText}` : embedText;
            }
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
                author = extractTwitterUsername(urls[0]);  // Get username from first URL
                if (urls.length > 1) {
                    rtAuthor = extractTwitterUsername(urls[1]);  // Get username from second URL if exists
                }
            }
        } else if (message.embeds?.length > 0) {
            // If no direct URLs, try to get from embed
            const twitterEmbed = message.embeds.find(e => e.data?.url?.includes('twitter.com'));
            if (twitterEmbed) {
                author = extractTwitterUsername(twitterEmbed.data.url);
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
            channelMapping.table,
            {
                message: cleanText,
                author: author || 'none',  // Pass actual username like 'trader1sz'
                rtAuthor: rtAuthor || ''   // Pass RT username if exists
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
                DEVELOPMENT: 50,  // Code updates
                UPGRADE: 60,     // Major upgrades
                INTEGRATION: 40,  // Allow integrations
                
                // Market Events
                MARKET_MOVE: 40,  // Allow market opinions
                FUND_FLOW: 50,   // Institutional flows
                WHALE_MOVE: 50,  // Large transactions
                
                // Security Events
                HACK: 80,        // Critical security
                EXPLOIT: 70,     // Vulnerabilities
                RUGPULL: 70,     // Scams
                
                // Business Events
                PARTNERSHIP: 40,  // Allow partnerships/collaborations
                ACQUISITION: 60,  // Major deals
                REGULATION: 60,   // Regulatory impact
                
                default: 40      // Lower base threshold
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
            WITH combined AS (
                -- Check crypto table
                SELECT 
                    id::text,
                    "createdAt"::timestamp with time zone,
                    type::text,
                    content,
                    embedding,
                    'crypto' as source_table 
                FROM crypto 
                WHERE type = 'post'
                AND "createdAt" > NOW() - INTERVAL '48 hours'
                UNION ALL
                -- Check trades table
                SELECT 
                    id::text,
                    "createdAt"::timestamp with time zone,
                    type::text,
                    content,
                    embedding,
                    'trades' as source_table 
                FROM trades 
                WHERE type = 'post'
                AND "createdAt" > NOW() - INTERVAL '48 hours'
            )
            SELECT 
                content->>'original' as text,
                type,
                content->>'author' as author,
                content->>'rt_author' as rt_author,
                1 - (embedding <-> $1::vector) as vector_similarity,
                (content->'entities'->'metrics'->>'impact')::int as impact,
                (content->'entities'->'metrics'->>'confidence')::int as confidence
            FROM combined
            WHERE (
                -- Vector similarity threshold
                1 - (embedding <-> $1::vector) > 0.85 OR
                
                -- For crypto: check token + metrics + author
                (source_table = 'crypto' AND
                    content->'entities'->'tokens'->>'primary' = $2 AND
                    content->>'author' = $5 AND
                    ABS((content->'entities'->'metrics'->>'impact')::int - $3::int) < 20 AND
                    ABS((content->'entities'->'metrics'->>'confidence')::int - $4::int) < 20
                )
                OR
                -- For trades: check token + metrics + author
                (source_table = 'trades' AND
                    content->'entities'->'tokens'->>'primary' = $2 AND
                    content->>'author' = $5 AND
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
                author: author || 'none',     // Save actual username
                rt_author: rtAuthor || null   // Save RT username
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

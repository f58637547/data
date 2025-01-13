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

        // 3. Check similarity against ALL posts from last 24h
        const similarityCheck = await db.query(`
            SELECT 
                content->>'original' as text,
                1 - (embedding <-> $1::vector) as similarity
            FROM ${channelMapping.table}
            WHERE "createdAt" > NOW() - INTERVAL '24 hours'
            AND 1 - (embedding <-> $1::vector) > 0.65
            ORDER BY similarity DESC
        `, [`[${newEmbedding}]`]);

        if (similarityCheck.rows.length > 0) {
            console.log('Similar content found:', {
                new_text: cleanText,
                similar_count: similarityCheck.rows.length,
                top_match: {
                    text: similarityCheck.rows[0].text,
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
                'LISTING', 'DELISTING', 'MARKET_MOVE', 'WHALE_MOVE',
                'ACCUMULATION', 'DISTRIBUTION', 'UPDATE', 'DEVELOPMENT',
                'PARTNERSHIP', 'INTEGRATION', 'AIRDROP', 'TOKENOMICS',
                'HACK', 'EXPLOIT', 'RUGPULL', 'FORK', 'UPGRADE', 'BRIDGE'
            ],
            trades: [
                'SPOT_ENTRY', 'FUTURES_ENTRY', 'LEVERAGE_ENTRY',
                'TAKE_PROFIT', 'STOP_LOSS', 'POSITION_EXIT',
                'BREAKOUT', 'REVERSAL', 'ACCUMULATION', 'DISTRIBUTION'
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

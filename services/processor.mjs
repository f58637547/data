import { v4 as uuidv4 } from 'uuid';
import { generateEmbedding } from './openai.mjs';
import { extractEntities } from '../templates/index.mjs';

export async function processMessage({ message, db, templates, channelMapping }) {
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

        // 2. Check similarity - compare text against stored embeddings
        const similarityCheck = await db.query(`
            SELECT content->>'original' as text, 
                   1 - (embedding <=> embedding) as similarity
            FROM ${channelMapping.table}
            WHERE "createdAt" > NOW() - INTERVAL '24 hours'
            AND 1 - (embedding <=> embedding) > 0.85
            ORDER BY similarity DESC
            LIMIT 1
        `);

        if (similarityCheck.rows.length > 0) {
            console.log('Similar content found:', {
                new_text: cleanText.substring(0, 100) + '...',
                similarity: Math.round(similarityCheck.rows[0].similarity * 100) + '%'
            });
            return { skip: true, reason: 'similar_content' };
        }

        // 3. Process and save unique content
        const parsedContent = await extractEntities(cleanText, channelMapping.type);
        const embedding = await generateEmbedding(cleanText); // Generate embedding ONCE

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
            `[${embedding}]`
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

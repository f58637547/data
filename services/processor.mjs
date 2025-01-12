import { v4 as uuidv4 } from 'uuid';
import { generateEmbedding } from './openai.mjs';
import { extractEntities } from '../templates/index.mjs';

// Validation schemas
const schemas = {
    crypto: {
        required: ['headline', 'tokens', 'event', 'metrics'],
        metrics: {
            impact: { min: 1, max: 100 },
            confidence: { min: 1, max: 100 }
        },
        headline: {
            required: ['text']
        }
    },
    trades: {
        required: ['headline', 'position', 'metrics', 'strategy'],
        position: {
            required: ['token', 'entry']
        },
        headline: {
            required: ['text']
        }
    }
};

export async function processMessage({ message, db, templates, channelMapping }) {
    try {
        // 1. Get and clean text from Discord
        const rawText = message.embeds
            .map(embed => embed.description)
            .filter(Boolean)
            .join(' ');

        if (!rawText) {
            return { skip: true, reason: 'no_content' };
        }

        // Clean text (remove emojis, special chars, normalize whitespace)
        const cleanText = rawText
            .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
            .replace(/[^\w\s.,!?-]/g, '')
            .replace(/\s+/g, ' ')
            .trim();

        // 2. Check similarity against existing embeddings
        const similarityCheck = await db.query(`
            SELECT content->>'original' as text, 
                   1 - (embedding <=> $2::vector) as similarity
            FROM ${channelMapping.table}
            WHERE "createdAt" > NOW() - INTERVAL '24 hours'
            AND 1 - (embedding <=> $2::vector) > 0.85
            ORDER BY similarity DESC
            LIMIT 1
        `, [cleanText]);

        if (similarityCheck.rows.length > 0) {
            const { text, similarity } = similarityCheck.rows[0];
            console.log('Similar content found:', {
                new_text: cleanText.substring(0, 100) + '...',
                existing_text: text.substring(0, 100) + '...',
                similarity: Math.round(similarity * 100) + '%'
            });
            return { skip: true, reason: 'similar_content' };
        }

        // 3. Process unique content
        const parsedContent = await extractEntities(cleanText, channelMapping.type);
        const embedding = await generateEmbedding(cleanText);

        // 4. Save to DB
        const enhancedContent = {
            original: cleanText,
            entities: parsedContent,
            type: channelMapping.type
        };

        await db.query(`
            INSERT INTO ${channelMapping.table}
            (id, "createdAt", type, "agentId", content, embedding)
            VALUES ($1, $2, $3, $4, $5, $6::vector)
        `, [
            uuidv4(),
            new Date(),
            channelMapping.type,
            process.env.AGENT_ID,
            JSON.stringify(enhancedContent),
            embedding
        ]);

        console.log('Saved new content:', {
            type: channelMapping.type,
            preview: cleanText.substring(0, 100) + '...'
        });

        return enhancedContent;

    } catch (error) {
        console.error('Processing error:', {
            error: error.message,
            preview: cleanText?.substring(0, 100) + '...'
        });
        return { skip: true, reason: 'processing_error' };
    }
}

function validateEntities(entities, schema) {
    // Check required fields
    for (const field of schema.required) {
        if (!entities[field]) {
            console.error(`Missing required field: ${field}`);
            return false;
        }
        
        // Check nested required fields
        if (schema[field]?.required) {
            for (const nestedField of schema[field].required) {
                if (!entities[field][nestedField] || entities[field][nestedField] === '') {
                    console.error(`Missing required nested field: ${field}.${nestedField}`);
                    return false;
                }
            }
        }
    }

    // Check metrics ranges
    if (schema.metrics) {
        for (const [key, range] of Object.entries(schema.metrics)) {
            const value = entities.metrics?.[key];
            if (value === null || value === undefined || value < range.min || value > range.max) {
                console.error(`Invalid metric value for ${key}: ${value}`);
                return false;
            }
        }
    }

    return true;
}

function getMissingFields(entities, schema) {
    const missing = [];
    
    for (const field of schema.required) {
        if (!entities[field]) {
            missing.push(field);
            continue;
        }
        
        if (schema[field]?.required) {
            for (const nestedField of schema[field].required) {
                if (!entities[field][nestedField] || entities[field][nestedField] === '') {
                    missing.push(`${field}.${nestedField}`);
                }
            }
        }
    }
    
    return missing;
}
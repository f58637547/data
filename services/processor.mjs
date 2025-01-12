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
        const combinedDescription = message.embeds
            .map((embed) => embed.description)
            .filter((description) => description)
            .join(' ');

        if (!combinedDescription) {
            return { skip: true, reason: 'no_content' };
        }

        // 1. First check similarity with existing posts
        const similarityCheck = await db.query(`
            WITH posted_check AS (
                SELECT 1 FROM memories m
                WHERE m.content->>'type' = 'post'
                AND m."createdAt" > NOW() - INTERVAL '24 hours'
                AND 1 - (m.embedding <-> (
                    SELECT embedding FROM memories
                    WHERE content->>'content' = $1
                    LIMIT 1
                )) > 0.85
            )
            SELECT EXISTS (SELECT 1 FROM posted_check) as has_similar
        `, [combinedDescription]);

        if (similarityCheck.rows[0].has_similar) {
            return { skip: true, reason: 'similar_post_exists' };
        }

        // 2. Extract entities based on channel type
        const entities = await extractEntities(
            combinedDescription,
            channelMapping.type
        );

        // 3. Validate extracted entities
        const parsedEntities = JSON.parse(entities);
        const schema = schemas[channelMapping.type];

        if (!validateEntities(parsedEntities, schema)) {
            console.error('Invalid entities:', {
                type: channelMapping.type,
                entities: parsedEntities
            });
            return { skip: true, reason: 'invalid_entities' };
        }

        // 4. Generate embedding
        const embedding = await generateEmbedding(combinedDescription);

        // 5. Save to DB with extracted info
        const enhancedContent = {
            original: combinedDescription,
            embedding,
            entities: parsedEntities,
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

        return enhancedContent;

    } catch (error) {
        console.error('Error processing message:', {
            error,
            channelType: channelMapping.type,
            messageId: message.id
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
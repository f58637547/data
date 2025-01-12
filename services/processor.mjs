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

        // 1. First check similarity with existing posts using text (cheap check)
        const similarityCheck = await db.query(`
            WITH similarity_check AS (
                SELECT 
                    content->>'original' as text,
                    "createdAt"
                FROM ${channelMapping.table} 
                WHERE "createdAt" > NOW() - INTERVAL '24 hours'
                AND content->>'original' ILIKE $1
                ORDER BY "createdAt" DESC
                LIMIT 1
            )
            SELECT * FROM similarity_check
        `, [combinedDescription]);

        if (similarityCheck.rows.length > 0) {
            const { text, createdAt } = similarityCheck.rows[0];
            console.log('Similar content found:', {
                new_text: combinedDescription.substring(0, 100) + '...',
                existing_text: text.substring(0, 100) + '...',
                channel: channelMapping.type,
                age: Math.round((Date.now() - new Date(createdAt).getTime()) / 1000 / 60) + ' minutes ago'
            });
            return { skip: true, reason: 'similar_post_exists' };
        }

        // 2. Extract and validate entities
        try {
            const entities = await extractEntities(combinedDescription, channelMapping.type);
            const parsedEntities = JSON.parse(entities);
            const schema = schemas[channelMapping.type];

            if (!validateEntities(parsedEntities, schema)) {
                const token = parsedEntities.position?.token || parsedEntities.tokens?.primary;
                console.log('Skipping message - Not relevant:', {
                    type: channelMapping.type,
                    preview: combinedDescription.substring(0, 100) + '...',
                    token: token || 'none',
                    reason: token ? 'Missing required fields' : 'Not a trade/crypto message',
                    missing: getMissingFields(parsedEntities, schema)
                });
                return { skip: true, reason: token ? 'incomplete_data' : 'not_relevant' };
            }

            // 3. Only generate embedding if we're going to save
            const embedding = await generateEmbedding(combinedDescription);

            // 4. Save to DB with all info
            const enhancedContent = {
                original: combinedDescription,
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

            console.log('Saved message:', {
                type: channelMapping.type,
                token: parsedEntities.position?.token || parsedEntities.tokens?.primary,
                preview: combinedDescription.substring(0, 100) + '...'
            });

            return enhancedContent;

        } catch (extractError) {
            console.log('Skipping message - Entity extraction failed:', {
                type: channelMapping.type,
                preview: combinedDescription.substring(0, 100) + '...',
                error: extractError.message
            });
            return { skip: true, reason: 'entity_extraction_failed' };
        }

    } catch (error) {
        console.error('Error processing message:', {
            error: error.message,
            channelType: channelMapping.type,
            messageId: message.id,
            preview: combinedDescription?.substring(0, 100) + '...'
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
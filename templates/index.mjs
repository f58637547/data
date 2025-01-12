import { getLLMResponse, generateEmbedding } from '../services/openai.mjs';
import { cryptoTemplate } from './crypto.mjs';
import { tradesTemplate } from './trades.mjs';

export async function loadTemplates() {
    return {
        cryptoTemplate,
        tradesTemplate
    };
}

export async function extractEntities(text, channelType) {
    try {
        // 1. Select template
        const template = channelType === 'trades'
            ? tradesTemplate
            : cryptoTemplate;

        // 2. Get LLM response
        const response = await getLLMResponse(template, {
            message: text
        });

        // Debug the raw response
        console.log('Raw LLM Response:', JSON.stringify(response, null, 2));

        // 3. Validate response structure
        if (!response?.choices?.[0]?.message?.content) {
            throw new Error('Invalid LLM response structure');
        }

        // 4. Parse JSON content
        let parsed;
        try {
            const content = response.choices[0].message.content;
            // Extract JSON from markdown if present
            const jsonMatch = content.match(/```(?:json)?\n?(.*?)\n?```/s);
            const jsonString = jsonMatch ? jsonMatch[1] : content;
            
            parsed = JSON.parse(jsonString.trim());
            console.log('Parsed JSON:', parsed);
        } catch (parseError) {
            console.error('Raw content that failed to parse:', response.choices[0].message.content);
            throw new Error(`JSON parse error: ${parseError.message}`);
        }

        // 5. Validate required fields
        if (channelType === 'trades') {
            if (!parsed.position?.pair || !parsed.strategy?.type) {
                console.error('Missing required trade fields:', parsed);
                throw new Error('Missing required trade fields');
            }
        } else if (channelType === 'crypto') {
            if (!parsed.tokens?.primary || !parsed.event?.type) {
                console.error('Missing required crypto fields:', parsed);
                throw new Error('Missing required crypto fields');
            }
        }

        // 6. Generate embedding for the original text
        const embedding = await generateEmbedding(text);

        // 7. Return both parsed data and embedding
        return {
            entities: parsed,
            embedding
        };

    } catch (error) {
        console.error('Entity extraction failed:', {
            error,
            channelType,
            textLength: text.length,
            text: text.substring(0, 100) + '...' // Log start of text for debugging
        });
        throw new Error(`Entity extraction failed: ${error.message}`);
    }
}
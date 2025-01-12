import { getLLMResponse } from '../services/openai.mjs';
import { cryptoTemplate } from './crypto.mjs';
import { tradesTemplate } from './trades.mjs';

export async function setupTemplates() {
    return {
        cryptoTemplate,
        tradesTemplate
    };
}

export async function extractEntities(text, channelType) {
    try {
        const template = channelType === 'trades'
            ? tradesTemplate
            : cryptoTemplate;

        const response = await getLLMResponse(template, {
            message: text
        });

        // Simple validation
        const parsed = JSON.parse(response.choices[0].message.content);

        // Check minimum required fields based on type
        if (channelType === 'trades' && (!parsed.position || !parsed.strategy)) {
            throw new Error('Missing required trade fields');
        }
        if (channelType === 'crypto' && (!parsed.tokens || !parsed.event)) {
            throw new Error('Missing required crypto fields');
        }

        return parsed;

    } catch (error) {
        console.error('Entity extraction failed:', {
            error,
            channelType,
            textLength: text.length
        });
        throw new Error(`Entity extraction failed: ${error.message}`);
    }
}
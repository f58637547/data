import { getLLMResponse, generateEmbedding } from '../services/openai.mjs';
import { cryptoTemplate } from './crypto.mjs';
import { tradesTemplate } from './trades.mjs';

export async function loadTemplates() {
    return {
        cryptoTemplate,
        tradesTemplate
    };
}

export async function extractEntities(text, channelType, authorInfo = {}) {
    try {
        // 1. Get LLM to parse content
        const response = await getLLMResponse(
            channelType === 'trades' ? tradesTemplate : cryptoTemplate,
            { 
                message: text,
                author: authorInfo.author || 'none',
                rtAuthor: authorInfo.rtAuthor || 'none'
            }
        );

        // 2. Parse JSON from LLM response
        let parsed;
        try {
            const content = response.choices[0].message.content;
            const jsonMatch = content.match(/```(?:json)?\n?(.*?)\n?```/s);
            const jsonString = jsonMatch ? jsonMatch[1] : content;
            parsed = JSON.parse(jsonString.trim());
            console.log('Parsed content:', parsed);
        } catch (parseError) {
            throw new Error('Failed to parse LLM response');
        }

        // 3. Validate content type-specific fields
        if (channelType === 'trades') {
            if (!parsed.position?.token && !parsed.position?.pair) {
                throw new Error('Not a trade message');
            }
            if (!parsed.position?.entry && parsed.position?.token) {
                throw new Error('Incomplete trade data');
            }
        } else if (channelType === 'crypto') {
            if (!parsed.tokens?.primary) {
                throw new Error('Not a crypto update');
            }
            if (!parsed.event?.type && parsed.tokens?.primary) {
                throw new Error('Incomplete crypto data');
            }
        }

        return parsed;

    } catch (error) {
        throw error; // Pass error up for handling in processMessage
    }
}
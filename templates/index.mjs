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
        // Select template based on table name
        const template = channelType === 'trades' ? tradesTemplate : cryptoTemplate;
        
        // Get LLM to parse content
        const response = await getLLMResponse(template, { 
            message: text,
            author: authorInfo.author || 'none',
            rtAuthor: authorInfo.rtAuthor || 'none'
        });

        // Parse JSON from LLM response
        try {
            const content = response.choices[0].message.content;
            const jsonMatch = content.match(/```(?:json)?\n?(.*?)\n?```/s);
            const jsonString = jsonMatch ? jsonMatch[1] : content;
            const parsed = JSON.parse(jsonString.trim());
            console.log('Parsed content:', parsed);
            return parsed;
        } catch (parseError) {
            throw new Error('Failed to parse LLM response');
        }

    } catch (error) {
        throw error; // Pass error up for handling in processMessage
    }
}
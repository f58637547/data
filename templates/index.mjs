import { getLLMResponse} from '../services/openai.mjs';
import { cryptoTemplate } from './crypto.mjs';

export async function loadTemplates() {
    return {
        cryptoTemplate  // Single template for all channels
    };
}

export async function extractEntities(text, channelType, authorInfo = {}) {
    try {
        // Use crypto template for all channels
        const template = cryptoTemplate;
        
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

            // Set original text as headline
            if (typeof text === 'object' && text.entities?.headline?.text) {
                parsed.headline = {
                    text: text.entities.headline.text
                };
            } else if (typeof text === 'string') {
                parsed.headline = {
                    text: text
                };
            }

            console.log('Parsed content:', parsed);
            return parsed;
        } catch (parseError) {
            throw new Error('Failed to parse LLM response');
        }

    } catch (error) {
        throw error; // Pass error up for handling in processMessage
    }
}
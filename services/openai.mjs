import OpenAI from 'openai';
import fetch from 'node-fetch';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// OpenRouter setup
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

// Custom error classes
class LLMError extends Error {
    constructor(message, provider, statusCode, details) {
        super(message);
        this.name = 'LLMError';
        this.provider = provider;
        this.statusCode = statusCode;
        this.details = details;
    }
}

export async function getLLMResponse(template, context, retries = 2) {
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            // Always use OpenRouter for chat completions
            const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: process.env.OPENROUTER_MODEL,
                    messages: [{
                        role: 'user',
                        content: template.replace('{{message}}', context.message)
                    }]
                })
            });

            if (!response.ok) {
                throw new LLMError(
                    'OpenRouter API error',
                    'openrouter',
                    response.status,
                    await response.text()
                );
            }

            const data = await response.json();
            return data;

        } catch (error) {
            lastError = error;
            console.error(`LLM attempt ${attempt + 1} failed:`, {
                provider: process.env.USE_OPENROUTER === 'true' ? 'openrouter' : 'openai',
                error: error.message,
                statusCode: error.statusCode,
                details: error.details
            });

            // Don't retry on auth errors
            if (error.statusCode === 401 || error.statusCode === 403) {
                throw new LLMError(
                    'Authentication failed',
                    error.provider,
                    error.statusCode,
                    'Check API key configuration'
                );
            }

            // Wait before retry
            if (attempt < retries) {
                await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
            }
        }
    }

    // If all retries failed
    throw new LLMError(
        'All LLM attempts failed',
        lastError.provider,
        lastError.statusCode,
        lastError.details
    );
}

// Always use OpenAI for embeddings (better performance/cost ratio)
export async function generateEmbedding(text, retries = 2) {
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const response = await openai.embeddings.create({
                model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
                input: text
            });

            return response.data[0].embedding;

        } catch (error) {
            lastError = error;
            console.error(`Embedding attempt ${attempt + 1} failed:`, {
                error: error.message,
                statusCode: error.status
            });

            // Don't retry on auth errors
            if (error.status === 401 || error.status === 403) {
                throw new LLMError(
                    'Authentication failed',
                    'openai',
                    error.status,
                    'Check API key configuration'
                );
            }

            // Wait before retry
            if (attempt < retries) {
                await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
            }
        }
    }

    throw new LLMError(
        'All embedding attempts failed',
        'openai',
        lastError.status,
        lastError.message
    );
}
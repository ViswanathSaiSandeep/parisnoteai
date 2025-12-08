// Netlify Serverless Function to proxy OpenRouter API calls
// This keeps your API key secure on the server side

const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

// API key from Netlify environment variable (set in Netlify Dashboard > Site Settings > Environment Variables)
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// Free models to try (in order of preference)
const FREE_MODELS = [
    'meta-llama/llama-3.2-3b-instruct:free',
    'google/gemma-2-9b-it:free',
    'mistralai/mistral-7b-instruct:free',
    'qwen/qwen-2-7b-instruct:free'
];

// Helper function to delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to make API call with retry logic
async function callOpenRouterWithRetry(prompt, maxRetries = 3) {
    let lastError = null;

    for (let modelIndex = 0; modelIndex < FREE_MODELS.length; modelIndex++) {
        const model = FREE_MODELS[modelIndex];

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                console.log(`Attempt ${attempt + 1} with model: ${model}`);

                const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                        'HTTP-Referer': 'https://paris-noteai.netlify.app',
                        'X-Title': 'PARIS NoteAI'
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: [{ role: 'user', content: prompt }],
                        temperature: 0.7,
                        max_tokens: 2048
                    })
                });

                if (response.status === 429) {
                    // Rate limited - wait and retry with exponential backoff
                    const waitTime = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
                    console.log(`Rate limited. Waiting ${waitTime}ms before retry...`);
                    await delay(waitTime);
                    continue;
                }

                if (!response.ok) {
                    const errorData = await response.text();
                    console.error(`API error (${response.status}):`, errorData);
                    lastError = { status: response.status, details: errorData };

                    // Try next model for 4xx errors (except 429)
                    if (response.status >= 400 && response.status < 500) {
                        break; // Break retry loop, try next model
                    }
                    continue;
                }

                const data = await response.json();
                const generatedText = data.choices?.[0]?.message?.content || '';
                console.log(`Success with model ${model}. Generated text length:`, generatedText.length);
                return { success: true, text: generatedText };

            } catch (error) {
                console.error(`Attempt ${attempt + 1} failed:`, error.message);
                lastError = { status: 500, details: error.message };
            }
        }
    }

    return { success: false, error: lastError };
}

exports.handler = async (event, context) => {
    console.log('Function invoked with method:', event.httpMethod);

    // Handle CORS preflight request
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    // Check for API key
    if (!OPENROUTER_API_KEY) {
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'API key not configured. Please set OPENROUTER_API_KEY in Netlify environment variables.' })
        };
    }

    try {
        let requestBody;
        try {
            requestBody = JSON.parse(event.body || '{}');
        } catch (parseError) {
            console.error('JSON parse error:', parseError.message);
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Invalid JSON in request body' })
            };
        }

        const { prompt } = requestBody;

        if (!prompt) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Prompt is required' })
            };
        }

        console.log('Received prompt:', prompt.substring(0, 50) + '...');

        // Call API with retry logic
        const result = await callOpenRouterWithRetry(prompt);

        if (result.success) {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ text: result.text })
            };
        } else {
            return {
                statusCode: result.error?.status || 500,
                headers,
                body: JSON.stringify({
                    error: 'All API attempts failed. Free models have rate limits - please wait a moment and try again.',
                    details: result.error?.details
                })
            };
        }

    } catch (error) {
        console.error('Function error:', error.message);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Internal server error', message: error.message })
        };
    }
};

// Netlify Serverless Function to proxy OpenRouter API calls
// This keeps your API key secure on the server side

const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

// Hardcoded API key for testing - will move to environment variable for production
const OPENROUTER_API_KEY = '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';
// Note: openai/gpt-oss-120b:free requires privacy policy configuration at https://openrouter.ai/settings/privacy
// Using a confirmed working free model instead
const OPENROUTER_MODEL = 'meta-llama/llama-3.2-3b-instruct:free';

exports.handler = async (event, context) => {
    console.log('Function invoked with method:', event.httpMethod);
    console.log('Request body:', event.body);

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

    try {
        let requestBody;
        try {
            requestBody = JSON.parse(event.body || '{}');
        } catch (parseError) {
            console.error('JSON parse error:', parseError.message);
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Invalid JSON in request body', received: event.body })
            };
        }

        const { prompt } = requestBody;

        console.log('Received prompt:', prompt ? `"${prompt.substring(0, 50)}..."` : 'EMPTY');

        if (!prompt) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Prompt is required', receivedBody: requestBody })
            };
        }

        console.log('Calling OpenRouter API with model:', OPENROUTER_MODEL);

        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'HTTP-Referer': 'https://paris-noteai.netlify.app',
                'X-Title': 'PARIS NoteAI'
            },
            body: JSON.stringify({
                model: OPENROUTER_MODEL,
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.7,
                max_tokens: 2048
            })
        });

        console.log('OpenRouter API response status:', response.status);

        if (!response.ok) {
            const errorData = await response.text();
            console.error('OpenRouter API error:', errorData);
            return {
                statusCode: response.status,
                headers,
                body: JSON.stringify({ error: 'OpenRouter API request failed', details: errorData })
            };
        }

        const data = await response.json();
        const generatedText = data.choices?.[0]?.message?.content || '';

        console.log('Generated text length:', generatedText.length);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ text: generatedText })
        };

    } catch (error) {
        console.error('Function error:', error.message);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Internal server error', message: error.message })
        };
    }
};

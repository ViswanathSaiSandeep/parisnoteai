// Netlify Serverless Function to proxy Gemini API calls
// This keeps your API key secure on the server side

const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

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

    // Get API key from environment variable (set in Netlify dashboard)
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

    console.log('API Key exists:', !!GEMINI_API_KEY);

    if (!GEMINI_API_KEY) {
        console.error('GEMINI_API_KEY not found in environment variables');
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'API key not configured. Please set GEMINI_API_KEY in Netlify environment variables.' })
        };
    }

    try {
        const requestBody = JSON.parse(event.body || '{}');
        const { prompt } = requestBody;

        console.log('Received prompt:', prompt ? 'yes' : 'no');

        if (!prompt) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Prompt is required' })
            };
        }

        console.log('Calling Gemini API...');

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
                })
            }
        );

        console.log('Gemini API response status:', response.status);

        if (!response.ok) {
            const errorData = await response.text();
            console.error('Gemini API error:', errorData);
            return {
                statusCode: response.status,
                headers,
                body: JSON.stringify({ error: 'Gemini API request failed', details: errorData })
            };
        }

        const data = await response.json();
        const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

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

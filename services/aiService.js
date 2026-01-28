const { GoogleGenAI, Type } = require('@google/genai');
const { AIServiceError, ValidationError } = require('../middleware/errorHandler');

// Gemini responseSchema definitions using Type enum
// These enforce the response structure at the API level
const RESPONSE_SCHEMAS = {
  reflectionPrompt: {
    type: Type.OBJECT,
    properties: {
      question: {
        type: Type.STRING,
        description: 'A single reflection question, 15-25 words, ending with a question mark'
      }
    },
    required: ['question']
  },
  writingPrompts: {
    type: Type.OBJECT,
    properties: {
      prompts: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: 'Array of writing prompts, 1-2 sentences each'
      }
    },
    required: ['prompts']
  },
  affirmation: {
    type: Type.OBJECT,
    properties: {
      affirmation: {
        type: Type.STRING,
        description: 'A positive affirmation, 1-2 sentences, warm and genuine'
      }
    },
    required: ['affirmation']
  }
};


// configuration

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// check if we actually have an API key
if (!GEMINI_API_KEY) {
  console.error('Gemini API Key is not set in the envirnoment variables')
}

// initialize the gemini client
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY })

// set default model (Gemini 3 series for best structured output support)
const DEFAULT_MODEL = 'gemini-3-flash-preview';

// default generation config
const DEFAULT_CONFIG = {
  temperature: 0.7,
  maxOutputTokens: 2048,
  topP: 0.95,
  topK: 40
}

// public API methods

const generateContent = async (prompt, options = {}) => {

  validatePrompt(prompt);

  const config = buildGenerationConfig(options);

  const response = await callGeminiAPI(async () => {
    return ai.models.generateContent({
      model: options.model || DEFAULT_MODEL,
      contents: prompt,
      config
    })
  })

  return formatResponse(response);
}

/**
 * Generate a personalized reflection prompt for a delivered letter.
 * Uses structured output to ensure complete, valid responses.
 */
const generateReflectionPrompt = async (letter) => {
  if (!letter || !letter.content) {
    throw new ValidationError('Letter content is required to generate a reflection prompt', {
      letter: 'A valid letter with content is required'
    });
  }

  const timeSinceWritten = getTimeSinceWritten(letter.createdAt);
  const goalsContext = formatGoalsForPrompt(letter.goals);
  const moodContext = letter.mood ? `Mood: ${letter.mood}` : '';
  const sanitizedTitle = sanitizeForPrompt(letter.title || 'Untitled', 100);

  // Extract key themes instead of passing full content
  const themes = extractThemes(letter.content);

  const systemInstruction = `You create reflection questions for a journaling app. Users wrote letters to their future selves and are now reading them.

Rules:
- Create ONE question that helps them reflect on their growth
- Keep it 15-25 words
- Never use quotation marks
- Never quote the letter directly
- Paraphrase themes in your own words`;

  const userPrompt = `Letter details:
- Written: ${timeSinceWritten} ago
- Title: ${sanitizedTitle}
${moodContext}
${goalsContext}
- Key themes: ${themes}

Create a reflection question about these themes.`;

  const response = await callGeminiAPI(async () => {
    return ai.models.generateContent({
      model: DEFAULT_MODEL,
      contents: userPrompt,
      config: {
        systemInstruction,
        temperature: 0.7,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMAS.reflectionPrompt
      }
    });
  });

  try {
    const { question } = JSON.parse(response.text);

    return {
      prompt: question,
      metadata: {
        finishReason: response.candidates?.[0]?.finishReason,
        usageMetadata: response.usageMetadata
      }
    };
  } catch (parseError) {
    console.error('Failed to parse reflection response:', parseError.message, 'Raw:', response.text);
    // Fallback: try to extract any question from the response
    const fallbackQuestion = extractQuestionFromText(response.text);
    return {
      prompt: fallbackQuestion,
      metadata: { parseError: true }
    };
  }
};

/**
 * Extract a question from text as fallback
 */
const extractQuestionFromText = (text) => {
  if (!text) return 'How do you feel reading this letter now?';

  // Find any sentence ending with ?
  const questionMatch = text.match(/[^.!?]*\?/);
  if (questionMatch) {
    // Clean up the question
    return questionMatch[0]
      .replace(/^[^a-zA-Z]*/, '') // Remove leading non-letters
      .replace(/["']/g, '')       // Remove quotes
      .trim();
  }

  return 'How do you feel reading this letter now?';
};

/**
 * Sanitize text for safe inclusion in prompts
 * Removes problematic characters and limits length
 */
const sanitizeForPrompt = (text, maxLength = 2000) => {
  if (!text) return '';

  return text
    .substring(0, maxLength)
    .replace(/"/g, "'")  // Replace double quotes with single
    .replace(/\\/g, '')  // Remove backslashes
    .replace(/\n{3,}/g, '\n\n')  // Collapse multiple newlines
    .trim();
};

/**
 * Generate AI-powered writing prompts to inspire users
 * when writing letters to their future selves.
 */
const generateWritingPrompts = async (options = {}) => {
  const { mood, theme, count = 3 } = options;

  const moodContext = mood ? `The user's current mood is: ${mood}` : '';
  const themeContext = theme ? `They're interested in writing about: ${theme}` : '';

  const systemInstruction = `You are a creative writing coach for SoulMail, a journaling app where users write letters to their future selves. Generate inspiring, thought-provoking writing prompts.

Guidelines:
- Create prompts that encourage self-reflection and personal growth
- Make prompts open-ended and inviting
- Vary the depth and tone of prompts
- Include prompts about hopes, dreams, current feelings, gratitude, lessons learned
- Keep each prompt to 1-2 sentences
- Do NOT number the prompts
- Separate each prompt with "---"
- Generate exactly ${count} prompts`;

  const userPrompt = `Generate ${count} unique writing prompts for someone writing a letter to their future self.
${moodContext}
${themeContext}

The prompts should inspire meaningful self-expression and reflection.`;

  const response = await callGeminiAPI(async () => {
    return ai.models.generateContent({
      model: DEFAULT_MODEL,
      contents: userPrompt,
      config: {
        systemInstruction,
        temperature: 0.9,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMAS.writingPrompts
      }
    });
  });

  try {
    const { prompts } = JSON.parse(response.text);

    return {
      prompts,
      metadata: {
        finishReason: response.candidates?.[0]?.finishReason,
        usageMetadata: response.usageMetadata
      }
    };
  } catch (parseError) {
    console.error('Failed to parse writing prompts response:', parseError);
    // Fallback: try to split by newlines if JSON parsing fails
    const prompts = response.text
      .split('\n')
      .map(p => p.trim())
      .filter(p => p.length > 5); // Simple filter

    return {
      prompts: prompts.slice(0, count),
      metadata: { parseError: true }
    };
  }
};

/**
 * Generate a positive affirmation for the user.
 * Shown when the user opens the app to start their day
 * with encouragement and positivity.
 */
const generateAffirmation = async (options = {}) => {
  const { username, timeOfDay, stats } = options;

  const greeting = getTimeBasedGreeting(timeOfDay);
  const nameContext = username ? `The user's name is ${username}.` : '';
  const statsContext = formatStatsForAffirmation(stats);

  const systemInstruction = `You are an uplifting, warm presence in SoulMail, a self-reflection journaling app. Generate a single positive affirmation to greet the user.

Guidelines:
- Be genuine and warm, not generic or cliché
- Keep it brief (1-2 sentences)
- Focus on self-worth, growth, capability, or the present moment
- If the user's name is provided, use it naturally (not forced)
- Match the tone to the time of day
- Never be preachy or condescending
- Avoid starting with "Remember that..." or similar phrases`;

  const userPrompt = `Generate a positive affirmation for a user opening the app.
${greeting}
${nameContext}
${statsContext}

Create a warm, encouraging message that makes them feel valued and capable.`;

  const response = await callGeminiAPI(async () => {
    return ai.models.generateContent({
      model: DEFAULT_MODEL,
      contents: userPrompt,
      config: {
        systemInstruction,
        temperature: 0.85,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMAS.affirmation
      }
    });
  });

  try {
    const { affirmation } = JSON.parse(response.text);

    return {
      affirmation,
      metadata: {
        finishReason: response.candidates?.[0]?.finishReason,
        usageMetadata: response.usageMetadata
      }
    };
  } catch (parseError) {
    console.error('Failed to parse affirmation response:', parseError);
    return {
      affirmation: response.text.trim(),
      metadata: { parseError: true }
    };
  }
};

// Helper functions for AI generation

/**
 * Calculate human-readable time since the letter was written
 */
const getTimeSinceWritten = (createdAt) => {
  if (!createdAt) return 'some time';

  const now = new Date();
  const written = new Date(createdAt);
  const diffMs = now - written;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? 's' : ''}`;
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return `${weeks} week${weeks !== 1 ? 's' : ''}`;
  }
  if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    return `${months} month${months !== 1 ? 's' : ''}`;
  }
  const years = Math.floor(diffDays / 365);
  return `${years} year${years !== 1 ? 's' : ''}`;
};

/**
 * Format goals array for inclusion in prompts
 */
const formatGoalsForPrompt = (goals) => {
  if (!goals || goals.length === 0) return '';

  const goalTexts = goals.map(g => {
    const status = g.status !== 'pending' ? ` (${g.status})` : '';
    return `- ${g.text}${status}`;
  }).join('\n');

  return `Goals set in this letter:\n${goalTexts}`;
};

/**
 * Get appropriate greeting based on time of day
 */
const getTimeBasedGreeting = (timeOfDay) => {
  const greetings = {
    morning: 'It is morning, a fresh start to the day.',
    afternoon: 'It is afternoon.',
    evening: 'It is evening, winding down for the day.',
    night: 'It is night time.'
  };
  return greetings[timeOfDay] || '';
};

/**
 * Format user stats for affirmation context
 */
const formatStatsForAffirmation = (stats) => {
  if (!stats) return '';

  const contexts = [];
  if (stats.currentStreak > 0) {
    contexts.push(`They have a ${stats.currentStreak}-day writing streak.`);
  }
  if (stats.totalLetters > 0) {
    contexts.push(`They have written ${stats.totalLetters} letter${stats.totalLetters !== 1 ? 's' : ''}.`);
  }
  if (stats.goalsAccomplished > 0) {
    contexts.push(`They have accomplished ${stats.goalsAccomplished} goal${stats.goalsAccomplished !== 1 ? 's' : ''}.`);
  }

  return contexts.length > 0 ? contexts.join(' ') : '';
};

/**
 * Extract key themes from letter content without passing the full text
 * This prevents the AI from quoting the letter directly
 */
const extractThemes = (content) => {
  if (!content) return 'personal reflection';

  const themes = [];
  const lowerContent = content.toLowerCase();

  // Detect common themes
  if (lowerContent.includes('goal') || lowerContent.includes('achieve') || lowerContent.includes('accomplish')) {
    themes.push('goals and aspirations');
  }
  if (lowerContent.includes('work') || lowerContent.includes('career') || lowerContent.includes('job')) {
    themes.push('career');
  }
  if (lowerContent.includes('family') || lowerContent.includes('relationship') || lowerContent.includes('friend')) {
    themes.push('relationships');
  }
  if (lowerContent.includes('health') || lowerContent.includes('exercise') || lowerContent.includes('fitness')) {
    themes.push('health and wellness');
  }
  if (lowerContent.includes('happy') || lowerContent.includes('joy') || lowerContent.includes('excited')) {
    themes.push('happiness');
  }
  if (lowerContent.includes('stress') || lowerContent.includes('anxious') || lowerContent.includes('worried')) {
    themes.push('managing stress');
  }
  if (lowerContent.includes('learn') || lowerContent.includes('grow') || lowerContent.includes('improve')) {
    themes.push('personal growth');
  }
  if (lowerContent.includes('focus') || lowerContent.includes('productive') || lowerContent.includes('discipline')) {
    themes.push('focus and productivity');
  }
  if (lowerContent.includes('grateful') || lowerContent.includes('thankful') || lowerContent.includes('appreciate')) {
    themes.push('gratitude');
  }
  if (lowerContent.includes('love') || lowerContent.includes('partner') || lowerContent.includes('dating')) {
    themes.push('love life');
  }

  return themes.length > 0 ? themes.slice(0, 3).join(', ') : 'self-reflection and personal thoughts';
};

// helper functions
// validates that the prompt is provided and valid

const validatePrompt = (prompt) => {
  // checks if the prompt is present and the prompt is a string.
  if (typeof prompt !== 'string') {
    throw new ValidationError('Prompt is required and must be a string', {
      prompt: 'A valid text prompt is required'
    })
  }
  if (prompt.trim().length === 0) {
    throw new ValidationError('Prompt cannot be empty', {
      prompt: 'Prompt must contain text'
    })
  }
}

// build generation configuration for prompts
const buildGenerationConfig = (options) => {
  const config = {
    temperature: options.temperature || DEFAULT_CONFIG.temperature,
    maxOutputTokens: options.maxOutputTokens || DEFAULT_CONFIG.maxOutputTokens,
    topP: options.topP ?? DEFAULT_CONFIG.topP,
    topK: options.topK ?? DEFAULT_CONFIG.topK,
  }

  // add system instruction if provided
  if (options.systemInstruction) {
    config.systemInstruction = options.systemInstruction;
  }

  return config;
}

// wrapper for Gemini API calls with error handling
const callGeminiAPI = async (apiCall) => {
  try {
    return await apiCall();
  } catch (error) {
    console.log('Gemini API error:', error.message);
    if (error.status === 429) {
      throw new AIServiceError(
        'AI service rate limit exceeded. Please, try again later.',
        error
      );
    }
    if (error.status === 400) {
      throw new AIServiceError(
        'Invalid request to AI service' + error.message
      );
    }
    if (error.status === 401 || error.status === 403) {
      throw new AIServiceError(
        'AI Service authentication failed. Check API key configuration.',
        error
      );
    }

    throw new AIServiceError(
      'AI Service temporarily unavailable' + error.message,
      error
    );
  }
}

// format the API response into a concistent structure.
const formatResponse = (response) => {
  return {
    text: response.text || '',
    // metadata for debugging
    metadata: {
      finishReason: response.candidates?.[0]?.finishReason,
      safetyRatings: response.candidates?.[0]?.safetyRatings,
      usageMetadata: response.usageMetadata
    }
  };
};

module.exports = {
  generateContent,
  generateReflectionPrompt,
  generateWritingPrompts,
  generateAffirmation
}

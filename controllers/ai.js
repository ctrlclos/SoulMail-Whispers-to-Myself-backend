// handles HTTP requests for AI generation endpoints.
/**
 * AI Controller
 *
 * Handles HTTP requests for AI generation endpoints.
 * Follows the existing controller pattern in this codebase.
 */

const aiService = require('../services/aiService');
const letterService = require('../services/letterService');
const { asyncHandler, ValidationError } = require('../middleware/errorHandler');

/**
 * POST /ai/generate
 * Generate content from a prompt
 */
const generate = asyncHandler(async (req, res) => {
  const { prompt, systemInstruction, model, temperature, maxOutputTokens } = req.body;

  const response = await aiService.generateContent(prompt, {
    systemInstruction,
    model,
    temperature,
    maxOutputTokens
  });

  res.status(200).json({
    success: true,
    data: response
  });
});

/**
 * POST /ai/reflection-prompt
 * Generate a personalized reflection prompt for a delivered letter.
 *
 * Request body:
 * - letterId: string (required) - ID of the delivered letter
 */
const getReflectionPrompt = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { letterId } = req.body;

  if (!letterId) {
    throw new ValidationError('Letter ID is required', {
      letterId: 'Please provide the letter ID'
    });
  }

  // Fetch the letter to get its content
  const letter = await letterService.getLetterById(userId, letterId);

  // Verify the letter is delivered
  if (!letter.isDelivered) {
    throw new ValidationError('Reflection prompts are only available for delivered letters', {
      letterId: 'This letter has not been delivered yet'
    });
  }

  const response = await aiService.generateReflectionPrompt(letter);

  res.status(200).json({
    success: true,
    data: {
      prompt: response.prompt,
      letterId: letter._id
    }
  });
});

/**
 * GET /ai/writing-prompts
 * Generate AI-powered writing prompts for inspiration.
 *
 * Query parameters:
 * - mood: string (optional) - Current mood
 * - theme: string (optional) - Theme for prompts (gratitude, goals, memories, etc.)
 * - count: number (optional) - Number of prompts (default: 3, max: 5)
 */
const getWritingPrompts = asyncHandler(async (req, res) => {
  const { mood, theme, count } = req.query;

  // Validate count if provided
  let promptCount = parseInt(count, 10) || 3;
  if (promptCount < 1) promptCount = 1;
  if (promptCount > 5) promptCount = 5;

  const response = await aiService.generateWritingPrompts({
    mood,
    theme,
    count: promptCount
  });

  res.status(200).json({
    success: true,
    data: {
      prompts: response.prompts
    }
  });
});

/**
 * GET /ai/affirmation
 * Generate a positive affirmation for the user.
 *
 * Query parameters:
 * - timeOfDay: string (optional) - morning, afternoon, evening, night
 */
const getAffirmation = asyncHandler(async (req, res) => {
  const { timeOfDay } = req.query;
  const user = req.user;

  // Extract user info for personalization
  const username = user.name || user.username;
  const stats = user.stats;

  const response = await aiService.generateAffirmation({
    username,
    timeOfDay,
    stats
  });

  res.status(200).json({
    success: true,
    data: {
      affirmation: response.affirmation
    }
  });
});

module.exports = {
  generate,
  getReflectionPrompt,
  getWritingPrompts,
  getAffirmation
};

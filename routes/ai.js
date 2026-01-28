const express = require('express');
const router = express.Router();
const aiController = require('../controllers/ai');
const verifyToken = require('../middleware/verify-token');

// All AI routes require authentication
router.use(verifyToken);

// POST /ai/generate - One-shot generation
router.post('/generate', aiController.generate);

// POST /ai/reflection-prompt - Generate reflection prompt for a delivered letter
router.post('/reflection-prompt', aiController.getReflectionPrompt);

// GET /ai/writing-prompts - Get AI-generated writing prompts for inspiration
router.get('/writing-prompts', aiController.getWritingPrompts);

// GET /ai/affirmation - Get a positive affirmation
router.get('/affirmation', aiController.getAffirmation);

module.exports = router;

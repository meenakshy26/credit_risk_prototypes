/**
 * Thin HTTP wrapper around the PAN entity detection logic.
 * All business rules live in ./pan.js — this file only handles HTTP.
 */

const express = require('express');
const { detectEntityType } = require('./pan.js');

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/v1/pan/entity-type', (req, res) => {
  const { pan } = req.body ?? {};

  if (typeof pan !== 'string' || pan.length === 0) {
    return res.status(400).json({
      valid: false,
      error: "Request body must be JSON with a non-empty string field 'pan'",
    });
  }

  const result = detectEntityType(pan);
  return res.status(result.valid ? 200 : 422).json(result);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PAN entity detection API listening on http://localhost:${PORT}`);
});

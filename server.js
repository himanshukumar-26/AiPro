'use strict';
const express = require('express');
const path = require('path');
const app = express();
const publicDirectory = path.join(__dirname, 'public');
const port = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '80kb' }));
app.use(express.static(publicDirectory));

app.get('/api/health', (req, res) => {
  res.set('Cache-Control', 'no-store').json({ ok: true });
});

app.get('/api/data', (req, res) => {
  res.sendFile(path.join(publicDirectory, 'data', 'sample_prices.csv'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(publicDirectory, 'index.html'));
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: 'Internal server error' });
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`HarvestIQ is running at http://localhost:${port}`);
  });
}

module.exports = app;

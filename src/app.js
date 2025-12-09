const express = require('express');
const scheduleRoutes = require('./routes/scheduleRoutes');

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes - using /api/schedule prefix to match client expectations
app.use('/api/schedule', scheduleRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Internal server error', error: err.message });
});

module.exports = app;

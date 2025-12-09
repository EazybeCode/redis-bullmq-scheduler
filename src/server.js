require('dotenv').config();
const app = require('./app');
const Logger = require('./utils/logger');

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  Logger.info(`Server started on port ${PORT}`, {
    environment: process.env.NODE_ENV,
    port: PORT,
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  Logger.info('SIGTERM received, closing server...');
  server.close(() => {
    Logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  Logger.info('SIGINT received, closing server...');
  server.close(() => {
    Logger.info('Server closed');
    process.exit(0);
  });
});
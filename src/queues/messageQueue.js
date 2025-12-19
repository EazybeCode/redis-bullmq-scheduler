const { Queue } = require('bullmq');
const redisConnection = require('../config/redis');

const messageQueue = new Queue('scheduled-messages', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: parseInt(process.env.MAX_JOB_ATTEMPTS) || 3,
    backoff: {
      type: 'custom',
    },
    removeOnComplete: {
      age: 3600, // Keep completed jobs for 1 hour
      count: 1000, // Keep last 1000 completed jobs
    },
    removeOnFail: {
      age: 86400, // Keep failed jobs for 24 hours
    },
  },
});

messageQueue.on('error', (error) => {
  console.error('Queue error:', error);
});

module.exports = messageQueue;
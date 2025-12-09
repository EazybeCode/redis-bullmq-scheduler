const { Worker } = require('bullmq');
const redisConnection = require('../config/redis');
const MessageService = require('../services/messageService');
const Logger = require('../utils/logger');

/**
 * Message Worker
 * Listens to the 'scheduled-messages' queue and processes jobs
 * 
 * Expected Payload Structure (from eazybe_api_backend publisher):
 * {
 *   eventType: 'schedule:create' | 'schedule:update',
 *   id: number,
 *   scheduleId: number,
 *   workspaceId: number,
 *   userMobile: string,
 *   recipient: string (chat_id),
 *   customerMobile: string,
 *   customerName: string,
 *   content: string (message),
 *   scheduledTime: number (timestamp),
 *   isRecurring: boolean,
 *   recurrenceInterval: number (ms),
 *   repeatingTimes: number | null,
 *   endTime: number | null,
 *   scheduledFile: string | null,
 *   scheduledFileName: string | null,
 *   sessionName: string,
 *   apiEndpoint: string,
 *   domain: string,
 *   imgSrc: string | null,
 *   createdAt: number,
 * }
 */

const worker = new Worker(
  'scheduled-messages',
  async (job) => {
    const payload = job.data;
    const attemptCount = job.attemptsMade || 0;
    console.log('payload', payload);

    try {
      Logger.info('Processing scheduled message job', {
        jobId: job.id,
        eventType: payload.eventType,
        scheduleId: payload.scheduleId,
        workspaceId: payload.workspaceId,
        recipient: payload.recipient,
        attemptCount,
      });

      // Validate required fields
      if (!payload.recipient || !payload.content) {
        throw new Error('Missing required fields: recipient or content');
      }

      if (!payload.apiEndpoint && !payload.domain) {
        throw new Error('Missing apiEndpoint or domain for sending message');
      }

      // Send the message
      const result = await MessageService.sendScheduledMessage(payload);

      // Handle recurring messages
      if (payload.isRecurring && result.success) {
        await MessageService.handleRecurringMessage(payload, job);
      }

      Logger.info('Job completed successfully', {
        jobId: job.id,
        scheduleId: payload.scheduleId,
        recipient: payload.recipient,
        sentAt: new Date().toISOString(),
      });

      return {
        success: true,
        scheduleId: payload.scheduleId,
        sentAt: Date.now(),
        result,
      };
    } catch (error) {
      Logger.error('Job processing failed', error, {
        jobId: job.id,
        scheduleId: payload.scheduleId,
        recipient: payload.recipient,
        attemptCount,
      });

      // Re-throw to trigger retry
      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: parseInt(process.env.WORKER_CONCURRENCY) || 10,
    limiter: {
      max: 100,
      duration: 60000, // 100 jobs per minute
    },
  }
);

// Event handlers
worker.on('completed', (job, result) => {
  Logger.info('✅ Job completed', {
    jobId: job.id,
    scheduleId: result?.scheduleId,
    sentAt: result?.sentAt ? new Date(result.sentAt).toISOString() : null,
  });
});

worker.on('failed', (job, error) => {
  Logger.error('❌ Job failed', error, {
    jobId: job?.id,
    scheduleId: job?.data?.scheduleId,
    attemptsMade: job?.attemptsMade,
    maxAttempts: job?.opts?.attempts,
  });
});

worker.on('error', (error) => {
  Logger.error('Worker error', error);
});

worker.on('stalled', (jobId) => {
  Logger.warn('Job stalled', { jobId });
});

Logger.info('🚀 Message Worker started', {
  queue: 'scheduled-messages',
  concurrency: parseInt(process.env.WORKER_CONCURRENCY) || 10,
  rateLimit: '100 jobs/minute',
});

// Graceful shutdown
const gracefulShutdown = async (signal) => {
  Logger.info(`${signal} received, closing worker...`);
  await worker.close();
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = worker;

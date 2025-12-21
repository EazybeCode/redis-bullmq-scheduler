const { Worker } = require('bullmq');
const redisConnection = require('../config/redis');
const MessageService = require('../services/messageService');
const CloudService = require('../services/cloudService');
const Logger = require('../utils/logger');

/**
 * Custom backoff strategy for retries
 * Attempt 1: Wait 1 minute (60000ms)
 * Attempt 2: Wait 2 minutes (120000ms)
 * Attempt 3+: Wait 2 minutes (120000ms)
 */
const customBackoffStrategy = (attemptsMade) => {
  if (attemptsMade === 1) {
    return 60000; // 1 minute for first retry
  }
  return 120000; // 2 minutes for subsequent retries
};

/**
 * Message Worker
 * Listens to the 'scheduled-messages' queue and processes jobs
 * 
 * Implements "Deferred Cloud Check" pattern:
 * - Cloud connection is verified at job execution time (not schedule creation time)
 * - Session-to-server mapping is fetched dynamically
 * - Endpoint is built dynamically based on current mapping
 * 
 * Expected Payload Structure (from eazybe_api_backend publisher):
 * {
 *   eventType: 'schedule:create' | 'schedule:update',
 *   id: number,
 *   scheduleId: number,
 *   workspaceId: number,
 *   userMobile: string,           // Required for cloud check
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
 *   imgSrc: string | null,
 *   createdAt: number,
 * }
 * 
 * Note: sessionName, apiEndpoint, and domain are now resolved dynamically
 * at execution time, not passed in payload.
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
        userMobile: payload.userMobile,
        attemptCount,
      });

      // Validate required fields
      if (!payload.recipient || !payload.content) {
        throw new Error('Missing required fields: recipient or content');
      }

      if (!payload.userMobile) {
        throw new Error('Missing required field: userMobile (needed for cloud check)');
      }

      // ============ DEFERRED CLOUD CHECK (NEW) ============
      
      // 1. Check cloud connection
      Logger.info('Checking cloud connection', {
        jobId: job.id,
        userMobile: payload.userMobile,
      });
      
      const cloudStatus = await CloudService.isUserConnectedToCloud(payload.userMobile);
      if (!cloudStatus.isConnected) {
        const error = new Error('USER_NOT_CONNECTED');
        error.code = 'USER_NOT_CONNECTED';
        error.details = `User ${payload.userMobile} is not connected to cloud`;
        throw error;
      }

      // 2. Fetch session mapping
      Logger.info('Fetching session server mapping', {
        jobId: job.id,
        sessionName: cloudStatus.sessionData.session_name,
      });
      
      const sessionMapping = await CloudService.fetchSessionServerMapping(
        cloudStatus.sessionData.session_name
      );
      if (!sessionMapping?.domain) {
        const error = new Error('SESSION_MAPPING_NOT_FOUND');
        error.code = 'SESSION_MAPPING_NOT_FOUND';
        error.details = `No server mapping found for session: ${cloudStatus.sessionData.session_name}`;
        throw error;
      }

      // 3. Build endpoint dynamically
      const apiEndpoint = `${sessionMapping.domain}/api/sendText`;
      payload.sessionName = cloudStatus.sessionData.session_name;
      payload.domain = sessionMapping.domain;
      payload.apiEndpoint = apiEndpoint;

      Logger.info('Cloud check passed, endpoint built', {
        jobId: job.id,
        sessionName: payload.sessionName,
        domain: payload.domain,
        apiEndpoint: payload.apiEndpoint,
      });

      // ============ END DEFERRED CLOUD CHECK ============

      // 4. Send the message (existing logic)
      const result = await MessageService.sendScheduledMessage(payload);

      // 5. Update database status to sent (NEW)
      await CloudService.updateScheduleStatus(payload.scheduleId, 1); // 1 = sent

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
        errorCode: error.code,
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
    settings: {
      backoffStrategy: customBackoffStrategy,
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

worker.on('failed', async (job, error) => {
  const attemptsMade = job?.attemptsMade || 0;
  const maxAttempts = job?.opts?.attempts || 3;
  
  Logger.error('❌ Job failed', error, {
    jobId: job?.id,
    scheduleId: job?.data?.scheduleId,
    attemptsMade,
    maxAttempts,
    errorCode: error?.code,
  });

  // Check if all retries are exhausted
  if (attemptsMade >= maxAttempts) {
    Logger.warn('All retries exhausted, marking schedule as failed', {
      jobId: job?.id,
      scheduleId: job?.data?.scheduleId,
      attemptsMade,
      maxAttempts,
    });

    try {
      // Update database status to failed (-1)
      await CloudService.updateScheduleStatus(
        job?.data?.scheduleId,
        -1, // -1 = failed
        error?.message || 'Unknown error after all retries'
      );
    } catch (updateError) {
      Logger.error('Failed to update schedule status after retries exhausted', updateError, {
        scheduleId: job?.data?.scheduleId,
      });
    }
  }
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

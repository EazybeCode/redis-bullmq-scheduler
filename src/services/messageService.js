const axios = require('axios');
const { Queue } = require('bullmq');
const Logger = require('../utils/logger');
const redisConnection = require('../config/redis');

// Get queue instance for re-queuing recurring messages
let messageQueue = null;
const getQueue = () => {
  if (!messageQueue) {
    messageQueue = require('../queues/messageQueue');
  }
  return messageQueue;
};

/**
 * Message Service
 * Handles sending scheduled messages and managing recurring messages
 */
class  MessageService {
  // File type mapping for message attachments
  static FILE_TYPE_MAP = {
    video: {
      extensions: ['mp4', 'avi', 'mov', 'wmv', 'flv', 'mkv', 'webm', '3gp'],
      endpoint: '/api/sendVideo',
      mimePrefix: 'video/'
    },
    image: {
      extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'ico', 'svg', 'webp'],
      endpoint: '/api/sendImage',
      mimePrefix: 'image/'
    },
    audio: {
      extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'],
      endpoint: '/api/sendFile',
      mimePrefix: 'audio/'
    },
    document: {
      extensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'rtf', 'odt'],
      endpoint: '/api/sendFile',
      mimePrefix: 'application/'
    }
  };

  // Constants for scheduler
  static SCHEDULER_CONSTANTS = {
    HTTP_TIMEOUT: 30000
  };

  /**
   * Determine file type and endpoint based on file extension
   * @param {string} fileExtension - File extension (e.g., 'jpg', 'pdf', 'mp4')
   * @param {string} serverDomain - Server domain URL
   * @returns {Object} - { url, mimetype }
   */
  static determineFileTypeAndEndpoint(fileExtension, serverDomain) {
    // Find the file type
    for (const [type, config] of Object.entries(this.FILE_TYPE_MAP)) {
      if (config.extensions.includes(fileExtension)) {
        // Special cases for common mime types
        let mime = '';
        switch (fileExtension) {
          case 'jpg':
          case 'jpeg':
            mime = 'image/jpeg';
            break;
          case 'png':
            mime = 'image/png';
            break;
          case 'pdf':
            mime = 'application/pdf';
            break;
          default:
            // Use standard format for the rest
            mime = `${config.mimePrefix}${fileExtension}`;
        }

        return {
          url: `${serverDomain}${config.endpoint}`,
          mimetype: mime
        };
      }
    }

    // Default handling for unknown types
    return {
      url: `${serverDomain}/api/sendFile`,
      mimetype: `application/${fileExtension}`
    };
  }

  /**
   * Send a file message
   * @param {Object} scheduler - Scheduler object with file information
   * @param {string} serverDomain - Server domain URL
   * @param {string} sessionName - WhatsApp session name
   * @returns {boolean} - Success status
   */
  static async sendFileMessage(scheduler, serverDomain, sessionName) {
    const splitedFileName = scheduler.scheduled_file_name.split('.');
    const fileExtension = splitedFileName[splitedFileName.length - 1].toLowerCase();

    const { url, mimetype } = this.determineFileTypeAndEndpoint(fileExtension, serverDomain);

    if (!url) return false;

    const data = {
      chatId: scheduler.chat_id || scheduler.recipient,
      file: {
        mimetype,
        filename: scheduler.scheduled_file_name,
        url: scheduler.scheduled_file
      },
      reply_to: null,
      caption: scheduler.message || '',
      session: sessionName
    };

    try {
      const response = await axios.request({
        method: 'post',
        maxBodyLength: Infinity,
        url,
        headers: { 'Content-Type': 'application/json' },
        data,
        timeout: this.SCHEDULER_CONSTANTS.HTTP_TIMEOUT
      });

      return response.status === 201;
    } catch (error) {
      console.error(`Failed to send file message: ${error.message}`);
      return false;
    }
  }

  /**
   * Send a scheduled message
   * 
   * @param {Object} payload - The job payload from the queue
   * Expected payload structure:
   * {
   *   scheduleId, workspaceId, userMobile,
   *   recipient, customerMobile, customerName,
   *   content, scheduledTime,
   *   isRecurring, recurrenceInterval, repeatingTimes, endTime,
   *   scheduledFile, scheduledFileName,
   *   sessionName, apiEndpoint, domain,
   *   imgSrc
   * }
   */
  static async sendScheduledMessage(payload) {
    try {
      console.log('payload', payload);

     
      
      // Check if message has a file attachment
      if (payload.scheduledFile && payload.scheduledFileName) {
        // Send file message
        const scheduler = {
          recipient: payload.recipient,
          chat_id: payload.recipient, // Support both field names
          scheduled_file: payload.scheduledFile,
          scheduled_file_name: payload.scheduledFileName,
          text: payload.content || ''
        };

        Logger.info('Sending scheduled file message', {
          scheduleId: payload.scheduleId,
          recipient: payload.recipient,
          fileName: payload.scheduledFileName,
          hasFile: true,
        });

        const success = await this.sendFileMessage(scheduler, payload.domain, payload.sessionName);

        if (success) {
          Logger.info('File message sent successfully', {
            scheduleId: payload.scheduleId,
            recipient: payload.recipient,
          });

          return {
            success: true,
            statusCode: 201,
            data: { message: 'File message sent successfully' },
          };
        } else {
          throw new Error('Failed to send file message');
        }
      }

      // Send text message
      // Use apiEndpoint if provided, otherwise construct from domain
      const apiEndpoint = payload.apiEndpoint || `${payload.domain}/api/sendText`;
      console.log(payload.content);

      // Build message payload for WhatsApp API
      const messagePayload = {
        chatId: payload.recipient,
        text: payload.content,
        linkPreview: true,
        linkPreviewHighQuality: false,
        session: payload.sessionName,
      };
      console.log('messagePayload', messagePayload);
      Logger.info('Sending scheduled message', {
        scheduleId: payload.scheduleId,
        recipient: payload.recipient,
        apiEndpoint,
        hasFile: false,
      });

      const response = await axios.post(apiEndpoint, messagePayload, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });

      Logger.info('Message sent successfully', {
        scheduleId: payload.scheduleId,
        recipient: payload.recipient,
        statusCode: response.status,
      });

      return {
        success: true,
        statusCode: response.status,
        data: response.data,
      };
    } catch (error) {
      // Enhanced error logging for better debugging
      const apiEndpoint = payload.scheduledFile 
        ? `${payload.domain}/api/sendFile` 
        : `${payload.domain}/api/sendText`;
      
      const errorDetails = {
        scheduleId: payload.scheduleId,
        recipient: payload.recipient,
        apiEndpoint,
        method: 'POST',
        hasFile: !!payload.scheduledFile,
      };

      // Add specific error information
      if (error.response) {
        // Server responded with error status
        errorDetails.statusCode = error.response.status;
        errorDetails.statusText = error.response.statusText;
        errorDetails.responseData = error.response.data;
        errorDetails.responseHeaders = error.response.headers;
        
        if (error.response.status === 404) {
          errorDetails.message = `API endpoint not found. Check if the endpoint exists: ${apiEndpoint}`;
          errorDetails.troubleshooting = [
            'Verify the endpoint path is correct',
            'Check if the WhatsApp API server is running',
            'Confirm the API route exists on the server',
            'Test the endpoint manually: curl -X POST ' + apiEndpoint,
          ];
        } else if (error.response.status === 401) {
          errorDetails.message = 'Unauthorized - Check API_TOKEN in .env file';
        } else if (error.response.status === 403) {
          errorDetails.message = 'Forbidden - Check API permissions';
        } else if (error.response.status >= 500) {
          errorDetails.message = 'Server error - WhatsApp API server issue';
        }
      } else if (error.request) {
        // Request was made but no response received
        errorDetails.message = 'No response from server';
        errorDetails.troubleshooting = [
          'Check if the server is running',
          'Verify network connectivity',
          'Check firewall rules',
        ];
      } else {
        // Error setting up the request
        errorDetails.message = error.message;
      }

      Logger.error('Failed to send message', error, errorDetails);

      throw error;
    }
  }

  /**
   * Handle recurring message - re-queue for next execution
   */
  static async handleRecurringMessage(payload, job) {
    try {
      // Check if we should continue recurring
      if (payload.repeatingTimes !== null && payload.repeatingTimes <= 1) {
        Logger.info('Recurring message completed all repetitions', {
          scheduleId: payload.scheduleId,
        });
        return;
      }

      // Check end time
      if (payload.endTime && Date.now() >= payload.endTime) {
        Logger.info('Recurring message reached end time', {
          scheduleId: payload.scheduleId,
        });
        return;
      }

      const nextDelay = payload.recurrenceInterval;
      if (!nextDelay || nextDelay <= 0) {
        Logger.error('Invalid recurrence interval', null, {
          scheduleId: payload.scheduleId,
        });
        return;
      }

      // Create updated payload for next execution
      const nextPayload = {
        ...payload,
        scheduledTime: Date.now() + nextDelay,
        repeatingTimes: payload.repeatingTimes ? payload.repeatingTimes - 1 : null,
        previousExecutionTime: Date.now(),
      };

      // Generate new job ID
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 8);
      const newJobId = `schedule-${payload.scheduleId}-${timestamp}-${random}`;

      // Calculate priority
      const priority = this.calculatePriority(nextDelay);

      // Add to queue
      const queue = getQueue();
      const newJob = await queue.add('send-message', nextPayload, {
        jobId: newJobId,
        delay: nextDelay,
        priority,
      });

      Logger.info('Recurring message re-queued', {
        scheduleId: payload.scheduleId,
        oldJobId: job.id,
        newJobId: newJob.id,
        nextExecutionIn: `${Math.round(nextDelay / 1000 / 60)} minutes`,
        remainingRepetitions: nextPayload.repeatingTimes,
      });
    } catch (error) {
      Logger.error('Failed to re-queue recurring message', error, {
        scheduleId: payload.scheduleId,
      });
    }
  }

  /**
   * Calculate priority based on delay
   */
  static calculatePriority(delay) {
    if (delay < 60000) return 1;        // < 1 minute
    if (delay < 300000) return 3;       // < 5 minutes
    if (delay < 3600000) return 5;      // < 1 hour
    return 7;                           // > 1 hour
  }

  // ============ Queue Management Methods (for API endpoints) ============

  /**
   * Get all jobs for a schedule ID
   */
  static async findJobsByScheduleId(scheduleId) {
    const queue = getQueue();
    const scheduleIdStr = String(scheduleId);
    const matchingJobs = [];

    const checkJobs = async (jobs) => {
      for (const job of jobs) {
        if (
          job.id?.includes(`schedule-${scheduleIdStr}-`) ||
          String(job.data?.scheduleId) === scheduleIdStr ||
          String(job.data?.id) === scheduleIdStr
        ) {
          matchingJobs.push(job);
        }
      }
    };

    await checkJobs(await queue.getDelayed());
    await checkJobs(await queue.getWaiting());
    await checkJobs(await queue.getActive());

    return matchingJobs;
  }

  /**
   * Get all jobs for a workspace ID
   */
  static async findJobsByWorkspaceId(workspaceId) {
    const queue = getQueue();
    const workspaceIdStr = String(workspaceId);
    const matchingJobs = [];

    const checkJobs = async (jobs) => {
      for (const job of jobs) {
        if (String(job.data?.workspaceId) === workspaceIdStr) {
          matchingJobs.push(job);
        }
      }
    };

    await checkJobs(await queue.getDelayed());
    await checkJobs(await queue.getWaiting());
    await checkJobs(await queue.getActive());

    return matchingJobs;
  }

  /**
   * Remove a job by schedule ID
   */
  static async removeJob(scheduleId) {
    const jobs = await this.findJobsByScheduleId(scheduleId);
    let removedCount = 0;

    for (const job of jobs) {
      try {
        await job.remove();
        removedCount++;
      } catch (err) {
        Logger.error('Failed to remove job', err, { jobId: job.id });
      }
    }

    return { success: true, removed: removedCount, scheduleId };
  }

  /**
   * Remove all jobs for a workspace
   */
  static async removeAllUserJobs(workspaceId) {
    const jobs = await this.findJobsByWorkspaceId(workspaceId);
    let removedCount = 0;

    for (const job of jobs) {
      try {
        await job.remove();
        removedCount++;
      } catch (err) {
        Logger.error('Failed to remove job', err, { jobId: job.id });
      }
    }

    return { success: true, removed: removedCount, workspaceId };
  }

  /**
   * Get job details by schedule ID
   */
  static async getJob(scheduleId) {
    const jobs = await this.findJobsByScheduleId(scheduleId);

    if (jobs.length === 0) {
      return { success: false, message: 'No jobs found' };
    }

    const job = jobs[0];
    const state = await job.getState();

    return {
      success: true,
      job: {
        id: job.id,
        scheduleId: job.data.scheduleId,
        workspaceId: job.data.workspaceId,
        state,
        recipient: job.data.recipient,
        content: job.data.content,
        scheduledTime: job.data.scheduledTime,
        isRecurring: job.data.isRecurring,
        attemptsMade: job.attemptsMade,
        delay: job.opts.delay,
        priority: job.opts.priority,
      },
    };
  }
}

module.exports = MessageService;

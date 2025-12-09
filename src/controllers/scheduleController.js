const MessageService = require('../services/messageService');
const Logger = require('../utils/logger');

/**
 * Schedule Controller
 * Provides API endpoints for monitoring and managing the queue
 * 
 * Note: In the pub/sub architecture, jobs are added directly to the queue
 * by the publisher (eazybe_api_backend). These endpoints are for:
 * - Monitoring queue status
 * - Debugging/viewing jobs
 * - Manual job management if needed
 */
class ScheduleController {
  /**
   * GET /queue-status
   * Get queue statistics
   */
  static async getQueueStatus(req, res) {
    try {
      const messageQueue = require('../queues/messageQueue');
      
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        messageQueue.getWaitingCount(),
        messageQueue.getActiveCount(),
        messageQueue.getCompletedCount(),
        messageQueue.getFailedCount(),
        messageQueue.getDelayedCount(),
      ]);

      res.status(200).json({
        success: true,
        data: {
          waiting,
          active,
          completed,
          failed,
          delayed,
          total: waiting + active + delayed,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      Logger.error('Get queue status error', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get queue status',
        error: error.message,
      });
    }
  }

  /**
   * GET /job/:scheduleId
   * Get job details by schedule ID
   */
  static async getJob(req, res) {
    try {
      const { scheduleId } = req.params;

      if (!scheduleId) {
        return res.status(400).json({
          success: false,
          message: 'scheduleId is required',
        });
      }

      const result = await MessageService.getJob(scheduleId);

      if (!result.success) {
        return res.status(404).json(result);
      }

      res.status(200).json({
        success: true,
        data: result.job,
      });
    } catch (error) {
      Logger.error('Get job error', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get job',
        error: error.message,
      });
    }
  }

  /**
   * GET /user-jobs/:workspaceId
   * Get all jobs for a workspace
   */
  static async getUserJobs(req, res) {
    try {
      const { workspaceId } = req.params;

      if (!workspaceId) {
        return res.status(400).json({
          success: false,
          message: 'workspaceId is required',
        });
      }

      const jobs = await MessageService.findJobsByWorkspaceId(workspaceId);

      const jobDetails = await Promise.all(
        jobs.map(async (job) => {
          const state = await job.getState();
          return {
            id: job.id,
            scheduleId: job.data.scheduleId,
            state,
            recipient: job.data.recipient,
            scheduledTime: job.data.scheduledTime,
            isRecurring: job.data.isRecurring,
          };
        })
      );

      res.status(200).json({
        success: true,
        data: {
          workspaceId,
          count: jobs.length,
          jobs: jobDetails,
        },
      });
    } catch (error) {
      Logger.error('Get user jobs error', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get user jobs',
        error: error.message,
      });
    }
  }

  /**
   * DELETE /job/:scheduleId
   * Remove a job by schedule ID (manual removal)
   */
  static async removeJob(req, res) {
    try {
      const { scheduleId } = req.params;

      if (!scheduleId) {
        return res.status(400).json({
          success: false,
          message: 'scheduleId is required',
        });
      }

      const result = await MessageService.removeJob(scheduleId);

      res.status(200).json({
        success: true,
        message: `Removed ${result.removed} job(s)`,
        data: result,
      });
    } catch (error) {
      Logger.error('Remove job error', error);
      res.status(500).json({
        success: false,
        message: 'Failed to remove job',
        error: error.message,
      });
    }
  }

  /**
   * DELETE /user-jobs/:workspaceId
   * Remove all jobs for a workspace (manual removal)
   */
  static async removeUserJobs(req, res) {
    try {
      const { workspaceId } = req.params;

      if (!workspaceId) {
        return res.status(400).json({
          success: false,
          message: 'workspaceId is required',
        });
      }

      const result = await MessageService.removeAllUserJobs(workspaceId);

      res.status(200).json({
        success: true,
        message: `Removed ${result.removed} job(s) for workspace ${workspaceId}`,
        data: result,
      });
    } catch (error) {
      Logger.error('Remove user jobs error', error);
      res.status(500).json({
        success: false,
        message: 'Failed to remove user jobs',
        error: error.message,
      });
    }
  }

  /**
   * GET /health
   * Health check for the queue service
   */
  static async healthCheck(req, res) {
    try {
      const messageQueue = require('../queues/messageQueue');
      const redisConnection = require('../config/redis');

      // Check Redis connection
      const redisStatus = redisConnection.status;
      
      // Check queue
      const queueName = messageQueue.name;

      res.status(200).json({
        success: true,
        status: 'healthy',
        data: {
          redis: redisStatus,
          queue: queueName,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        status: 'unhealthy',
        error: error.message,
      });
    }
  }
}

module.exports = ScheduleController;

const express = require('express');
const ScheduleController = require('../controllers/scheduleController');

const router = express.Router();

/**
 * Schedule Routes
 * 
 * These endpoints are for monitoring and manual management.
 * In the pub/sub architecture, jobs are added directly to the queue
 * by the publisher (eazybe_api_backend).
 */

// Health check
router.get('/health', ScheduleController.healthCheck);

// Queue status
router.get('/queue-status', ScheduleController.getQueueStatus);

// Get job by schedule ID
router.get('/job/:scheduleId', ScheduleController.getJob);

// Get all jobs for a workspace
router.get('/user-jobs/:workspaceId', ScheduleController.getUserJobs);

// Remove a job by schedule ID
router.delete('/job/:scheduleId', ScheduleController.removeJob);

// Remove all jobs for a workspace
router.delete('/user-jobs/:workspaceId', ScheduleController.removeUserJobs);

module.exports = router;

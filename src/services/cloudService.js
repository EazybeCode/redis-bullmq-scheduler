const { CloudSync, CloudServerSessionMapping, CustomerSchedule } = require('../models');
const Logger = require('../utils/logger');

/**
 * Cloud Service
 * Handles cloud connection checks, session mapping lookups, and schedule status updates
 * 
 * This service implements the "Deferred Cloud Check" pattern:
 * - Cloud connection is verified at job execution time (not schedule creation time)
 * - Session-to-server mapping is fetched dynamically
 * - Database status is updated based on job outcome
 */
class CloudService {
  /**
   * Check if a user is connected to cloud (WAHA)
   * 
   * @param {string} userPhone - The user's phone number
   * @returns {Promise<{isConnected: boolean, sessionData: Object|null}>}
   * 
   * @example
   * const result = await CloudService.isUserConnectedToCloud('919876543210');
   * // { isConnected: true, sessionData: { session_name: 'session_xyz', ... } }
   */
  static async isUserConnectedToCloud(userPhone) {
    try {
      const cloudSync = await CloudSync.findOne({
        where: {
          phone: userPhone,
          session_status: 'WORKING',
        },
      });

      if (cloudSync) {
        Logger.info('User cloud connection found', {
          phone: userPhone,
          sessionName: cloudSync.session_name,
          status: cloudSync.session_status,
        });

        return {
          isConnected: true,
          sessionData: {
            id: cloudSync.id,
            phone: cloudSync.phone,
            workspace_id: cloudSync.workspace_id,
            session_name: cloudSync.session_name,
            session_status: cloudSync.session_status,
          },
        };
      }

      Logger.warn('User not connected to cloud', { phone: userPhone });
      return {
        isConnected: false,
        sessionData: null,
      };
    } catch (error) {
      Logger.error('Error checking cloud connection', error, { phone: userPhone });
      throw error;
    }
  }

  /**
   * Fetch session server mapping (which WAHA server handles this session)
   * 
   * @param {string} sessionName - The session name from cloud_sync
   * @returns {Promise<{domain: string, session_name: string}|null>}
   * 
   * @example
   * const mapping = await CloudService.fetchSessionServerMapping('session_xyz');
   * // { domain: 'https://waha1.example.com', session_name: 'session_xyz' }
   */
  static async fetchSessionServerMapping(sessionName) {
    try {
      const mapping = await CloudServerSessionMapping.findOne({
        where: {
          session_name: sessionName,
        },
      });

      if (mapping) {
        Logger.info('Session server mapping found', {
          sessionName,
          domain: mapping.domain,
        });

        return {
          domain: mapping.domain,
          session_name: mapping.session_name,
        };
      }

      Logger.warn('Session server mapping not found', { sessionName });
      return null;
    } catch (error) {
      Logger.error('Error fetching session mapping', error, { sessionName });
      throw error;
    }
  }

  /**
   * Update schedule status in database
   * 
   * @param {number} scheduleId - The schedule ID to update
   * @param {number} status - Status code (0=pending, 1=sent, -1=failed)
   * @param {string|null} logs - Optional error logs or additional information
   * @returns {Promise<boolean>} - True if update was successful
   * 
   * Status codes:
   *   0  = Pending (scheduled, not yet sent)
   *   1  = Sent successfully
   *  -1  = Failed (after all retries exhausted)
   */
  static async updateScheduleStatus(scheduleId, status, logs = null) {
    try {
      const updateData = { status };
      if (logs !== null) {
        updateData.logs = logs;
      }

      const [updatedRows] = await CustomerSchedule.update(updateData, {
        where: { id: scheduleId },
      });

      if (updatedRows > 0) {
        Logger.info('Schedule status updated', {
          scheduleId,
          status,
          statusMeaning: status === 1 ? 'sent' : status === -1 ? 'failed' : 'pending',
          hasLogs: logs !== null,
        });
        return true;
      }

      Logger.warn('Schedule not found for status update', { scheduleId });
      return false;
    } catch (error) {
      Logger.error('Error updating schedule status', error, { scheduleId, status });
      throw error;
    }
  }
}

module.exports = CloudService;

/**
 * Validator Utility
 * Validates job payloads
 */
class Validator {
  /**
   * Validate message event payload
   * @param {Object} event - The job payload
   * Expected structure from eazybe_api_backend publisher:
   * {
   *   id, scheduleId, workspaceId,
   *   recipient (chat_id), content (message),
   *   scheduledTime, apiEndpoint OR domain,
   *   isRecurring, recurrenceInterval, ...
   * }
   */
  static validateMessageEvent(event) {
    const errors = [];

    // Required fields
    if (!event.id && !event.scheduleId) {
      errors.push('id or scheduleId is required');
    }
    if (!event.recipient) {
      errors.push('recipient is required');
    }
    if (!event.content) {
      errors.push('content is required');
    }
    if (!event.scheduledTime) {
      errors.push('scheduledTime is required');
    }
    // Allow either apiEndpoint or domain
    if (!event.apiEndpoint && !event.domain) {
      errors.push('apiEndpoint or domain is required');
    }

    // Validate timestamp
    if (event.scheduledTime && !this.isValidTimestamp(event.scheduledTime)) {
      errors.push('scheduledTime must be a valid timestamp');
    }

    // Validate recurring settings
    if (event.isRecurring) {
      if (!event.recurrenceInterval) {
        errors.push('recurrenceInterval is required for recurring messages');
      }
      if (event.recurrenceInterval && event.recurrenceInterval <= 0) {
        errors.push('recurrenceInterval must be greater than 0');
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Check if a value is a valid timestamp
   */
  static isValidTimestamp(timestamp) {
    return typeof timestamp === 'number' && timestamp > 0 && !isNaN(timestamp);
  }

  /**
   * Validate workspace ID
   */
  static validateWorkspaceId(workspaceId) {
    if (!workspaceId) {
      return { isValid: false, error: 'workspaceId is required' };
    }
    return { isValid: true };
  }

  /**
   * Validate schedule ID
   */
  static validateScheduleId(scheduleId) {
    if (!scheduleId) {
      return { isValid: false, error: 'scheduleId is required' };
    }
    return { isValid: true };
  }
}

module.exports = Validator;

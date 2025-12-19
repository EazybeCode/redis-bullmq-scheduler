const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * CustomerSchedule Model
 * Represents the customerSchedules table
 * Used to update schedule status after job execution
 * 
 * Status codes:
 *   0  = Pending (scheduled, not yet sent)
 *   1  = Sent successfully
 *  -1  = Failed (after all retries exhausted)
 */
const CustomerSchedule = sequelize.define('CustomerSchedule', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  status: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 0,
    comment: '0=pending, 1=sent, -1=failed',
  },
  logs: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Error logs or additional information',
  },
}, {
  tableName: 'customerSchedules',
  timestamps: false,
});

module.exports = CustomerSchedule;

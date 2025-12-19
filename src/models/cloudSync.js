const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * CloudSync Model
 * Represents the cloud_sync table
 * Used to check if a user is connected to cloud (WAHA)
 */
const CloudSync = sequelize.define('CloudSync', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  phone: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  workspace_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  session_name: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  session_status: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'WORKING = connected, other values = disconnected',
  },
}, {
  tableName: 'cloud_sync',
  timestamps: false,
});

module.exports = CloudSync;

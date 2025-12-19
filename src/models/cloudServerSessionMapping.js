const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * CloudServerSessionMapping Model
 * Represents the cloud_session_server_mappings table
 * Maps session names to their corresponding WAHA server domains
 */
const CloudServerSessionMapping = sequelize.define('CloudServerSessionMapping', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  session_name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  domain: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'WAHA server domain URL',
  },
}, {
  tableName: 'cloud_session_server_mappings',
  timestamps: false,
});

module.exports = CloudServerSessionMapping;

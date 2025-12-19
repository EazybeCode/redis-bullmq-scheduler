const sequelize = require('../config/database');
const CloudSync = require('./cloudSync');
const CloudServerSessionMapping = require('./cloudServerSessionMapping');
const CustomerSchedule = require('./customerSchedule');

/**
 * Models Index
 * Exports all database models and sequelize instance
 */
module.exports = {
  sequelize,
  CloudSync,
  CloudServerSessionMapping,
  CustomerSchedule,
};

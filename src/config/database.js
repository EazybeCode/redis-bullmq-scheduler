const { Sequelize } = require('sequelize');
require('dotenv').config();

/**
 * Database Configuration
 * Connects to MySQL database using Sequelize ORM
 * Uses same credentials as eazybe_api_backend
 */
const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    dialect: 'mysql',
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    pool: {
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
    define: {
      timestamps: false, // Tables don't use Sequelize timestamps by default
      underscored: true, // Use snake_case for column names
    },
  }
);

// Test connection
const testConnection = async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ MySQL database connected successfully');
  } catch (error) {
    console.error('❌ Unable to connect to MySQL database:', error.message);
  }
};

// Initialize connection on module load
testConnection();

module.exports = sequelize;

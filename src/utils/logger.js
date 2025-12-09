class Logger {
  static info(message, data = {}) {
    console.log(JSON.stringify({
      level: 'info',
      message,
      timestamp: new Date().toISOString(),
      ...data
    }));
  }

  static error(message, error = {}, data = {}) {
    console.error(JSON.stringify({
      level: 'error',
      message,
      error: error.message || error,
      stack: error.stack,
      timestamp: new Date().toISOString(),
      ...data
    }));
  }

  static warn(message, data = {}) {
    console.warn(JSON.stringify({
      level: 'warn',
      message,
      timestamp: new Date().toISOString(),
      ...data
    }));
  }
}

module.exports = Logger;
const path = require('node:path')
const packageJson = require('./package.json')

module.exports = {
  ...packageJson.build,
  electronDownload: {
    cache: process.env.ELECTRON_CACHE_DIR || path.resolve(__dirname, '..', 'electron-cache'),
    mirror: process.env.ELECTRON_MIRROR || undefined
  }
}

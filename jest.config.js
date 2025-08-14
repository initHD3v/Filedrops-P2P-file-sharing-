module.exports = {
  testEnvironment: 'jest-environment-jsdom',
  setupFilesAfterEnv: ['@testing-library/jest-dom'],
  globals: {
    TextEncoder: require('util').TextEncoder,
    TextDecoder: require('util').TextDecoder,
  },
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  moduleNameMapper: {
    // Jika Anda memiliki pemetaan path khusus di masa depan, tambahkan di sini
  },
  // Transform ES modules to CommonJS for Jest
  transform: {
    '^.+\.js$': 'babel-jest',
  },
};
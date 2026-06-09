import * as fs from 'fs';

async function globalTeardown() {
  // Clean up auth state file after tests
  if (fs.existsSync('auth-state.json')) {
    fs.unlinkSync('auth-state.json');
    console.log('🧹 Auth state cleaned up');
  }
}

export default globalTeardown;
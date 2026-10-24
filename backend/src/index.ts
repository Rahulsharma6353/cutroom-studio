// Load backend/.env before anything reads process.env, then start the server.
try {
  process.loadEnvFile('.env');
} catch {
  // no .env: defaults and the shell environment apply
}
await import('./server');
export {};

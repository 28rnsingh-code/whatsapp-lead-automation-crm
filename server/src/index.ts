import { app } from './app';
import dotenv from 'dotenv';

dotenv.config();

const PORT = parseInt(process.env.PORT || '4000', 10);

const server = app.listen(PORT, () => {
  console.log(`[OneClick Automics CRM API] Server listening on http://localhost:${PORT}`);
  console.log(`[OneClick Automics CRM API] Health check: http://localhost:${PORT}/api/health`);
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('[API] SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('[API] HTTP server closed');
  });
});

process.on('SIGINT', () => {
  console.log('[API] SIGINT signal received: closing HTTP server');
  server.close(() => {
    console.log('[API] HTTP server closed');
  });
});

export const logger = {
  info: (msg: string, meta?: unknown) => {
    console.log(`[INFO] [${new Date().toISOString()}] ${msg}`, meta ? meta : "");
  },
  warn: (msg: string, meta?: unknown) => {
    console.warn(`[WARN] [${new Date().toISOString()}] ${msg}`, meta ? meta : "");
  },
  error: (msg: string, error?: unknown) => {
    console.error(`[ERROR] [${new Date().toISOString()}] ${msg}`, error ? error : "");
  }
};

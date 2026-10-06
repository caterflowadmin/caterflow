// src/lib/logger.ts
// Leveled logger. `debug` is silent unless LOG_LEVEL=debug, so hot paths can
// keep their diagnostics without paying for console I/O in production.
const level = (process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'warn' : 'info')).toLowerCase();
const rank: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const enabled = (l: string) => (rank[l] ?? 1) >= (rank[level] ?? 1);

export const logger = {
  debug: (...args: any[]) => { if (enabled('debug')) console.log('DEBUG:', ...args); },
  info: (...args: any[]) => { if (enabled('info')) console.log('INFO:', ...args); },
  warn: (...args: any[]) => { if (enabled('warn')) console.warn('WARN:', ...args); },
  error: (...args: any[]) => { if (enabled('error')) console.error('ERROR:', ...args); },
  time: (label: string) => { if (enabled('debug')) console.time(label); },
  timeEnd: (label: string) => { if (enabled('debug')) console.timeEnd(label); },
};

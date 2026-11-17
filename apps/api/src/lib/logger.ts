// Minimal JSON-lines logger. Render captures stdout. Never pass secrets, tokens or request bodies in fields.
import { systemClock, type Clock } from './clock';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
type Fields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: Fields): void;
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
}

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export function createLogger(
  level: LogLevel,
  opts: { clock?: Clock; write?: (line: string) => void } = {},
): Logger {
  const clock = opts.clock ?? systemClock;
  const write = opts.write ?? ((line: string) => console.log(line));
  const log = (lvl: Exclude<LogLevel, 'silent'>) => (msg: string, fields: Fields = {}) => {
    if (ORDER[lvl] < ORDER[level]) return;
    write(JSON.stringify({ level: lvl, time: clock.now().toISOString(), msg, ...fields }));
  };
  return { debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error') };
}

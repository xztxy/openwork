import { resolve } from 'node:path';

export interface DaemonArgs {
  socketPath?: string;
  dataDir?: string;
  version?: boolean;
}

export function parseArgs(argv: string[] = process.argv.slice(2)): DaemonArgs {
  const result: DaemonArgs = {};

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--socket-path' && argv[i + 1]) {
      result.socketPath = argv[i + 1];
      i++;
    } else if (argv[i] === '--data-dir' && argv[i + 1]) {
      // Always resolve to absolute path to avoid ambiguity
      result.dataDir = resolve(argv[i + 1]);
      i++;
    } else if (argv[i] === '--version') {
      result.version = true;
    }
  }

  return result;
}

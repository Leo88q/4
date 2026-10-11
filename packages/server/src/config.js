import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 8787),
  dataDir: path.resolve(process.env.DATA_DIR ?? path.join(here, '..', '..', '..', 'data')),
  /** 'mock' = hash-chained local book; 'solana' = real chain (see chain/README.md) */
  chainMode: process.env.CHAIN_MODE ?? 'mock',
  /** commit-reveal chain entropy for the daily seed (CONCEPT.md §7.4) */
  chainEntropy: process.env.CHAIN_ENTROPY ?? '',
  maxBodyBytes: 2 * 1024 * 1024,
  rateLimit: { windowMs: 60_000, maxPosts: 240 },
};

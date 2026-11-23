import type { Config } from '../../config.js';
import { LocalStorage } from './local.js';
import { R2Storage } from './r2.js';
import type { StorageService } from './types.js';

export * from './types.js';
export { LocalStorage } from './local.js';
export { R2Storage } from './r2.js';

/** R2 when its variables are set, otherwise local disk (development and tests only). */
export function createStorage(config: Config): StorageService {
  if (config.r2) return new R2Storage({ ...config.r2, buckets: config.buckets });
  return new LocalStorage(
    config.localStorageDir,
    config.secrets.storage,
    `${config.webOrigin}/api`,
  );
}

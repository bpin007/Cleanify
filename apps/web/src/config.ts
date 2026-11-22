import { DEFAULT_APP_NAME } from '@cleanify/shared';

/** Product name, renameable via VITE_APP_NAME (PROJECT.md: "kept in one config value"). */
export const APP_NAME: string = import.meta.env['VITE_APP_NAME'] || DEFAULT_APP_NAME;

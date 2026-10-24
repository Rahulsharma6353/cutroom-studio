import path from 'node:path';

/** Folders the server reads from. The backend runs with its own folder as the working directory. */
export const BACKEND_ROOT = path.resolve(process.env.BACKEND_ROOT || process.cwd());
export const SHARED_ROOT = path.resolve(BACKEND_ROOT, '../shared');
export const SHARED_SRC = path.join(SHARED_ROOT, 'src');
/** Brand marks and sound effects, served at /brand and /sfx for the renderer and the editor. */
export const ASSETS = path.join(SHARED_ROOT, 'assets');
export const SCRIPTS = path.join(BACKEND_ROOT, 'scripts');
export const MODELS = path.join(BACKEND_ROOT, 'models');

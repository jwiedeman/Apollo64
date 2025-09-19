import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const JS_ROOT = path.resolve(__dirname, '..', '..');
export const PROJECT_ROOT = path.resolve(JS_ROOT, '..');
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'docs', 'data');
export const UI_DOCS_DIR = path.resolve(PROJECT_ROOT, 'docs', 'ui');

import type { Config } from './config.js';
import type { Store } from './db/index.js';
import type { Auth } from './auth.js';
import type { Audit } from './audit.js';
import type { FileStore } from './files.js';
import type { Settings } from './settings.js';
import type { Claude } from './import/claude.js';

export interface Ctx { cfg: Config; store: Store; auth: Auth; audit: Audit; files: FileStore; settings: Settings; claude: Claude }

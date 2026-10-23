import { app } from '@wix/astro/builders';

import leadCreated from './extensions/backend/events/lead-created/lead-created.extension.ts';

export default app().use(leadCreated);
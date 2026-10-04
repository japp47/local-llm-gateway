import { Semaphore } from './semaphore.js';
import { config } from '../config.js';

export { QueueFullError } from './semaphore.js';
export const limiter = new Semaphore(config.MAX_CONCURRENCY, config.MAX_QUEUE);
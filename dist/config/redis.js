import { Redis } from "ioredis";
import { config } from "./env.js";
const redisClient = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
        return Math.min(times * 50, 2000);
    }
});
redisClient.on('connect', () => console.log('Redis client connected'));
redisClient.on('error', (error) => console.error('Redis client error:', error));

export const config = {
    PORT: parseInt(process.env.PORT, 10),
    MONGO_URI: process.env.MONGO_URI,
    REDIS_URL: process.env.REDIS_URL,
    JWT_SECRET: process.env.JWT_SECRET
};

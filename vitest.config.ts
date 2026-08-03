import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
    },
    env: {
      NODE_ENV: "test",
      TZ: "Asia/Colombo",
      MONGO_URI: "mongodb://127.0.0.1:27017/salon_test",
      REDIS_URL: "redis://127.0.0.1:6379/15",
      JWT_ACCESS_SECRET: "test_access_secret_which_is_at_least_32_bytes_long",
      JWT_REFRESH_SECRET: "test_refresh_secret_which_is_at_least_32_bytes_long",
      AUTH_ACTION_TOKEN_SECRET:
        "test_action_token_secret_which_is_at_least_32_bytes",
      CORS_ORIGIN: "http://localhost:3000",
      AUTH_COOKIE_SECURE: "false",
    },
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests must never read the real ~/.config or the gateway's real data folder
    // (which may hold a live local key). Only paths passed in explicitly are used.
    env: { HOME: '/nonexistent/llm-cli-test-home', DATA_DIR: '', XDG_DATA_HOME: '', XDG_CONFIG_HOME: '' },
  },
});

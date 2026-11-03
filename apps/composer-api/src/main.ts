// Entry point: node src/main.ts. Reads the config first, so a refused setting stops the server before
// it opens the database or listens.
import { ConfigError, loadConfig } from "./config.ts";
import { start } from "./server.ts";

try {
  start(loadConfig(process.env));
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(`composer-api refused to start: ${error.message}`);
    process.exit(1);
  }
  throw error;
}

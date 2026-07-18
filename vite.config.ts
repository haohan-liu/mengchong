import { defineConfig } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  base: "./",
  server: { host: "127.0.0.1", port: 1421, strictPort: true },
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        pet: resolve(projectRoot, "index.html"),
        console: resolve(projectRoot, "console.html"),
        chat: resolve(projectRoot, "chat.html"),
        update: resolve(projectRoot, "update.html"),
        notification: resolve(projectRoot, "notification.html")
      }
    }
  }
});

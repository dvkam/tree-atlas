import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: { watch: { ignored: ["**/.tmp/**"] } },
  plugins: [react({ compiler: true })],
});

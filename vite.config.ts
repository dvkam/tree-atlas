import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: { watch: { ignored: ["**/.tmp/**", "**/data/raw/**", "**/public/data/**"] } },
  plugins: [react({ compiler: true })],
});

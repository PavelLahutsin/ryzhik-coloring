import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "ru.lisenokryzhik.coloring",
  appName: "Раскраска с Рыжиком",
  webDir: "dist",
  // Bundled files are served by the WebView as https://localhost. That is not
  // a network request, so the app needs no INTERNET permission.
  server: { androidScheme: "https", hostname: "localhost" },
  android: { allowMixedContent: false },
};

export default config;

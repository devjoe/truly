declare module "webextension-polyfill" {
  const browser: typeof chrome;
  export default browser;
}

declare const __BROWSER__: "chrome" | "firefox";
declare const __TRULY_BUILD_ID__: string;

const {
  withAndroidStyles,
  withAndroidColors,
  withDangerousMod,
  AndroidConfig,
} = require("@expo/config-plugins");
const { readFileSync, writeFileSync } = require("fs");
const { resolve } = require("path");

function withSplashStyles(config) {
  return withAndroidStyles(config, (cfg) => {
    const styles = cfg.modResults;
    const resources = styles.resources;
    if (!resources.style) resources.style = [];
    let splashStyle = resources.style.find(
      (s) => s.$?.name === "Theme.App.SplashScreen"
    );
    if (!splashStyle) {
      splashStyle = { $: { name: "Theme.App.SplashScreen", parent: "AppTheme" }, item: [] };
      resources.style.push(splashStyle);
    }
    if (!splashStyle.item) splashStyle.item = [];
    let wb = splashStyle.item.find((i) => i.$?.name === "android:windowBackground");
    if (wb) {
      wb._ = "@color/splashscreen_background";
    } else {
      splashStyle.item.push({ $: { name: "android:windowBackground" }, _: "@color/splashscreen_background" });
    }
    return cfg;
  });
}

function withSplashColors(config) {
  const bgColor = config?.expo?.splash?.backgroundColor || "#0a0a0a";
  return withAndroidColors(config, (cfg) => {
    const colors = cfg.modResults;
    const resources = colors.resources;
    if (!resources.color) resources.color = [];
    let existing = resources.color.find((c) => c.$?.name === "splashscreen_background");
    if (existing) {
      existing._ = bgColor;
    } else {
      resources.color.push({ $: { name: "splashscreen_background" }, _: bgColor });
    }
    return cfg;
  });
}

function withIconBackground(config) {
  return withDangerousMod(config, [
    "android",
    (cfg) => {
      const bgColor = config?.expo?.splash?.backgroundColor || "#0a0a0a";
      const filePath = resolve(
        cfg.modRequest.platformProjectRoot,
        "app/src/main/res/drawable/ic_launcher_background.xml"
      );
      const content = `<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
  <item android:drawable="@color/splashscreen_background"/>
</layer-list>
`;
      writeFileSync(filePath, content);
      return cfg;
    },
  ]);
}

module.exports = function withSplashFix(config) {
  config = withSplashStyles(config);
  config = withSplashColors(config);
  config = withIconBackground(config);
  return config;
};

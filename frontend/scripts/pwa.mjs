const names = {
  all: "OncoBrief",
  patient: "OncoBrief Patient",
  doctor: "OncoBrief Doctor",
  staff: "OncoBrief Staff",
};

export function pwa(target = "all") {
  if (!Object.hasOwn(names, target)) throw new Error(`Unknown app target: ${target}`);
  const name = names[target];
  const theme = { doctor: "#246da0", staff: "#346a75" }[target] || "#087e8b";
  return {
    name: "oncobrief-installable-app",
    transformIndexHtml(html) {
      return {
        html: html.replace(/<title>.*?<\/title>/, `<title>${name}</title>`),
        tags: [
          { tag: "link", attrs: { rel: "manifest", href: "/manifest.webmanifest" }, injectTo: "head" },
          { tag: "link", attrs: { rel: "apple-touch-icon", href: "/icons/app-180.png" }, injectTo: "head" },
          { tag: "meta", attrs: { name: "theme-color", content: theme }, injectTo: "head" },
          { tag: "meta", attrs: { name: "apple-mobile-web-app-capable", content: "yes" }, injectTo: "head" },
          { tag: "meta", attrs: { name: "apple-mobile-web-app-title", content: name }, injectTo: "head" },
        ],
      };
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "manifest.webmanifest",
        source: JSON.stringify({
          id: `/${target}`,
          name,
          short_name: target === "all" ? "OncoBrief" : `OB ${target[0].toUpperCase()}${target.slice(1)}`,
          description: "Your OncoBrief care workspace. An internet connection is required.",
          start_url: target === "all" ? "/app" : "/",
          scope: "/",
          display: "standalone",
          background_color: "#f2f7f8",
          theme_color: theme,
          lang: "en-IN",
          icons: [
            { src: "/icons/app-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "/icons/app-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            { src: "/icons/app-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        }, null, 2) + "\n",
      });
    },
  };
}

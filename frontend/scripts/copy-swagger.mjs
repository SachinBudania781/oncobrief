import { createRequire } from "node:module";
import { mkdir, copyFile, writeFile } from "node:fs/promises";
import path from "node:path";
const require = createRequire(import.meta.url);
const base = path.dirname(require.resolve("swagger-ui-dist/package.json"));
const out = new URL("../public/swagger/", import.meta.url);
await mkdir(out, { recursive: true });
for (const name of ["swagger-ui-bundle.js", "swagger-ui.css", "LICENSE"])
  await copyFile(path.join(base, name), new URL(name, out));
await writeFile(
  new URL("init.js", out),
  'window.onload = function () { SwaggerUIBundle({ url: "/openapi.json", dom_id: "#swagger-ui", presets: [SwaggerUIBundle.presets.apis], layout: "BaseLayout", withCredentials: true }); };\n',
);

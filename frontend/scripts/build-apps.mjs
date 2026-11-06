import { build } from "vite";
import { cp } from "node:fs/promises";
import "./copy-swagger.mjs";

const selected = process.argv[2];
const targets = selected === "all" ? ["patient", "doctor", "staff"] : selected === "hub" ? ["all"] : [selected];
if (!["patient", "doctor", "staff", "hub", "all"].includes(selected)) {
  throw new Error("Choose patient, doctor, staff, hub, or all.");
}
for (const target of targets) {
  process.env.VITE_APP_TARGET = target;
  const outDir = selected === "hub" ? "dist/hub" : `dist/${target}`;
  await build({ build: { outDir, emptyOutDir: true } });
  await cp("memory-up", `${outDir}/memory-up`, { recursive: true, filter: (source) => !source.includes("tests") });
  await cp("memory-up", `${outDir}/memory-up-assets`, { recursive: true, filter: (source) => !source.includes("tests") });
}

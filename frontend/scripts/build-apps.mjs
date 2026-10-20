import { build } from "vite";
import "./copy-swagger.mjs";

const selected = process.argv[2];
const targets = selected === "all" ? ["patient", "doctor", "staff"] : [selected];
if (targets.some((target) => !["patient", "doctor", "staff"].includes(target))) {
  throw new Error("Choose patient, doctor, staff, or all.");
}
for (const target of targets) {
  process.env.VITE_APP_TARGET = target;
  await build({ build: { outDir: `dist/${target}`, emptyOutDir: true } });
}

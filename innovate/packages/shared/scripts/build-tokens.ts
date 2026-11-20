import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderTokensCss } from "../src/tokens";

const out = fileURLToPath(new URL("../tokens.css", import.meta.url));
writeFileSync(out, renderTokensCss());
console.log(`wrote ${out}`);

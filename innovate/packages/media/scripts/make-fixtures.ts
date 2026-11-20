import { ensureFixtures } from "../src/fixtures";

const force = process.argv.includes("--force");
const dir = await ensureFixtures({ force, log: (m) => console.log(m) });
console.log(`fixtures ready in ${dir}`);

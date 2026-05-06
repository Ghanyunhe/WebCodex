import { readdir } from "node:fs/promises";
const testDir = new URL(".", import.meta.url);
const files = (await readdir(testDir))
  .filter((file) => file.endsWith(".test.js"))
  .sort();

for (const file of files) {
  await import(new URL(file, testDir).href);
}

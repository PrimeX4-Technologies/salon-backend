import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { openApiDocument } from "../docs/openapi.js";

const requestedPath = process.argv[2]?.trim() || "openapi.json";
const outputPath = resolve(process.cwd(), requestedPath);

await writeFile(outputPath, `${JSON.stringify(openApiDocument, null, 2)}\n`, {
  encoding: "utf8",
  flag: "w",
});

console.info(`OpenAPI document exported to ${outputPath}`);

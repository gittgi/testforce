import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import { PlanSchema, DraftSchema } from "../src/core/model.js";
import { OfflineFixtureSchema } from "../src/cli/fake-config.js";
await mkdir("docs/schemas", { recursive: true });
for (const [name, schema] of Object.entries({
  plan: PlanSchema,
  draft: DraftSchema,
  fixture: OfflineFixtureSchema,
}))
  await writeFile(
    `docs/schemas/${name}.schema.json`,
    JSON.stringify(z.toJSONSchema(schema), null, 2) + "\n",
  );

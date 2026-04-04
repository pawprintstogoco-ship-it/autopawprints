import { spawnSync } from "node:child_process";

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const shouldGeneratePrisma = process.env.SKIP_PRISMA_GENERATE !== "true";
const shouldPushSchema = process.env.SKIP_DB_PUSH !== "true";

if (shouldGeneratePrisma) {
  run("npx", ["prisma", "generate"]);
}

if (shouldPushSchema) {
  run("npx", ["prisma", "db", "push"]);
}

run("next", ["build"]);

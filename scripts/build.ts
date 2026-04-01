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

if (process.env.SKIP_PRISMA_GENERATE !== "true") {
  run("npx", ["prisma", "generate"]);
}

if (process.env.SKIP_DB_PUSH !== "true") {
  run("npx", ["prisma", "db", "push"]);
}

run("next", ["build"]);

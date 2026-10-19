// Node-only side-effect module: refuses to start a production server on a bad environment.
import { bootWarnings, envProblems } from "./env";

if (process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build") {
  const problems = envProblems(process.env);
  if (problems.length) {
    console.error(`Invalid environment:\n- ${problems.join("\n- ")}`);
    // A throw in register() is only logged by `next start`, which then keeps serving 500s.
    process.exit(1);
  }
  for (const warning of bootWarnings(process.env)) console.warn(warning);
}

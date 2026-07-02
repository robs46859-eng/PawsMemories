import { finalizeNode } from "./agent/graph/nodes/finalize";

async function main() {
  const state: any = {
    buildPlan: [],
    checkpoints: [],
    riggedGlbBase64: "Z2xURgIAAAB8zIAATM8AAEpTT057ImFzc2V0Ijp7ImdlbmVyYXRvciI6Iktocm9ub3MgZ2xURiBCbGVuZGVyIEkvTyB2NS4xLjIw"
  };
  const result = await finalizeNode(state);
  console.log("RESULT:", result.riggedGlbBase64.substring(0, 100));
}
main();

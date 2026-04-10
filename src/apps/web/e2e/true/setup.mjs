import { setupTrueE2E } from "./support/admin.mjs";

export default async function globalSetup() {
  const state = await setupTrueE2E();
  console.log(`Prepared true E2E state for hub ${state.hubId} (${state.hubName}).`);
}

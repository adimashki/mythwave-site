// Platform-neutral settings shared by the Node server and the on-device build.
const env = globalThis.process?.env ?? {};

export const settings = {
  sessionTtlMs: 1000 * 60 * 60 * 24 * 14,
  pointsPerDonation: Number(env.CRUOR_POINTS_PER_DONATION || 100),
  slotMinutes: 30,
  slotCapacity: 4,
  // General screening guidance only. Center staff always make the final call.
  eligibility: {
    minAge: 17,
    maxAge: 65,
    minWeightKg: 50,
    wholeBloodIntervalDays: 56,
  },
};

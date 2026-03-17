export const DEFAULT_DRAGON_CONFIG = {
  lobbyMs: 10000,
  speedFactor: 0.35,
  luckyChancePercent: 5,
  luckyCrashPerThousand: 1,
  lowCapMultiplier: 1.15,
  lowCrashPerThousand: 20,
  midCapMultiplier: 3,
  midCrashPerThousand: 7,
  highCapMultiplier: 10,
  highCrashPerThousand: 5,
  ultraCrashPerThousand: 3,
  testMode: false,
  testMaxMultiplier: 1.1
};

export function normalizeDragonConfig(config) {
  const next = config || {};
  const luckyChancePercent = Math.min(100, Math.max(0, Math.round(Number(next.luckyChancePercent ?? DEFAULT_DRAGON_CONFIG.luckyChancePercent))));
  const luckyCrashPerThousand = Math.min(999, Math.max(1, Math.round(Number(next.luckyCrashPerThousand ?? DEFAULT_DRAGON_CONFIG.luckyCrashPerThousand))));
  const lowCapMultiplier = Math.max(1.01, Math.round(Number(next.lowCapMultiplier ?? DEFAULT_DRAGON_CONFIG.lowCapMultiplier) * 100) / 100);
  const midCapMultiplier = Math.max(lowCapMultiplier + 0.01, Math.round(Number(next.midCapMultiplier ?? DEFAULT_DRAGON_CONFIG.midCapMultiplier) * 100) / 100);
  const highCapMultiplier = Math.max(midCapMultiplier + 0.01, Math.round(Number(next.highCapMultiplier ?? DEFAULT_DRAGON_CONFIG.highCapMultiplier) * 100) / 100);

  return {
    lobbyMs: Math.min(60000, Math.max(1000, Math.round(Number(next.lobbyMs ?? DEFAULT_DRAGON_CONFIG.lobbyMs)))),
    speedFactor: Math.min(5, Math.max(0.1, Math.round(Number(next.speedFactor ?? DEFAULT_DRAGON_CONFIG.speedFactor) * 100) / 100)),
    luckyChancePercent,
    luckyCrashPerThousand,
    lowCapMultiplier,
    lowCrashPerThousand: Math.min(999, Math.max(1, Math.round(Number(next.lowCrashPerThousand ?? DEFAULT_DRAGON_CONFIG.lowCrashPerThousand)))),
    midCapMultiplier,
    midCrashPerThousand: Math.min(999, Math.max(1, Math.round(Number(next.midCrashPerThousand ?? DEFAULT_DRAGON_CONFIG.midCrashPerThousand)))),
    highCapMultiplier,
    highCrashPerThousand: Math.min(999, Math.max(1, Math.round(Number(next.highCrashPerThousand ?? DEFAULT_DRAGON_CONFIG.highCrashPerThousand)))),
    ultraCrashPerThousand: Math.min(999, Math.max(1, Math.round(Number(next.ultraCrashPerThousand ?? DEFAULT_DRAGON_CONFIG.ultraCrashPerThousand)))),
    testMode: Boolean(next.testMode),
    testMaxMultiplier: Math.min(10, Math.max(1.1, Math.round(Number(next.testMaxMultiplier ?? DEFAULT_DRAGON_CONFIG.testMaxMultiplier) * 100) / 100))
  };
}

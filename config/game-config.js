// ─────────────────────────────────────────────────────────────────────
// 31check Oyun Konfigürasyonu
// ─────────────────────────────────────────────────────────────────────
// Bu dosyayı düzenleyerek oyun parametrelerini değiştirebilirsin.
// Değişiklik sonrası commit + deploy yeterli.
// ─────────────────────────────────────────────────────────────────────

/**
 * 🐉 EJDERHA (Dragon) Ayarları
 * Crash-game mekanikteki olasılık ve hız parametreleri.
 * Yeni turlar bu ayarlarla başlar.
 */
export const DRAGON_CONFIG = {
  // Tur başlamadan önceki bekleme süresi (milisaniye)
  lobbyMs: 8000,

  // X çarpanının artış hızı (0.10 - 5.00 arası)
  speedFactor: 0.35,

  // Şanslı tur tetiklenme olasılığı (% olarak, 0-100)
  luckyChancePercent: 8,

  // Şanslı turda her 0.01x adımında patlama olasılığı (binde, 1-999)
  luckyCrashPerThousand: 3,

  // ── Normal dağılım bantları ──
  // İlk eşik X değeri ve o banta kadar patlama olasılığı
  lowCapMultiplier: 1.8,
  lowCrashPerThousand: 35,

  // İkinci eşik X değeri ve o banta kadar patlama olasılığı
  midCapMultiplier: 3.5,
  midCrashPerThousand: 22,

  // Üçüncü eşik X değeri ve o banta kadar patlama olasılığı
  highCapMultiplier: 8.0,
  highCrashPerThousand: 15,

  // Son bant (üçüncü eşikten sonra) patlama olasılığı
  ultraCrashPerThousand: 10,

  // ── Test modu ──
  // true ise yeni turlar sadece testMaxMultiplier üzeri crash yapar
  testMode: false,
  testMaxMultiplier: 2.0
};

/**
 * ⛏️ MADEN (Mining) Ayarları
 * Maden kazma oyununun temel parametreleri.
 */
export const MINING_CONFIG = {
  // Cevher sertliği (kırılmak için gereken vuruş sayısı)
  oreHardness: {
    stone: 2,
    coal: 3,
    copper: 4,
    iron: 5,
    amber: 6,
    sapphire: 8,
    ruby: 10,
    starsteel: 14
  },

  // Köstebek hasar aralığı
  moleDamageMin: 5,
  moleDamageMax: 15,

  // Oyuncu maksimum can puanı
  playerMaxIntegrity: 100,

  // Sis perdesi (FOW) yarıçapları
  spawnRevealRadius: 5,   // Doğuş noktasında açılan alan
  mineRevealRadius: 1,    // Kazma ile açılan alan
  moveRevealRadius: 1,    // Yürürken açılan alan

  // Hız parametreleri
  baseSpeed: 4.0,         // Temel hareket hızı
  minSpeed: 1.5,          // Minimum hareket hızı (ağırlıkla düşer)

  // Ağırlık ve kazma hızı faktörleri
  weightFactor: 12,       // Ağırlık hesaplama böleni
  cooldownFactor: 1.0     // Kazma hızı çarpanı
};

/**
 * 🃏 BLACKJACK Ayarları
 * (Şu an placeholder — ileride masa kuralları ve bahis limitleri eklenecek)
 */
export const BLACKJACK_CONFIG = {
  // İleride: deckCount, maxBet, dealerStandsOnSoft17 vb.
};

/**
 * 💣 MINES Ayarları
 * (Şu an placeholder — ileride oran ve oyun limitleri eklenecek)
 */
export const MINES_CONFIG = {
  // İleride: defaultMineCount, maxMineCount, baseStake vb.
};

/**
 * Tüm oyun konfigürasyonlarını tek objede toplar.
 * app.js bu objeyi import ederek kullanır.
 */
export const GAME_CONFIG = {
  dragon: DRAGON_CONFIG,
  mining: MINING_CONFIG,
  blackjack: BLACKJACK_CONFIG,
  mines: MINES_CONFIG
};

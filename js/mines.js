import { state } from "./state.js";
import { cloneData, uid, shuffle, formatMultiplier, formatCoinValue, roundCoinValue } from "./utils.js";
import { MINES_GRID_SIZE, MINES_MINE_COUNT, MINES_BASE_STAKE, MINES_MINE_OPTIONS } from "./constants.js";

// ── Oyun Mantığı ───────────────────────────────────────────────────

export function createMinesGameState(mineCount = state.preferredMineCount) {
  const cells = Array.from({ length: MINES_GRID_SIZE }, (_, index) => ({
    id: uid(),
    index,
    isMine: false,
    revealed: false
  }));

  const safeMineCount = MINES_MINE_OPTIONS.includes(Number(mineCount)) ? Number(mineCount) : MINES_MINE_COUNT;
  const mineIndexes = shuffle(Array.from({ length: MINES_GRID_SIZE }, (_, index) => index)).slice(0, safeMineCount);
  for (const mineIndex of mineIndexes) {
    cells[mineIndex].isMine = true;
  }

  return normalizeMinesState({
    game: "mines",
    ownerId: state.currentUser.id,
    ownerName: state.currentUser.displayName,
    revision: 1,
    status: "playing",
    baseStake: MINES_BASE_STAKE,
    mineCount: safeMineCount,
    revealedSafeCount: 0,
    multiplier: 1,
    collectible: MINES_BASE_STAKE,
    resultSummary: "",
    cells
  });
}

export function normalizeMinesState(content) {
  const game = typeof content === "string" ? JSON.parse(content) : cloneData(content);
  game.game ||= "mines";
  game.ownerId ||= state.currentUser.id;
  game.ownerName ||= state.currentUser.displayName;
  game.revision = Number(game.revision) > 0 ? Number(game.revision) : 1;
  game.status ||= "playing";
  game.baseStake = Number(game.baseStake) > 0 ? Number(game.baseStake) : MINES_BASE_STAKE;
  game.mineCount = Number(game.mineCount) > 0 ? Number(game.mineCount) : MINES_MINE_COUNT;
  game.cells = Array.isArray(game.cells) ? game.cells : [];
  game.revealedSafeCount = Number(game.revealedSafeCount) >= 0 ? Number(game.revealedSafeCount) : countRevealedMinesSafeCells(game.cells);
  game.multiplier = Number(game.multiplier) > 0 ? Number(game.multiplier) : calculateMinesMultiplier(game.revealedSafeCount, game.mineCount, game.cells.length || MINES_GRID_SIZE);
  game.collectible = Number(game.collectible) > 0 ? Number(game.collectible) : Math.round(game.baseStake * game.multiplier);
  game.detonatedCellIndex = Number.isInteger(Number(game.detonatedCellIndex)) ? Number(game.detonatedCellIndex) : -1;
  game.cells = game.cells.map((cell, index) => ({
    ...cell,
    detonatedAtIndex: Number.isInteger(Number(cell?.detonatedAtIndex)) ? Number(cell.detonatedAtIndex) : (index === game.detonatedCellIndex ? index : -1)
  }));
  game.resultSummary ||= "";
  return game;
}

export function revealMinesCell(gameState, cellIndex) {
  const game = normalizeMinesState(gameState);
  if (game.status !== "playing") return null;
  const cell = game.cells[cellIndex];
  if (!cell || cell.revealed) return null;

  game.revision += 1;
  cell.revealed = true;

  if (cell.isMine) {
    game.status = "lost";
    game.detonatedCellIndex = cellIndex;
    cell.detonatedAtIndex = cellIndex;
    game.resultSummary = "KAYBETTIN ☠️";
    revealAllMines(game.cells);
    return game;
  }

  game.revealedSafeCount += 1;
  game.multiplier = calculateMinesMultiplier(game.revealedSafeCount, game.mineCount, game.cells.length || MINES_GRID_SIZE);
  game.collectible = roundCoinValue(game.baseStake * game.multiplier);

  const safeCells = (game.cells.length || MINES_GRID_SIZE) - game.mineCount;
  if (game.revealedSafeCount >= safeCells) {
    game.status = "won";
    game.resultSummary = "KAZANDIN 👑";
    revealAllMines(game.cells);
  }

  return game;
}

export function collectMinesWinnings(gameState) {
  const game = normalizeMinesState(gameState);
  game.revision += 1;
  game.status = "cashed_out";
  game.resultSummary = "KAZANDIN 👑";
  revealAllMines(game.cells);
  return game;
}

// ── Matematik & Yardımcılar ────────────────────────────────────────

export function calculateMinesMultiplier(revealedSafeCount, mineCount, totalCells = MINES_GRID_SIZE) {
  const safeCells = totalCells - mineCount;
  if (revealedSafeCount <= 0) return 1;

  let multiplier = 1;
  for (let index = 0; index < revealedSafeCount; index += 1) {
    multiplier *= (totalCells - index) / (safeCells - index);
  }
  return multiplier;
}

export function countRevealedMinesSafeCells(cells) {
  return (cells || []).filter((cell) => cell.revealed && !cell.isMine).length;
}

export function revealAllMines(cells) {
  for (const cell of cells || []) {
    if (cell.isMine) {
      cell.revealed = true;
    }
  }
}

export function getNextMinesMultipliers(game) {
  const totalCells = game.cells.length || MINES_GRID_SIZE;
  const safeCells = totalCells - game.mineCount;
  const values = [game.multiplier];
  for (let step = game.revealedSafeCount + 1; step <= Math.min(safeCells, game.revealedSafeCount + 4); step += 1) {
    values.push(calculateMinesMultiplier(step, game.mineCount, totalCells));
  }
  return values;
}

export function getMinesStats(game) {
  return {
    collectable: game.collectible,
    multiplier: game.multiplier
  };
}

export function renderMinesTitle(game) {
  if (game.status === "lost") return "KAYBETTIN ☠️";
  if (game.status === "won" || game.status === "cashed_out") return "KAZANDIN 👑";
  return "";
}

export function getMinesResultTone(status) {
  if (status === "lost") return "loss";
  if (status === "won" || status === "cashed_out") return "win";
  return "";
}

// ── App.js Etkileşimi (Opsiyonel helper'lar) ──────────────────────

export function findActiveMinesMessageForCurrentUser(messages, currentUserId) {
  // Finds the most recent active mines game for the given user
  const games = Array.from(messages)
    .reverse()
    .filter(m => m.type === "mines")
    .map(m => normalizeMinesState(m.content));

  return games.find(g => g.ownerId === currentUserId && g.status === "playing");
}

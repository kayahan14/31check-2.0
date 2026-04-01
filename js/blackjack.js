import { state } from "./state.js";
import { uid, cloneData, cssEscape } from "./utils.js";
import { BLACKJACK_SUITS, BLACKJACK_RANKS } from "./constants.js";

// ── Oyun Döngüsü ────────────────────────────────────────────────────

export function createBlackjackGameState() {
  const deck = createShuffledDeck(6);
  const hands = [
    createBlackjackHand([drawVisibleCard(deck), drawVisibleCard(deck)])
  ];
  const dealer = {
    cards: [drawVisibleCard(deck), drawHiddenCard(deck)],
    resultLabel: ""
  };

  const game = {
    game: "blackjack",
    ownerId: state.currentUser.id,
    ownerName: state.currentUser.displayName,
    revision: 1,
    status: "playing",
    summary: `${state.currentUser.displayName} blackjack oynuyor`,
    resultSummary: "",
    deck,
    dealer,
    hands,
    activeHandIndex: 0
  };

  resolveInitialBlackjack(game);
  return game;
}

export function normalizeBlackjackState(content) {
  const game = typeof content === "string" ? JSON.parse(content) : cloneData(content);
  game.deck ||= [];
  game.hands ||= [];
  game.dealer ||= { cards: [] };
  game.status ||= "playing";
  game.revision = Number(game.revision) > 0 ? Number(game.revision) : 1;
  game.summary ||= `${game.ownerName || "Oyuncu"} blackjack oynuyor`;
  game.resultSummary ||= "";
  return game;
}

export function applyBlackjackAction(gameState, action) {
  const game = cloneData(gameState);
  game.revision = Number(game.revision || 1) + 1;
  const hand = game.hands[game.activeHandIndex];
  if (!hand) return null;

  const actions = getBlackjackActions(game, hand);
  if (!actions[action]) return null;

  if (action === "hit") {
    hand.cards.push(drawVisibleCard(game.deck));
    if (hand.isSplitAces || calculateHandTotals(hand.cards).best >= 21) {
      finalizePlayerHand(game, hand, calculateHandTotals(hand.cards).best > 21 ? "Bust" : "Bekliyor");
      return advanceBlackjackTurn(game);
    }
  }

  if (action === "stand") {
    finalizePlayerHand(game, hand, "Stand");
    return advanceBlackjackTurn(game);
  }

  if (action === "double") {
    hand.doubled = true;
    hand.cards.push(drawVisibleCard(game.deck));
    finalizePlayerHand(game, hand, calculateHandTotals(hand.cards).best > 21 ? "Bust" : "Double");
    return advanceBlackjackTurn(game);
  }

  if (action === "split") {
    splitBlackjackHand(game, game.activeHandIndex);
    return advanceBlackjackTurn(game, true);
  }

  game.summary = `${game.ownerName} blackjack oynuyor`;
  return game;
}

export function advanceBlackjackTurn(game, afterSplit = false) {
  if (afterSplit) {
    const activeHand = game.hands[game.activeHandIndex];
    if (activeHand?.isSplitAces && activeHand.completed) {
      return advanceBlackjackTurn(game, false);
    }
    game.summary = `${game.ownerName} el ${game.activeHandIndex + 1} icin karar veriyor`;
    return game;
  }

  while (game.activeHandIndex < game.hands.length && game.hands[game.activeHandIndex].completed) {
    game.activeHandIndex += 1;
  }

  if (game.activeHandIndex >= game.hands.length) {
    resolveDealerAndOutcome(game);
    return game;
  }

  game.summary = `${game.ownerName} el ${game.activeHandIndex + 1} icin karar veriyor`;
  return game;
}

export function splitBlackjackHand(game, handIndex) {
  const hand = game.hands[handIndex];
  const [leftCard, rightCard] = hand.cards;
  const splitAces = leftCard.rank === "A" && rightCard.rank === "A";

  const leftHand = createBlackjackHand([leftCard, drawVisibleCard(game.deck)], {
    isSplitHand: true,
    isSplitAces: splitAces
  });
  const rightHand = createBlackjackHand([rightCard, drawVisibleCard(game.deck)], {
    isSplitHand: true,
    isSplitAces: splitAces
  });

  if (splitAces) {
    finalizePlayerHand(leftHand, leftHand, "Split As");
    finalizePlayerHand(rightHand, rightHand, "Split As");
  }

  game.hands.splice(handIndex, 1, leftHand, rightHand);
}

export function resolveInitialBlackjack(game) {
  const playerHand = game.hands[0];
  const playerBlackjack = isNaturalBlackjack(playerHand);
  const dealerBlackjack = isNaturalBlackjack({
    cards: game.dealer.cards.map((card) => ({ ...card, hidden: false })),
    isSplitHand: false,
    isSplitAces: false
  });

  if (!playerBlackjack && !dealerBlackjack) {
    game.summary = `${game.ownerName} blackjack oynuyor`;
    return;
  }

  revealDealerCards(game.dealer.cards);
  if (playerBlackjack && dealerBlackjack) {
    playerHand.completed = true;
    playerHand.resultLabel = "Push";
    game.dealer.resultLabel = "Blackjack";
    game.status = "finished";
    game.resultSummary = "Push: iki taraf da blackjack yapti.";
    game.summary = `${game.ownerName} push yapti`;
    return;
  }

  if (playerBlackjack) {
    playerHand.completed = true;
    playerHand.resultLabel = "Blackjack";
    game.status = "finished";
    game.resultSummary = `${game.ownerName} natural blackjack yapti.`;
    game.summary = `${game.ownerName} blackjack yapti`;
    return;
  }

  playerHand.completed = true;
  playerHand.resultLabel = "Kayip";
  game.dealer.resultLabel = "Blackjack";
  game.status = "finished";
  game.resultSummary = "Kasa blackjack yapti.";
  game.summary = `${game.ownerName} kaybetti`;
}

export function resolveDealerAndOutcome(game) {
  revealDealerCards(game.dealer.cards);
  if (game.hands.every((hand) => calculateHandTotals(hand.cards).best > 21)) {
    game.dealer.resultLabel = `Toplam ${calculateHandTotals(game.dealer.cards).best}`;
    for (const hand of game.hands) {
      hand.resultLabel = "Kayip";
      hand.completed = true;
    }
    game.status = "finished";
    game.resultSummary = summarizeBlackjackOutcome(game);
    game.summary = `${game.ownerName} blackjack elini bitirdi`;
    return;
  }

  while (shouldDealerHit(game.dealer.cards)) {
    game.dealer.cards.push(drawVisibleCard(game.deck));
  }

  const dealerTotals = calculateHandTotals(game.dealer.cards);
  game.dealer.resultLabel = dealerTotals.best > 21 ? "Bust" : `Toplam ${dealerTotals.best}`;

  for (const hand of game.hands) {
    resolveBlackjackHandOutcome(hand, game.dealer.cards);
  }

  game.status = "finished";
  game.resultSummary = summarizeBlackjackOutcome(game);
  game.summary = `${game.ownerName} blackjack elini bitirdi`;
}

export function resolveBlackjackHandOutcome(hand, dealerCards) {
  const handTotals = calculateHandTotals(hand.cards);
  const dealerTotals = calculateHandTotals(dealerCards);
  const dealerBlackjack = isNaturalBlackjack({ cards: dealerCards, isSplitHand: false, isSplitAces: false });
  const playerBlackjack = isNaturalBlackjack(hand);

  hand.completed = true;
  if (handTotals.best > 21) {
    hand.resultLabel = "Bust";
    return;
  }

  if (playerBlackjack && !dealerBlackjack) {
    hand.resultLabel = "Blackjack";
    return;
  }

  if (dealerBlackjack && !playerBlackjack) {
    hand.resultLabel = "Kayip";
    return;
  }

  if (dealerTotals.best > 21) {
    hand.resultLabel = "Kazandi";
    return;
  }

  if (handTotals.best > dealerTotals.best) {
    hand.resultLabel = "Kazandi";
    return;
  }

  if (handTotals.best < dealerTotals.best) {
    hand.resultLabel = "Kayip";
    return;
  }

  hand.resultLabel = "Push";
}

export function summarizeBlackjackOutcome(game) {
  return game.hands.map((hand, index) => {
    const label = game.hands.length > 1 ? `El ${index + 1}` : "El";
    return `${label}: ${formatBlackjackResultLabel(hand.resultLabel)}`;
  }).join(" • ");
}

export function getBlackjackActions(game, hand) {
  const playing = game.status === "playing" && hand && !hand.completed;
  const totals = hand ? calculateHandTotals(hand.cards) : { best: 0 };
  const canAct = playing && totals.best < 21;

  return {
    hit: Boolean(canAct && !hand.isSplitAces),
    stand: Boolean(playing),
    double: Boolean(canAct && hand.cards.length === 2 && !hand.doubled && !hand.isSplitAces),
    split: Boolean(
      playing
      && hand.cards.length === 2
      && game.hands.length < 4
      && getSplitValue(hand.cards[0]) === getSplitValue(hand.cards[1])
    )
  };
}

export function calculateHandTotals(cards) {
  let total = 0;
  let aces = 0;

  for (const card of cards) {
    if (card.hidden) continue;
    if (card.rank === "A") {
      aces += 1;
      total += 11;
      continue;
    }

    if (["K", "Q", "J"].includes(card.rank)) {
      total += 10;
      continue;
    }

    total += Number(card.rank);
  }

  let best = total;
  while (best > 21 && aces > 0) {
    best -= 10;
    aces -= 1;
  }

  return {
    best,
    soft: aces > 0
  };
}

export function isNaturalBlackjack(hand) {
  if (!hand || hand.isSplitHand || hand.isSplitAces || hand.cards.length !== 2) return false;
  return calculateHandTotals(hand.cards).best === 21;
}

export function shouldDealerHit(cards) {
  const totals = calculateHandTotals(cards);
  if (totals.best < 17) return true;
  return false;
}

export function createBlackjackHand(cards, extra = {}) {
  return {
    id: uid(),
    cards,
    completed: false,
    doubled: false,
    resultLabel: "",
    isSplitHand: false,
    isSplitAces: false,
    ...extra
  };
}

export function finalizePlayerHand(gameOrHand, handMaybe, label) {
  const hand = handMaybe || gameOrHand;
  hand.completed = true;
  hand.resultLabel = label;
}

// ── Deste İşlemleri ──────────────────────────────────────────────────

export function createShuffledDeck(deckCount = 6) {
  const deck = [];
  for (let deckIndex = 0; deckIndex < deckCount; deckIndex += 1) {
    for (const suit of BLACKJACK_SUITS) {
      for (const rank of BLACKJACK_RANKS) {
        deck.push({
          id: uid(),
          rank,
          suit: suit.key,
          hidden: false
        });
      }
    }
  }

  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]];
  }

  return deck;
}

export function drawVisibleCard(deck) {
  const card = deck.shift();
  return { ...card, hidden: false };
}

export function drawHiddenCard(deck) {
  const card = deck.shift();
  return { ...card, hidden: true };
}

export function revealDealerCards(cards) {
  cards.forEach((card) => {
    card.hidden = false;
  });
}

export function renderDealerTotal(game) {
  if (game.status !== "finished" && game.dealer.cards.some((card) => card.hidden)) {
    return "Toplam: ?";
  }

  return `Toplam: ${calculateHandTotals(game.dealer.cards).best}`;
}

// ── Sunum & Animasyon ───────────────────────────────────────────────

export function decorateBlackjackSummary(summary) {
  return String(summary || "")
    .replaceAll("Kayip", "KAYBETTIN ☠️")
    .replaceAll("Kazandi", "KAZANDIN 👑");
}

export function formatBlackjackResultLabel(label) {
  if (label === "Kayip") return "KAYBETTIN ☠️";
  if (label === "Kazandi") return "KAZANDIN 👑";
  return label || "";
}

export function renderBlackjackResultTitle(label) {
  const value = String(label || "").toLocaleLowerCase();
  if (value.includes("kazandi") || value.includes("blackjack")) return "KAZANDIN 👑";
  if (value.includes("kayip") || value.includes("bust")) return "KAYBETTIN ☠️";
  if (value.includes("push")) return "PUSH";
  return "";
}

export function getBlackjackResultTone(label) {
  const value = String(label || "").toLocaleLowerCase();
  if (value.includes("kayip") || value.includes("bust")) return "loss";
  if (value.includes("kazandi") || value.includes("blackjack")) return "win";
  if (value.includes("push")) return "push";
  return "";
}

export function getSplitValue(card) {
  if (!card) return "";
  if (card.rank === "A") return "A";
  if (["10", "J", "Q", "K"].includes(card.rank)) return "10";
  return card.rank;
}

export function collectGameAnimationKeys(previousByChannel, nextByChannel) {
  const keys = [];
  for (const [channelId, messages] of Object.entries(nextByChannel || {})) {
    const previousMessages = previousByChannel?.[channelId] || [];
    for (const message of messages) {
      if (message.type !== "blackjack") continue;
      const previousMessage = previousMessages.find((entry) => entry.id === message.id);
      keys.push(...collectBlackjackCardChanges(previousMessage, message));
    }
  }
  return [...new Set(keys)];
}

export function collectBlackjackCardChanges(previousMessage, nextMessage) {
  if (!nextMessage || nextMessage.type !== "blackjack") return [];

  const previousCards = flattenBlackjackCards(previousMessage?.content);
  const nextCards = flattenBlackjackCards(nextMessage.content);
  const previousMap = new Map(previousCards.map((card) => [card.id, card]));
  const keys = [];

  for (const card of nextCards) {
    const previousCard = previousMap.get(card.id);
    if (!previousCard || previousCard.hidden !== card.hidden) {
      keys.push(`${nextMessage.id}:${card.id}`);
    }
  }

  return keys;
}

export function getAllBlackjackCardKeys(message) {
  if (!message || message.type !== "blackjack") return [];
  return flattenBlackjackCards(message.content).map((card) => `${message.id}:${card.id}`);
}

export function flattenBlackjackCards(content) {
  const game = typeof content === "string" ? JSON.parse(content) : (content || {});
  const dealerCards = game.dealer?.cards || [];
  const handCards = (game.hands || []).flatMap((hand) => hand.cards || []);
  return [...dealerCards, ...handCards];
}

export function markAnimatingCards(keys) {
  if (!keys.length) return;
  state.animatingCardKeys = [...new Set([...state.animatingCardKeys, ...keys])];
  window.setTimeout(() => {
    state.animatingCardKeys = state.animatingCardKeys.filter((key) => !keys.includes(key));
    for (const key of keys) {
      const [, cardId] = key.split(":");
      const card = document.querySelector(`[data-card-id="${cssEscape(cardId)}"]`);
      if (card) {
        card.classList.remove("flip-in");
      }
    }
  }, 550);
}

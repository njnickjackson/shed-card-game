/* ════════════════════════════════════════════════════════════════════════════
   SHED – Card Game
   Single-device, human vs CPU(s)
   ════════════════════════════════════════════════════════════════════════════ */

'use strict';

// ── Constants ────────────────────────────────────────────────────────────────

const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'];
const SUIT_SYMBOL = { clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' };
const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];

// Numeric value for comparison (2 is wild/lowest, Ace is highest for play)
const RANK_VALUE = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
  '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
  'JOKER': 15 // handled specially – never compared
};

// For first-player determination: 3 is the lowest non-wild
// Suit order: clubs < spades < diamonds < hearts  (alpha: c < s for black; d < h for red)
// Actually rules say alphabetical among same color. Black: clubs < spades. Red: diamonds < hearts.
// Combined order for tiebreaking: clubs, spades, diamonds, hearts
const SUIT_ORDER = { clubs: 0, spades: 1, diamonds: 2, hearts: 3 };

const CPU_DELAY = 900; // ms between CPU actions

// ── State ────────────────────────────────────────────────────────────────────

let G = {}; // game state

// ── Deck ─────────────────────────────────────────────────────────────────────

function buildDeck(includeJokers) {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit, id: `${rank}_${suit}` });
    }
  }
  if (includeJokers) {
    deck.push({ rank: 'JOKER', suit: 'joker', id: 'JOKER_1' });
    deck.push({ rank: 'JOKER', suit: 'joker', id: 'JOKER_2' });
  }
  return deck;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── Card helpers ─────────────────────────────────────────────────────────────

function cardValue(card) {
  return RANK_VALUE[card.rank] ?? 0;
}

function isSpecial(card, type) {
  return card.rank === type;
}

function isWild(card) {
  return card.rank === '2' || card.rank === '10';
}

function isJoker(card) {
  return card.rank === 'JOKER';
}

// Effective top of pile for comparison purposes.
// Jokers are invisible – look through them. 10s burned immediately so never "top".
// Returns the card we need to beat (or null if pile empty / all jokers).
function effectiveTopCard() {
  // Walk pile from top down, skipping jokers
  for (let i = G.pile.length - 1; i >= 0; i--) {
    if (!isJoker(G.pile[i])) return G.pile[i];
  }
  return null;
}

// Can `card` be played given current pile?
function canPlay(card) {
  if (isJoker(card)) return true; // joker always playable
  if (isWild(card)) return true;  // 2 and 10 always playable

  const top = effectiveTopCard();
  if (!top) return true; // pile empty

  if (isWild(top) || top.rank === '10') return true; // wild on pile = anything goes (10 burns but just in case)

  if (top.rank === '7') {
    // must play 7 or lower (but 2 already handled above as wild)
    return cardValue(card) <= 7;
  }

  return cardValue(card) >= cardValue(top);
}

// Can a set of same-rank cards be played?
function canPlaySet(cards) {
  if (cards.length === 0) return false;
  // All same rank required (enforced by selection logic)
  return canPlay(cards[0]);
}

// Returns the rank if the player may play all hand cards + matching face-up cards together.
// Conditions: draw pile empty, all hand cards share the same playable rank,
// and at least one face-up table card has that same rank.
function getMixedPlayRank(player) {
  if (G.drawPile.length > 0) return null;
  if (player.hand.length === 0) return null;
  const rank = player.hand[0].rank;
  if (!player.hand.every(c => c.rank === rank)) return null;
  if (!canPlay(player.hand[0])) return null;
  if (!player.faceUp.some(c => c && c.rank === rank)) return null;
  return rank;
}

// ── Player factory ───────────────────────────────────────────────────────────

function makePlayer(id, name, isHuman) {
  return {
    id,
    name,
    isHuman,
    hand: [],
    faceUp: [],    // array of cards (length = tableCount)
    faceDown: [],  // array of cards (some may be null = already played)
    out: false,    // finished
  };
}

// ── Deal ─────────────────────────────────────────────────────────────────────

function dealGame(numPlayers) {
  const includeJokers = numPlayers === 6;
  const deck = shuffle(buildDeck(includeJokers));
  const tableCount = numPlayers === 2 ? 4 : 3;

  G.players.forEach(p => {
    // Deal facedown table cards
    for (let i = 0; i < tableCount; i++) {
      p.faceDown.push(deck.pop());
    }
  });

  // Deal faceup table cards (on top of facedown)
  // CPU players get their faceup cards automatically; human player chooses theirs during setup
  G.players.forEach(p => {
    for (let i = 0; i < tableCount; i++) {
      if (p.isHuman) {
        p.hand.push(deck.pop()); // held in hand until player chooses placement
      } else {
        p.faceUp.push(deck.pop());
      }
    }
  });

  // Deal 3 hand cards each
  G.players.forEach(p => {
    for (let i = 0; i < 3; i++) {
      p.hand.push(deck.pop());
    }
  });

  G.drawPile = deck;
}

// ── First player determination ───────────────────────────────────────────────

function determineFirstPlayer() {
  // Find who has the lowest non-wild non-joker card across all hands
  // Start from rank 3, then 4, etc.
  const rankOrder = ['3','4','5','6','7','8','9','10','J','Q','K','A'];

  for (const rank of rankOrder) {
    let candidates = [];
    G.players.forEach(p => {
      p.hand.forEach(c => {
        if (c.rank === rank) candidates.push({ player: p, card: c });
      });
    });
    if (candidates.length === 0) continue;

    // Sort by suit order
    candidates.sort((a, b) => SUIT_ORDER[a.card.suit] - SUIT_ORDER[b.card.suit]);
    return { playerId: candidates[0].player.id, card: candidates[0].card };
  }
  // Fallback: player 0
  return { playerId: G.players[0].id, card: null };
}

// ── Game Init ─────────────────────────────────────────────────────────────────

function initGame(numPlayers) {
  const exactCount = numPlayers;
  G = {
    numPlayers: exactCount,
    players: [],
    drawPile: [],
    pile: [],
    currentPlayerIdx: 0,
    direction: 1, // 1 = clockwise, -1 = counter-clockwise
    phase: 'setup', // 'setup' | 'hand' | 'faceup' | 'facedown' | 'over'
    tableCount: exactCount === 2 ? 4 : 3,
    selectedCards: [],
    awaitingHumanFacedown: false,
    humanIdx: 0,
    log: [],
  };

  // Create players: 0 = human
  G.players.push(makePlayer(0, 'You', true));
  for (let i = 1; i < exactCount; i++) {
    G.players.push(makePlayer(i, `CPU ${i}`, false));
  }

  dealGame(exactCount);

  // Determine first player
  const firstResult = determineFirstPlayer();
  G.currentPlayerIdx = G.players.findIndex(p => p.id === firstResult.playerId);

  // Store first player info for after setup completes
  G.setupFirstResult = firstResult;

  renderGame();
  startSetupPhase();
}

// ── Setup Phase (human chooses face-up cards) ─────────────────────────────────

function startSetupPhase() {
  G.selectedCards = [];
  document.getElementById('btn-play').textContent = 'Place Face Up';
  document.getElementById('btn-play').disabled = true;
  setPickupButton(false);
  document.getElementById('btn-confirm-facedown').classList.add('hidden');
  updateStatus(`Select ${G.tableCount} cards from your hand to place face-up on the table.`);
  renderGame();
}

function onSetupCardClick(cardId, source) {
  if (source !== 'hand') return;
  const idx = G.selectedCards.indexOf(cardId);
  if (idx === -1) {
    if (G.selectedCards.length >= G.tableCount) {
      updateStatus(`You can only select ${G.tableCount} cards. Deselect one first.`);
      return;
    }
    G.selectedCards.push(cardId);
  } else {
    G.selectedCards.splice(idx, 1);
  }
  const remaining = G.tableCount - G.selectedCards.length;
  if (remaining > 0) {
    updateStatus(`Select ${remaining} more card${remaining !== 1 ? 's' : ''} to place face-up.`);
  } else {
    updateStatus(`Ready! Click "Place Face Up" to confirm.`);
  }
  document.getElementById('btn-play').disabled = G.selectedCards.length !== G.tableCount;
  document.querySelectorAll('.card[data-id]').forEach(el => {
    el.classList.toggle('selected', G.selectedCards.includes(el.dataset.id));
  });
}

function confirmSetupSelection() {
  if (G.selectedCards.length !== G.tableCount) return;
  const player = G.players[G.humanIdx];

  G.selectedCards.forEach(cardId => {
    const i = player.hand.findIndex(c => c.id === cardId);
    if (i !== -1) player.faceUp.push(player.hand.splice(i, 1)[0]);
  });
  G.selectedCards = [];

  document.getElementById('btn-play').textContent = 'Play Selected';

  G.phase = 'hand';

  const firstResult = G.setupFirstResult;
  const firstPlayer = G.players[G.currentPlayerIdx];
  const startCard = firstResult.card ? ` the ${displayCard(firstResult.card)}` : '';
  updatePrevTurn(firstPlayer.isHuman
    ? `Game start – you have the lowest card, ${startCard}. You go first.`
    : `Game start – ${firstPlayer.name} had the lowest card and started with ${startCard}.`);
  updateStatus(`${firstPlayer.name}'s turn first.`);

  renderGame();
  setTimeout(nextTurn, 400);
}

// ── Turn Logic ────────────────────────────────────────────────────────────────

function nextTurn() {
  if (G.phase === 'over' || G.phase === 'setup') return;

  const player = currentPlayer();

  // Check if this player is already out
  if (player.out) {
    advanceTurn();
    return;
  }

  // Determine phase for this player (may mark them out)
  updatePlayerPhase(player);

  if (player.out) {
    if (G.phase !== 'over') advanceTurn();
    return;
  }

  if (player.isHuman) {
    startHumanTurn();
  } else {
    startCPUTurn();
  }
}

function currentPlayer() {
  return G.players[G.currentPlayerIdx];
}

function updatePlayerPhase(player) {
  // Determines what cards the player should be playing from
  if (player.hand.length > 0) {
    // Playing from hand
  } else if (player.faceUp.some(c => c !== null)) {
    // Playing faceup table cards
  } else if (player.faceDown.some(c => c !== null)) {
    // Playing facedown
  } else {
    // Out!
    if (!player.out) {
      player.out = true;
      logMsg(`${player.name} is out! They didn't lose!`);
      if (player.isHuman) {
        showModal("You didn't lose! 🎉");
      }
      checkGameOver();
    }
  }
}

function checkGameOver() {
  const activePlayers = G.players.filter(p => !p.out);
  if (activePlayers.length <= 1) {
    G.phase = 'over';
    const loser = activePlayers[0];
    if (loser) {
      logMsg(`${loser.name} is the Shed!`);
      if (loser.isHuman) {
        showModal('You are the Shed! 😬');
      } else {
        showModal(`${loser.name} is the Shed!`);
      }
    }
    renderGame();
    return true;
  }
  return false;
}

function advanceTurn(skipCount = 1) {
  const activePlayers = G.players.filter(p => !p.out).length;
  if (activePlayers <= 1) return; // game over, don't advance

  for (let i = 0; i < skipCount; i++) {
    let guard = 0;
    do {
      G.currentPlayerIdx = (G.currentPlayerIdx + G.direction + G.numPlayers) % G.numPlayers;
      guard++;
      if (guard > G.numPlayers) break; // safety
    } while (G.players[G.currentPlayerIdx].out);
  }
  renderGame();
  setTimeout(nextTurn, 300);
}

// ── Human Turn ────────────────────────────────────────────────────────────────

function startHumanTurn() {
  G.selectedCards = [];
  G.awaitingHumanFacedown = false;

  const player = currentPlayer();
  if (player.out) return;

  highlightCurrentPlayer();

  // Determine what source the human plays from
  const source = getPlayerSource(player);

  if (source === 'facedown') {
    G.awaitingHumanFacedown = true;
    updateStatus("Your turn – flip a face-down card!");
    setPlayButton(false);
    setPickupButton(false);
    document.getElementById('btn-confirm-facedown').classList.remove('hidden');
  } else {
    const mixedRank = getMixedPlayRank(player);
    if (mixedRank) {
      updateStatus(`Your turn – you can play your hand cards and also include the ${mixedRank}(s) from your table!`);
    } else {
      updateStatus("Your turn – select card(s) to play.");
    }
    setPlayButton(false);
    setPickupButton(true);
    document.getElementById('btn-confirm-facedown').classList.add('hidden');
  }

  renderGame();
}

function getPlayerSource(player) {
  if (player.hand.length > 0) return 'hand';
  if (player.faceUp.some(c => c !== null)) return 'faceup';
  if (player.faceDown.some(c => c !== null)) return 'facedown';
  return 'none';
}

function onCardClick(cardId, source, slotIdx) {
  if (G.phase === 'over') return;
  if (G.phase === 'setup') {
    onSetupCardClick(cardId, source);
    return;
  }
  const player = currentPlayer();
  if (!player.isHuman) return;

  if (G.awaitingHumanFacedown && source === 'facedown') {
    // Flip facedown card
    flipFacedownCard(player, slotIdx);
    return;
  }

  if (source === 'facedown') return; // can't select facedown normally

  // Toggle selection
  const idx = G.selectedCards.indexOf(cardId);
  if (idx === -1) {
    // Only allow selecting same rank
    const card = findCard(player, cardId, source);
    if (!card) return;
    if (G.selectedCards.length > 0) {
      const firstCard = findCardById(player, G.selectedCards[0]);
      if (firstCard && firstCard.rank !== card.rank) {
        // Different rank – reset selection
        G.selectedCards = [];
      }
    }
    if (canPlay(card) || isJoker(card)) {
      G.selectedCards.push(cardId);
    } else {
      updateStatus(`Can't play that card right now.`);
    }
  } else {
    G.selectedCards.splice(idx, 1);
  }

  setPlayButton(G.selectedCards.length > 0);
  // Update selected state on existing elements without a full re-render,
  // which would destroy/recreate card nodes and cause a transition stutter.
  document.querySelectorAll('.card[data-id]').forEach(el => {
    el.classList.toggle('selected', G.selectedCards.includes(el.dataset.id));
  });
}

function findCard(player, cardId, source) {
  if (source === 'hand') return player.hand.find(c => c.id === cardId);
  if (source === 'faceup') return player.faceUp.find(c => c && c.id === cardId);
  return null;
}

function findCardById(player, cardId) {
  let c = player.hand.find(c => c.id === cardId);
  if (c) return c;
  c = player.faceUp.find(c => c && c.id === cardId);
  return c || null;
}

function onPlaySelected() {
  if (G.phase === 'setup') {
    confirmSetupSelection();
    return;
  }
  if (G.selectedCards.length === 0) return;
  const player = currentPlayer();
  const source = getPlayerSource(player);

  const cards = G.selectedCards.map(id => findCardById(player, id)).filter(Boolean);
  if (cards.length === 0) return;

  // Validate all same rank and playable
  const rank = cards[0].rank;
  if (!cards.every(c => c.rank === rank)) {
    updateStatus("You can only play cards of the same rank together.");
    return;
  }
  if (!canPlay(cards[0])) {
    updateStatus("You can't play that right now.");
    return;
  }

  // Detect mixed play: hand + face-up cards played together
  let effectiveSource = source;
  if (source === 'hand') {
    const hasFaceUpSelected = cards.some(c => player.faceUp.some(fu => fu && fu.id === c.id));
    if (hasFaceUpSelected) {
      // All hand cards must be included when combining with face-up cards
      if (!player.hand.every(c => G.selectedCards.includes(c.id))) {
        updateStatus("You must play all of your hand cards when combining with face-up cards.");
        return;
      }
      effectiveSource = 'mixed';
    }
  }

  G.selectedCards = [];
  setPlayButton(false);
  setPickupButton(false);

  playCards(player, cards, effectiveSource);
}

function onPickupPile() {
  if (G.pile.length === 0) {
    updateStatus("Nothing to pick up.");
    return;
  }
  const player = currentPlayer();
  player.hand.push(...G.pile);
  G.pile = [];
  logMsg(`${player.name} picked up the pile.`);
  updatePrevTurn(`You picked up the pile.`);
  updateStatus("You picked up the pile.");
  G.selectedCards = [];
  renderGame();
  advanceTurn();
}

function flipFacedownCard(player, slotIdx) {
  const card = player.faceDown[slotIdx];
  if (!card) return;

  document.getElementById('btn-confirm-facedown').classList.add('hidden');
  G.awaitingHumanFacedown = false;

  // Reveal card
  player.faceDown[slotIdx] = null;

  if (canPlay(card)) {
    // Play it
    playCards(player, [card], 'facedown-reveal');
  } else {
    // Must pick up pile + the flipped card
    player.hand.push(...G.pile, card);
    G.pile = [];
    logMsg(`${player.name} flipped ${displayCard(card)} – can't play it, picks up the pile.`);
    updatePrevTurn(`You flipped ${displayCard(card)} – couldn't play it and picked up the pile.`);
    updateStatus(`Flipped ${displayCard(card)} – can't play it. Picked up pile.`);
    renderGame();
    advanceTurn();
  }
}

// ── Play Cards (shared) ───────────────────────────────────────────────────────

function playCards(player, cards, source) {
  // Remove cards from player's source
  cards.forEach(card => {
    if (source === 'hand') {
      player.hand = player.hand.filter(c => c.id !== card.id);
    } else if (source === 'faceup') {
      const i = player.faceUp.findIndex(c => c && c.id === card.id);
      if (i !== -1) player.faceUp[i] = null;
    } else if (source === 'mixed') {
      // Card may be from hand or face-up
      const handIdx = player.hand.findIndex(c => c.id === card.id);
      if (handIdx !== -1) {
        player.hand.splice(handIdx, 1);
      } else {
        const fuIdx = player.faceUp.findIndex(c => c && c.id === card.id);
        if (fuIdx !== -1) player.faceUp[fuIdx] = null;
      }
    } else if (source === 'facedown' || source === 'facedown-reveal') {
      // already removed
    }
  });

  // Add to pile
  G.pile.push(...cards);

  const rankStr = cards.map(displayCard).join(', ');
  logMsg(`${player.name} played ${rankStr}.`);
  updateStatus(`${player.name} played ${rankStr}.`);

  // Handle joker (reverse)
  if (cards.every(isJoker)) {
    G.direction *= -1;
    logMsg('Direction reversed!');
    updateStatus('Direction reversed!');
    updatePrevTurn(`${player.name} played a Joker and reversed direction.`);
    renderGame();
    // Joker is invisible – current player draws/keeps turn? No – it still advances
    drawBackUp(player);
    renderGame();
    advanceTurn();
    return;
  }

  // Handle 10 (burn)
  if (cards[0].rank === '10') {
    burnPile();
    drawBackUp(player);
    renderGame();
    updatePrevTurn(`${player.name} played a 10 and burned the pile.`);
    updateStatus(`${player.name} played a 10 – pile burned! Play again.`);
    // Same player goes again
    setTimeout(nextTurn, CPU_DELAY);
    return;
  }

  // Check for four-of-a-kind burn
  if (checkFourOfAKind()) {
    burnPile();
    drawBackUp(player);
    renderGame();
    updatePrevTurn(`${player.name} completed four of a kind and burned the pile.`);
    updateStatus(`Four of a kind! Pile burned! ${player.name} plays again.`);
    setTimeout(nextTurn, CPU_DELAY);
    return;
  }

  // Handle 8 (skip)
  let skipCount = 1;
  if (cards[0].rank === '8') {
    skipCount = 1 + cards.length; // 1 normal advance + extra skips
    updatePrevTurn(`${player.name} played ${cards.length > 1 ? cards.length + ' eights' : 'an 8'} and skipped ${cards.length} player${cards.length > 1 ? 's' : ''}.`);
    updateStatus(`${player.name} played ${cards.length} eight(s) – skip ${cards.length} player(s)!`);
  } else {
    updatePrevTurn(`${player.name} played ${rankStr}.`);
  }

  // Draw back up to 3
  drawBackUp(player);

  renderGame();

  // Check if player is now out
  updatePlayerPhase(player);
  if (player.out) return;

  advanceTurn(skipCount);
}

function drawBackUp(player) {
  // Draw from draw pile until hand has 3 (only during hand phase of draw pile existing)
  if (G.drawPile.length === 0) return;
  if (player.hand.length >= 3) return;
  // Only draw if player still has something to draw
  while (player.hand.length < 3 && G.drawPile.length > 0) {
    player.hand.push(G.drawPile.pop());
  }
}

function burnPile() {
  G.pile = [];
  logMsg('Pile burned!');
}

function checkFourOfAKind() {
  if (G.pile.length < 4) return false;
  const top4 = G.pile.slice(-4);
  const rank = top4[0].rank;
  return top4.every(c => c.rank === rank) && rank !== 'JOKER';
}

// ── CPU Turn ──────────────────────────────────────────────────────────────────

function startCPUTurn() {
  const player = currentPlayer();
  if (player.out) return;

  highlightCurrentPlayer();
  updateStatus(`${player.name} is thinking…`);
  document.querySelector(`.cpu-player[data-id="${player.id}"]`)?.classList.add('thinking');

  setTimeout(() => {
    if (G.phase === 'over') return;
    document.querySelector(`.cpu-player[data-id="${player.id}"]`)?.classList.remove('thinking');
    executeCPUTurn(player);
  }, CPU_DELAY);
}

function executeCPUTurn(player) {
  const source = getPlayerSource(player);

  if (source === 'facedown') {
    // Must flip a random facedown card
    const validSlots = player.faceDown.map((c, i) => c ? i : -1).filter(i => i !== -1);
    const slotIdx = validSlots[Math.floor(Math.random() * validSlots.length)];
    const card = player.faceDown[slotIdx];
    player.faceDown[slotIdx] = null;

    if (canPlay(card)) {
      playCards(player, [card], 'facedown-reveal');
    } else {
      player.hand.push(...G.pile, card);
      G.pile = [];
      logMsg(`${player.name} flipped ${displayCard(card)} – can't play it, picks up the pile.`);
      updatePrevTurn(`${player.name} flipped ${displayCard(card)} – couldn't play it and picked up the pile.`);
      updateStatus(`${player.name} flipped ${displayCard(card)} – can't play it.`);
      renderGame();
      advanceTurn();
    }
    return;
  }

  // Get playable cards from current source
  let available = [];
  if (source === 'hand') available = player.hand;
  else if (source === 'faceup') available = player.faceUp.filter(Boolean);

  const playable = getPlayableGroups(available);

  if (playable.length === 0) {
    // Must pick up pile
    player.hand.push(...G.pile);
    G.pile = [];
    logMsg(`${player.name} picks up the pile.`);
    updatePrevTurn(`${player.name} picked up the pile.`);
    updateStatus(`${player.name} picks up the pile.`);
    renderGame();
    advanceTurn();
    return;
  }

  // CPU strategy: prefer to play the lowest valid group (unless it has specials)
  const chosen = chooseCPUPlay(playable);

  // Check if the mixed play rule applies: all hand cards same rank + matching face-up
  const mixedRank = source === 'hand' ? getMixedPlayRank(player) : null;
  if (mixedRank && chosen[0].rank === mixedRank) {
    const matchingFaceUp = player.faceUp.filter(c => c && c.rank === mixedRank);
    playCards(player, [...chosen, ...matchingFaceUp], 'mixed');
    return;
  }

  playCards(player, chosen, source);
}

function getPlayableGroups(cards) {
  // Group by rank
  const groups = {};
  cards.forEach(c => {
    if (!groups[c.rank]) groups[c.rank] = [];
    groups[c.rank].push(c);
  });

  return Object.values(groups).filter(grp => canPlay(grp[0]));
}

function chooseCPUPlay(groups) {
  // Priority: 10 (burns) > match pile rank > lowest playable > wild 2
  const top = effectiveTopCard();

  // Check for four-of-a-kind completion
  if (top && G.pile.length >= 1) {
    const topRank = top.rank;
    const topInPile = G.pile.filter(c => c.rank === topRank).length;
    const matching = groups.find(g => g[0].rank === topRank);
    if (matching && topInPile + matching.length >= 4) return matching;
  }

  // Prefer 10 (burn)
  const ten = groups.find(g => g[0].rank === '10');
  if (ten) return ten;

  // Avoid playing 2 unless necessary (it's a useful wild)
  const nonWild = groups.filter(g => g[0].rank !== '2' && !isJoker(g[0]));
  const pool = nonWild.length > 0 ? nonWild : groups;

  // Sort by value ascending – play lowest valid card to save high cards
  pool.sort((a, b) => cardValue(a[0]) - cardValue(b[0]));

  // Play biggest group of the lowest rank (play all matching)
  return pool[0];
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderGame() {
  renderCPUPlayers();
  renderCenter();
  renderHumanPlayer();
  updateDirectionIndicator();
}

function renderCPUPlayers() {
  const area = document.getElementById('cpu-area');
  area.innerHTML = '';

  G.players.filter(p => !p.isHuman).forEach(p => {
    const div = document.createElement('div');
    div.className = 'cpu-player' + (p.out ? ' shed-out' : '');
    div.dataset.id = p.id;
    if (G.currentPlayerIdx === p.id && !G.players[G.currentPlayerIdx].isHuman) {
      // Actually check by index
    }
    if (G.currentPlayerIdx === G.players.indexOf(p) && !G.players[G.currentPlayerIdx].out) {
      div.classList.add('active-turn');
    }

    div.innerHTML = `<div class="cpu-name">${p.name}${p.out ? ' ✓' : ''}</div>`;

    // Table cards
    const tableRow = document.createElement('div');
    tableRow.className = 'cpu-table-row';
    for (let i = 0; i < G.tableCount; i++) {
      const fd = p.faceDown[i];
      const fu = p.faceUp[i];
      const stack = document.createElement('div');
      stack.className = 'table-stack';

      if (fd || fu) {
        if (fd) {
          const back = document.createElement('div');
          back.className = 'card-back under';
          stack.appendChild(back);
        }
        if (fu) {
          const cardEl = buildCardEl(fu);
          cardEl.classList.add('faceup-table', 'no-hover');
          cardEl.style.cssText = 'position:absolute;top:0;left:0;';
          stack.appendChild(cardEl);
        } else if (fd) {
          // Only facedown remains — show it in the top-left position
          // The .under back is already offset; add a second indicator at top-left
        }
      } else {
        const slot = document.createElement('div');
        slot.className = 'facedown-slot';
        stack.appendChild(slot);
      }
      tableRow.appendChild(stack);
    }
    div.appendChild(tableRow);

    // Hand label + cards (show backs)
    const handLabel = document.createElement('div');
    handLabel.className = 'hand-label';
    handLabel.textContent = 'Cards in hand';
    div.appendChild(handLabel);

    const handRow = document.createElement('div');
    handRow.className = 'cpu-hand-row';
    const cpuN = p.hand.length;
    let cpuFanStep = null;
    if (cpuN > 7) {
      const cpuCardW = 30, cpuCardH = 42;
      const maxW = Math.min(180, window.innerWidth / Math.max(G.players.filter(pl => !pl.isHuman).length, 1) - 30);
      cpuFanStep = Math.max(6, Math.min(cpuCardW - 5, Math.floor((maxW - cpuCardW) / (cpuN - 1))));
      handRow.classList.add('fanned');
      handRow.style.width = (cpuCardW + (cpuN - 1) * cpuFanStep) + 'px';
      handRow.style.height = cpuCardH + 'px';
    }
    p.hand.forEach((_, i) => {
      const back = document.createElement('div');
      back.className = 'card-back cpu-card-mini';
      if (cpuFanStep !== null) {
        back.style.position = 'absolute';
        back.style.left = (i * cpuFanStep) + 'px';
        back.style.zIndex = i;
      }
      handRow.appendChild(back);
    });
    div.appendChild(handRow);

    area.appendChild(div);
  });
}

function renderCenter() {
  // Draw pile
  const drawCount = document.getElementById('draw-count');
  drawCount.textContent = G.drawPile.length;
  const drawPileEl = document.getElementById('draw-pile');
  drawPileEl.style.display = G.drawPile.length > 0 ? 'block' : 'none';

  // Play pile
  const pileEl = document.getElementById('play-pile');
  pileEl.innerHTML = '';
  if (G.pile.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = `width:var(--card-w);height:var(--card-h);border:2px dashed rgba(255,255,255,.3);border-radius:var(--radius);`;
    pileEl.appendChild(empty);
  } else {
    // Show up to top 5 cards fanned
    const show = G.pile.slice(-5);
    show.forEach((card, i) => {
      const el = buildCardEl(card);
      el.classList.add('no-hover');
      el.style.position = 'absolute';
      el.style.top = `${i * 3}px`;
      el.style.left = `${i * 3}px`;
      el.style.zIndex = i;
      pileEl.appendChild(el);
    });
  }
}

function renderHumanPlayer() {
  const player = G.players[G.humanIdx];

  // Table cards
  const tableRow = document.getElementById('human-table-cards');
  tableRow.innerHTML = '';
  const hasHandCards = player.hand.length > 0;
  const mixedPlayRank = hasHandCards ? getMixedPlayRank(player) : null;
  for (let i = 0; i < G.tableCount; i++) {
    const fd = player.faceDown[i];
    const fu = player.faceUp[i];
    const stack = document.createElement('div');
    stack.className = 'table-stack';
    // Only block this card if it isn't eligible for mixed play
    if (hasHandCards && !(mixedPlayRank && fu && fu.rank === mixedPlayRank)) {
      stack.addEventListener('click', () => {
        updateStatus('You must play all of the cards in your hand before you can play these cards.');
      });
    }

    if (fd || fu) {
      if (fd) {
        const back = document.createElement('div');
        back.className = 'card-back under';

        if (G.awaitingHumanFacedown && !fu) {
          back.style.cursor = 'pointer';
          back.style.outline = '2px solid var(--gold)';
          back.style.outlineOffset = '2px';
          back.addEventListener('click', () => onCardClick(null, 'facedown', i));
        }
        stack.appendChild(back);
      }
      if (fu) {
        const cardEl = buildCardEl(fu);
        cardEl.classList.add('faceup-table', 'no-hover');
        cardEl.style.cssText = 'position:absolute;top:0;left:0;';

        // Faceup cards are playable if hand is empty, or if mixed play applies for this rank
        if ((player.hand.length === 0 || (mixedPlayRank && fu.rank === mixedPlayRank)) && !G.awaitingHumanFacedown) {
          cardEl.classList.remove('no-hover');
          cardEl.classList.remove('faceup-table');
          const isSelected = G.selectedCards.includes(fu.id);
          if (isSelected) cardEl.classList.add('selected');
          cardEl.addEventListener('click', () => onCardClick(fu.id, 'faceup', i));
        }
        stack.appendChild(cardEl);
      }
    } else {
      const slot = document.createElement('div');
      slot.className = 'facedown-slot';
      stack.appendChild(slot);
    }
    tableRow.appendChild(stack);
  }

  // Hand
  const handRow = document.getElementById('human-hand');
  handRow.innerHTML = '';
  const source = getPlayerSource(player);

  const handLabel = document.getElementById('human-hand-label');
  if (G.phase === 'setup') {
    const remaining = G.tableCount - G.selectedCards.length;
    handLabel.textContent = remaining > 0
      ? `Choose ${remaining} card${remaining !== 1 ? 's' : ''} to place face-up`
      : 'Ready to confirm!';
  } else {
    handLabel.textContent = 'Cards in hand';
  }

  const sortedHand = [...player.hand].sort((a, b) => cardValue(a) - cardValue(b));
  const handN = sortedHand.length;
  let fanStep = null;
  if (handN > 7) {
    const cardW = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--card-w').trim()) || 72;
    const cardH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--card-h').trim()) || 100;
    const maxW = Math.min(340, window.innerWidth - 40);
    fanStep = Math.max(10, Math.min(cardW - 10, Math.floor((maxW - cardW) / (handN - 1))));
    handRow.classList.add('fanned');
    handRow.style.width = (cardW + (handN - 1) * fanStep) + 'px';
    handRow.style.height = (cardH + 20) + 'px';

  }

  sortedHand.forEach((card, i) => {
    const el = buildCardEl(card);
    const isSelected = G.selectedCards.includes(card.id);
    if (isSelected) el.classList.add('selected');

    if (G.phase === 'setup' || (source === 'hand' && currentPlayer() === player)) {
      el.addEventListener('click', () => onCardClick(card.id, 'hand', null));
    } else {
      el.classList.add('no-hover');
    }
    if (fanStep !== null) {
      el.style.position = 'absolute';
      el.style.left = (i * fanStep) + 'px';
      el.style.zIndex = i;
    }
    handRow.appendChild(el);
  });
}

function buildCardEl(card) {
  const el = document.createElement('div');
  el.className = 'card';
  el.dataset.id = card.id;

  if (card.rank === 'JOKER') {
    el.classList.add('joker');
    el.innerHTML = `
      <div class="card-rank">JKR</div>
      <div class="card-center">🃏</div>
      <div class="card-rank-bottom">JKR</div>
    `;
    return el;
  }

  const isRed = card.suit === 'hearts' || card.suit === 'diamonds';
  if (isRed) el.classList.add('red-suit');

  const sym = SUIT_SYMBOL[card.suit] || '';
  el.innerHTML = `
    <div class="card-rank">${card.rank}<br>${sym}</div>
    <div class="card-center">${sym}</div>
    <div class="card-rank-bottom">${card.rank}<br>${sym}</div>
  `;
  return el;
}

function updateDirectionIndicator() {
  const el = document.getElementById('direction-indicator');
  el.textContent = G.direction === 1 ? '↻' : '↺';
}

function highlightCurrentPlayer() {
  document.querySelectorAll('.cpu-player').forEach(el => el.classList.remove('active-turn'));
  const player = currentPlayer();
  if (!player.isHuman) {
    const el = document.querySelector(`.cpu-player[data-id="${player.id}"]`);
    if (el) el.classList.add('active-turn');
  }

  // Highlight human area
  const humanArea = document.getElementById('human-area');
  if (player.isHuman) {
    humanArea.style.boxShadow = '0 0 0 2px var(--gold)';
    humanArea.style.borderRadius = '10px';
  } else {
    humanArea.style.boxShadow = '';
  }
}

// ── UI Helpers ────────────────────────────────────────────────────────────────

function setPlayButton(enabled) {
  document.getElementById('btn-play').disabled = !enabled;
}
function setPickupButton(enabled) {
  document.getElementById('btn-pickup').disabled = !enabled;
}

function updateStatus(msg) {
  document.getElementById('status-msg').textContent = msg;
  G.log = G.log || [];
  G.log.push(msg);
}

function updatePrevTurn(msg) {
  document.getElementById('prev-turn-msg').textContent = document.getElementById('curr-turn-msg').textContent;
  document.getElementById('curr-turn-msg').textContent = msg;
}

function logMsg(msg) {
  G.log = G.log || [];
  G.log.push(msg);
}

function displayCard(card) {
  if (card.rank === 'JOKER') return 'Joker';
  return `${card.rank}${SUIT_SYMBOL[card.suit]}`;
}

function showModal(msg) {
  document.getElementById('modal-msg').textContent = msg;
  document.getElementById('modal').classList.remove('hidden');
}

// ── Screen Management ─────────────────────────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── Event Listeners ───────────────────────────────────────────────────────────

function isMobile() {
  return window.matchMedia('(pointer: coarse)').matches && window.innerWidth <= 768;
}

document.getElementById('btn-rules').addEventListener('click', () => {
  showScreen('screen-rules');
});

document.getElementById('btn-rules-back').addEventListener('click', () => {
  showScreen('screen-start');
});

document.getElementById('btn-start').addEventListener('click', () => {
  if (isMobile()) {
    startNewGame(2);
  } else {
    showScreen('screen-players');
  }
});

document.querySelectorAll('.btn-player-count').forEach(btn => {
  btn.addEventListener('click', () => {
    const count = btn.dataset.count;
    if (count === '4') {
      // Show 3-5 picker
      document.getElementById('player-count-picker').classList.remove('hidden');
    } else {
      startNewGame(parseInt(count));
    }
  });
});

document.querySelectorAll('.btn-exact').forEach(btn => {
  btn.addEventListener('click', () => {
    startNewGame(parseInt(btn.dataset.n));
  });
});

document.getElementById('btn-play').addEventListener('click', onPlaySelected);
document.getElementById('btn-pickup').addEventListener('click', onPickupPile);

document.getElementById('btn-confirm-facedown').addEventListener('click', () => {
  // This button isn't really used now – clicking the card directly triggers it
  updateStatus("Click a face-down card to flip it.");
});

document.getElementById('modal-ok').addEventListener('click', () => {
  document.getElementById('modal').classList.add('hidden');
  if (G.phase === 'over') {
    // Offer restart
    if (confirm('Play again?')) {
      showScreen('screen-start');
    }
  }
});

function startNewGame(numPlayers) {
  showScreen('screen-game');
  initGame(numPlayers);
}

const STORAGE_KEY = "card-pack-builder-v2";
const SEARCH_LIMIT = 24;
const MAIN_SET_RELEASE_OVERRIDES = new Map([
  ["base1", 1],
  ["base2", 2],
  ["base3", 3],
  ["base4", 4],
  ["base5", 5],
]);

const state = {
  allCards: [],
  sets: [],
  setLookup: new Map(),
  draftCards: [],
  confirmedBundles: [],
  nextBundleNumber: 1,
  isLoadingCards: false,
  loadPromise: null,
};

const tcgdex = new TCGdex("en");

const els = {
  loadCardsButton: document.querySelector("#loadCardsButton"),
  searchForm: document.querySelector("#searchForm"),
  searchInput: document.querySelector("#searchInput"),
  statusLine: document.querySelector("#statusLine"),
  resultsGrid: document.querySelector("#resultsGrid"),
  activeBundleList: document.querySelector("#activeBundleList"),
  confirmedBundleList: document.querySelector("#confirmedBundleList"),
  confirmBundleButton: document.querySelector("#confirmBundleButton"),
  clearDraftButton: document.querySelector("#clearDraftButton"),
  activeCardCount: document.querySelector("#activeCardCount"),
  confirmedBundleCount: document.querySelector("#confirmedBundleCount"),
  nextBundleLabel: document.querySelector("#nextBundleLabel"),
  cardResultTemplate: document.querySelector("#cardResultTemplate"),
};

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return;

  try {
    const parsed = JSON.parse(saved);
    state.draftCards = Array.isArray(parsed.draftCards) ? parsed.draftCards : [];
    state.confirmedBundles = Array.isArray(parsed.confirmedBundles) ? parsed.confirmedBundles : [];
    state.nextBundleNumber = state.confirmedBundles.length
      ? Math.max(Number.isInteger(parsed.nextBundleNumber) ? parsed.nextBundleNumber : 1, getNextBundleNumber(state.confirmedBundles))
      : 1;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function saveState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      draftCards: state.draftCards,
      confirmedBundles: state.confirmedBundles,
      nextBundleNumber: state.nextBundleNumber,
    }),
  );
}

function cardImageCandidates(card) {
  if (!card?.image) return [];
  return [
    `${card.image}/low.webp`,
    `${card.image}/high.webp`,
    `${card.image}/low.png`,
    `${card.image}/high.png`,
  ];
}

function placeholderImage(name = "Card") {
  const safeName = String(name).replace(/[<&>"]/g, "");
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="220" height="307" viewBox="0 0 220 307">
      <rect width="220" height="307" rx="14" fill="#0a192d"/>
      <rect x="10" y="10" width="200" height="287" rx="10" fill="#132a49" stroke="#3f5f88" stroke-width="2"/>
      <circle cx="110" cy="124" r="42" fill="#071426" stroke="#3fb7ff" stroke-width="5"/>
      <path d="M68 124h84" stroke="#3fb7ff" stroke-width="7"/>
      <circle cx="110" cy="124" r="15" fill="#edf5ff" stroke="#3fb7ff" stroke-width="5"/>
      <text x="110" y="205" fill="#edf5ff" font-family="Arial, sans-serif" font-size="18" font-weight="700" text-anchor="middle">No image</text>
      <text x="110" y="232" fill="#9fb3cc" font-family="Arial, sans-serif" font-size="13" text-anchor="middle">${safeName.slice(0, 22)}</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function applyImageFallback(image, card) {
  const candidates = cardImageCandidates(card);
  let index = 0;
  image.classList.remove("is-placeholder");
  image.src = candidates[index] ?? placeholderImage(card?.name);
  image.onerror = () => {
    index += 1;
    if (index < candidates.length) {
      image.src = candidates[index];
      return;
    }

    image.onerror = null;
    image.classList.add("is-placeholder");
    image.src = placeholderImage(card?.name);
  };
}

function setStatus(message) {
  els.statusLine.textContent = message;
}

async function loadCards() {
  if (state.allCards.length) return state.allCards;
  if (state.loadPromise) return state.loadPromise;

  state.isLoadingCards = true;
  els.loadCardsButton.disabled = true;
  setStatus("Loading TCGdex card index...");

  state.loadPromise = (async () => {
    const [cards, sets] = await Promise.all([tcgdex.card.list(), tcgdex.set.list()]);
    state.sets = sets;
    state.setLookup = new Map(
      sets.map((set, index) => [
        set.id,
        {
          ...set,
          releaseOrder: MAIN_SET_RELEASE_OVERRIDES.get(set.id) ?? index + 100,
        },
      ]),
    );
    state.allCards = cards.map(enrichCardWithSet);
    setStatus(`Loaded ${state.allCards.length.toLocaleString()} cards. Search by name or card ID.`);
    return state.allCards;
  })();

  try {
    return await state.loadPromise;
  } catch (error) {
    console.error(error);
    setStatus("Could not load cards from TCGdex. Check your connection and try again.");
    els.loadCardsButton.disabled = false;
    return [];
  } finally {
    state.isLoadingCards = false;
    state.loadPromise = null;
  }
}

function getSetId(cardId = "") {
  const dashIndex = cardId.lastIndexOf("-");
  return dashIndex > -1 ? cardId.slice(0, dashIndex) : cardId;
}

function localIdSortValue(localId = "") {
  const number = Number.parseInt(String(localId).match(/\d+/)?.[0] ?? "", 10);
  return Number.isFinite(number) ? number : Number.MAX_SAFE_INTEGER;
}

function enrichCardWithSet(card) {
  const setId = getSetId(card.id);
  const set = state.setLookup.get(setId);
  return {
    ...card,
    setId,
    setName: set?.name ?? setId,
    setOrder: set?.releaseOrder ?? Number.MAX_SAFE_INTEGER,
  };
}

function compareCardsByRelease(a, b) {
  return (
    a.setOrder - b.setOrder ||
    localIdSortValue(a.localId) - localIdSortValue(b.localId) ||
    String(a.localId).localeCompare(String(b.localId), undefined, { numeric: true }) ||
    a.name.localeCompare(b.name)
  );
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function searchCards(query) {
  if (!state.allCards.length) await loadCards();
  const term = normalize(query);

  if (!term) {
    setStatus(`Loaded ${state.allCards.length.toLocaleString()} cards. Type a search to filter.`);
    renderResults([]);
    return;
  }

  const results = state.allCards
    .filter((card) => {
      const haystack = `${card.name} ${card.id} ${card.localId} ${card.setName}`.toLowerCase();
      return haystack.includes(term);
    })
    .sort(compareCardsByRelease)
    .slice(0, SEARCH_LIMIT);

  setStatus(`${results.length} result${results.length === 1 ? "" : "s"} shown for "${query}", sorted by set release order.`);
  renderResults(results);
}

function renderResults(cards) {
  els.resultsGrid.replaceChildren();

  if (!cards.length) return;

  const fragment = document.createDocumentFragment();

  cards.forEach((card) => {
    const node = els.cardResultTemplate.content.firstElementChild.cloneNode(true);
    const image = node.querySelector("img");
    const title = node.querySelector("h3");
    const meta = node.querySelector("p");
    const condition = node.querySelector("select");
    const quantity = node.querySelector("input");
    const button = node.querySelector("button");

    image.alt = `${card.name} card image`;
    applyImageFallback(image, card);
    title.textContent = card.name;
    meta.textContent = `${card.setName} - ${card.id} - Local ID ${card.localId}`;
    button.addEventListener("click", () => addCardToDraft(card, Number(quantity.value), condition.value));

    fragment.append(node);
  });

  els.resultsGrid.append(fragment);
}

function addCardToDraft(card, quantity = 1, condition = "Near Mint") {
  const safeQuantity = Math.max(1, Number.isFinite(quantity) ? quantity : 1);
  const existing = state.draftCards.find((item) => item.cardId === card.id && item.condition === condition);

  if (existing) {
    existing.quantity += safeQuantity;
  } else {
    state.draftCards.push({
      id: crypto.randomUUID(),
      cardId: card.id,
      localId: card.localId,
      name: card.name,
      image: card.image,
      setName: card.setName,
      setId: card.setId,
      setOrder: card.setOrder,
      condition,
      quantity: safeQuantity,
      addedAt: new Date().toISOString(),
    });
    state.draftCards.sort(compareBundleItems);
  }

  saveState();
  render();
}

function compareBundleItems(a, b) {
  return compareCardsByRelease(a, b);
}

function updateDraftQuantity(id, direction) {
  const item = state.draftCards.find((card) => card.id === id);
  if (!item) return;

  item.quantity += direction;
  if (item.quantity <= 0) {
    removeDraftCard(id);
    return;
  }

  saveState();
  render();
}

function removeDraftCard(id) {
  state.draftCards = state.draftCards.filter((card) => card.id !== id);
  saveState();
  render();
}

function clearDraft() {
  state.draftCards = [];
  saveState();
  render();
}

function confirmBundle() {
  if (!state.draftCards.length) return;

  const bundleNumber = state.nextBundleNumber;
  state.confirmedBundles.unshift({
    id: crypto.randomUUID(),
    bundleNumber,
    name: `Bundle #${bundleNumber}`,
    cards: state.draftCards.map((card) => ({ ...card })),
    createdAt: new Date().toISOString(),
  });
  state.nextBundleNumber += 1;
  state.draftCards = [];
  saveState();
  render();
}

function deleteConfirmedBundle(id) {
  state.confirmedBundles = state.confirmedBundles.filter((bundle) => bundle.id !== id);
  if (!state.confirmedBundles.length) {
    state.nextBundleNumber = 1;
  }
  saveState();
  render();
}

function exportConfirmedBundle(id) {
  const bundle = state.confirmedBundles.find((item) => item.id === id);
  if (!bundle) return;

  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `bundle-${bundle.bundleNumber}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function getNextBundleNumber(bundles) {
  const highest = bundles.reduce((max, bundle) => Math.max(max, Number(bundle.bundleNumber) || 0), 0);
  return highest + 1;
}

function countCards(cards) {
  return cards.reduce((total, card) => total + card.quantity, 0);
}

function renderDraftBundle() {
  els.activeBundleList.replaceChildren();

  if (!state.draftCards.length) {
    els.activeBundleList.textContent = "Search cards above, then add them to the active bundle.";
    els.activeBundleList.classList.add("empty-state");
    return;
  }

  els.activeBundleList.classList.remove("empty-state");
  const fragment = document.createDocumentFragment();

  state.draftCards.forEach((item) => {
    const article = document.createElement("article");
    article.className = "bundle-card active-card";
    article.dataset.expandableCard = "true";
    article.innerHTML = `
      <img class="bundle-thumb" alt="${escapeHtml(item.name)} card image">
      <div>
        <h3>${escapeHtml(item.name)}</h3>
        <p>${escapeHtml(item.setName)} - ${escapeHtml(item.cardId)} - ${escapeHtml(item.condition)}</p>
        <p>${item.quantity} in active bundle</p>
        <div class="item-controls">
          <button class="small-button ghost-button" type="button" data-action="minus">-</button>
          <button class="small-button ghost-button" type="button" data-action="plus">+</button>
          <button class="small-button danger-button" type="button" data-action="remove">Remove</button>
        </div>
      </div>
    `;

    article.querySelector('[data-action="minus"]').addEventListener("click", () => updateDraftQuantity(item.id, -1));
    article.querySelector('[data-action="plus"]').addEventListener("click", () => updateDraftQuantity(item.id, 1));
    article.querySelector('[data-action="remove"]').addEventListener("click", () => removeDraftCard(item.id));
    article.addEventListener("click", (event) => toggleCardExpansion(event, article));
    applyImageFallback(article.querySelector(".bundle-thumb"), item);
    fragment.append(article);
  });

  els.activeBundleList.append(fragment);
}

function renderConfirmedBundles() {
  els.confirmedBundleList.replaceChildren();

  if (!state.confirmedBundles.length) {
    els.confirmedBundleList.textContent = "No confirmed bundles yet.";
    els.confirmedBundleList.classList.add("empty-state");
    return;
  }

  els.confirmedBundleList.classList.remove("empty-state");
  const fragment = document.createDocumentFragment();

  state.confirmedBundles.forEach((bundle) => {
    const cardTotal = countCards(bundle.cards);
    const article = document.createElement("article");
    article.className = "bundle-item";
    const cardRows = bundle.cards
      .map((card) => `
        <div class="confirmed-card-row" data-expandable-card="true">
          <img class="bundle-thumb" alt="${escapeHtml(card.name)} card image">
          <div>
            <strong>${escapeHtml(card.name)}</strong>
            <span>${card.quantity}x - ${escapeHtml(card.condition)} - ${escapeHtml(card.cardId)}</span>
            <span>${escapeHtml(card.setName)}</span>
          </div>
        </div>
      `)
      .join("");

    article.innerHTML = `
      <h3>${escapeHtml(bundle.name)}</h3>
      <p><span class="bundle-total">${cardTotal}</span> cards assigned</p>
      <div class="bundle-controls">
        <button class="small-button ghost-button" type="button" data-action="export">Export JSON</button>
        <button class="small-button danger-button" type="button" data-action="delete">Delete</button>
      </div>
      <div class="confirmed-card-list">${cardRows}</div>
    `;

    article.querySelector('[data-action="export"]').addEventListener("click", () => exportConfirmedBundle(bundle.id));
    article.querySelector('[data-action="delete"]').addEventListener("click", () => deleteConfirmedBundle(bundle.id));
    article.querySelectorAll("[data-expandable-card]").forEach((cardRow, index) => {
      cardRow.addEventListener("click", (event) => toggleCardExpansion(event, cardRow));
      applyImageFallback(cardRow.querySelector(".bundle-thumb"), bundle.cards[index]);
    });
    fragment.append(article);
  });

  els.confirmedBundleList.append(fragment);
}

function toggleCardExpansion(event, element) {
  if (event.target.closest("button")) return;
  element.classList.toggle("is-expanded");
}

function renderSummary() {
  els.activeCardCount.textContent = countCards(state.draftCards);
  els.confirmedBundleCount.textContent = state.confirmedBundles.length;
  els.nextBundleLabel.textContent = `Next confirmed bundle: #${state.nextBundleNumber}`;
  els.confirmBundleButton.disabled = state.draftCards.length === 0;
  els.clearDraftButton.disabled = state.draftCards.length === 0;
}

function render() {
  renderSummary();
  renderDraftBundle();
  renderConfirmedBundles();
}

els.loadCardsButton.addEventListener("click", loadCards);

els.searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  searchCards(els.searchInput.value);
});

els.searchInput.addEventListener("input", () => {
  if (els.searchInput.value.trim().length >= 3) {
    searchCards(els.searchInput.value);
  }
});

els.confirmBundleButton.addEventListener("click", confirmBundle);
els.clearDraftButton.addEventListener("click", clearDraft);

loadState();
render();

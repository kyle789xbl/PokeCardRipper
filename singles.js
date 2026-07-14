const FIREBASE_DB_URL = "https://arcadescores-9b4f7-default-rtdb.firebaseio.com";
const SINGLES_PATH = "singles";
const SEARCH_LIMIT = 24;
const ADMIN_EMAIL = "kyle789xbl@gmail.com";
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
  singles: [],
  selectedTier: clampTier(localStorage.getItem("singles-tier") ?? 1),
  isLoadingCards: false,
  currentUser: null,
  isAdmin: false,
  loadPromise: null,
};

const tcgdex = new TCGdex("en");

const els = {
  loadCardsButton: document.querySelector("#loadCardsButton"),
  refreshButton: document.querySelector("#refreshButton"),
  adminLoginToggle: document.querySelector("#adminLoginToggle"),
  adminLoginModal: document.querySelector("#adminLoginModal"),
  closeAdminLogin: document.querySelector("#closeAdminLogin"),
  adminSummary: document.querySelector("#adminSummary"),
  adminEmail: document.querySelector("#adminEmail"),
  adminPassword: document.querySelector("#adminPassword"),
  adminGoogleSignInButton: document.querySelector("#adminGoogleSignInButton"),
  adminSignInButton: document.querySelector("#adminSignInButton"),
  adminAuthStatus: document.querySelector("#adminAuthStatus"),
  searchForm: document.querySelector("#searchForm"),
  searchInput: document.querySelector("#searchInput"),
  statusLine: document.querySelector("#statusLine"),
  resultsGrid: document.querySelector("#resultsGrid"),
  singlesList: document.querySelector("#singlesList"),
  rotationSummary: document.querySelector("#rotationSummary"),
  tierButtons: document.querySelectorAll(".tier-button"),
  tierDescription: document.querySelector("#tierDescription"),
  cardResultTemplate: document.querySelector("#cardResultTemplate"),
};

let firebaseAuth = null;
const FIREBASE_APP_SDK = "https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js";
const FIREBASE_AUTH_SDK = "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth-compat.js";

function firebaseUrl(path) {
  return `${FIREBASE_DB_URL}/${path}.json`;
}

async function authedFirebaseUrl(path) {
  const currentUser = firebaseAuth?.currentUser;
  if (!currentUser) return firebaseUrl(path);
  const token = await currentUser.getIdToken();
  return `${firebaseUrl(path)}?auth=${encodeURIComponent(token)}`;
}

function firebaseKey(cardId) {
  return String(cardId).replace(/[.#$/[\]]/g, "_");
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
    (a.setOrder ?? Number.MAX_SAFE_INTEGER) - (b.setOrder ?? Number.MAX_SAFE_INTEGER) ||
    localIdSortValue(a.localId) - localIdSortValue(b.localId) ||
    String(a.localId).localeCompare(String(b.localId), undefined, { numeric: true }) ||
    String(a.name).localeCompare(String(b.name))
  );
}

async function fetchCardDetails(cardId) {
  const response = await fetch(`https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(cardId)}`);
  if (!response.ok) throw new Error(`Could not load card details for ${cardId}`);
  return response.json();
}

function isRareCard(card) {
  const rarity = normalize(card?.rarity);
  const variants = card?.variants ?? {};
  return (
    rarity.includes("rare") ||
    rarity.includes("ultra") ||
    rarity.includes("secret") ||
    rarity.includes("rainbow") ||
    rarity.includes("amazing") ||
    rarity.includes("shiny") ||
    variants.holo === true ||
    variants.firstEdition === true
  );
}

async function loadCards() {
  if (!requireAdmin()) return [];
  if (state.allCards.length) return state.allCards;
  if (state.loadPromise) return state.loadPromise;

  state.isLoadingCards = true;
  els.loadCardsButton.disabled = true;
  els.statusLine.textContent = "Loading TCGdex card index...";

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
    els.statusLine.textContent = `Loaded ${state.allCards.length.toLocaleString()} cards. Search by name or card ID.`;
    return state.allCards;
  })();

  try {
    return await state.loadPromise;
  } catch (error) {
    console.error(error);
    els.statusLine.textContent = "Could not load cards from TCGdex. Check your connection and try again.";
    els.loadCardsButton.disabled = false;
    return [];
  } finally {
    state.isLoadingCards = false;
    state.loadPromise = null;
  }
}

async function searchCards(query) {
  if (!state.allCards.length) await loadCards();
  const term = normalize(query);

  if (!term) {
    els.statusLine.textContent = `Loaded ${state.allCards.length.toLocaleString()} cards. Type a search to filter.`;
    els.resultsGrid.replaceChildren();
    return;
  }

  const results = state.allCards
    .filter((card) => `${card.name} ${card.id} ${card.localId} ${card.setName}`.toLowerCase().includes(term))
    .sort(compareCardsByRelease)
    .slice(0, SEARCH_LIMIT);

  els.statusLine.textContent = `${results.length} result${results.length === 1 ? "" : "s"} shown for "${query}".`;
  renderResults(results);
}

function renderResults(cards) {
  els.resultsGrid.replaceChildren();
  const fragment = document.createDocumentFragment();

  cards.forEach((card) => {
    const node = els.cardResultTemplate.content.firstElementChild.cloneNode(true);
    const image = node.querySelector("img");
    const title = node.querySelector("h3");
    const meta = node.querySelector("p");
    const quantity = node.querySelector("input");
    const button = node.querySelector("button");

    image.alt = `${card.name} card image`;
    applyImageFallback(image, card);
    title.textContent = card.name;
    meta.textContent = `${card.setName} - ${card.id} - Local ID ${card.localId}`;
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "Saving...";
      try {
        await saveSingle(card, Number(quantity.value));
      } catch (error) {
        console.error(error);
        els.statusLine.textContent = error.message;
      } finally {
        button.disabled = false;
        button.textContent = "Add single";
      }
    });
    fragment.append(node);
  });

  els.resultsGrid.append(fragment);
}

async function saveSingle(card, quantity = 1) {
  if (!requireAdmin()) return;
  const safeQuantity = Math.max(1, Number.isFinite(quantity) ? quantity : 1);
  const key = firebaseKey(card.id);
  const existing = state.singles.find((single) => single.key === key);
  const details = await fetchCardDetails(card.id);
  const variant = chooseDisplayVariant(details);
  const price = getEstimatedPrice(details, variant);
  const safeTier = getTierFromPrice(price.value);
  const payload = existing
    ? {
        ...existing,
        variant,
        price,
        tier: safeTier,
        quantity: Number(existing.quantity) + safeQuantity,
        updatedAt: new Date().toISOString(),
      }
    : {
        key,
        cardId: card.id,
        localId: card.localId,
        name: card.name,
        image: card.image,
        setName: card.setName,
        setId: card.setId,
        setOrder: card.setOrder,
        rarity: details?.rarity ?? "Unknown",
        isRare: isRareCard(details),
        variants: details?.variants ?? {},
        variant,
        price,
        tier: safeTier,
        quantity: safeQuantity,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

  const response = await fetch(await authedFirebaseUrl(`${SINGLES_PATH}/${key}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Could not save single. Admin access is required.");
  await loadSingles();
}

function clampTier(tier) {
  const number = Number(tier);
  return Number.isInteger(number) && number >= 1 && number <= 4 ? number : 1;
}

function getTierFromPrice(value) {
  const price = Number(value);
  if (!Number.isFinite(price)) return 1;
  if (price >= 50) return 4;
  if (price >= 15) return 3;
  if (price >= 3) return 2;
  return 1;
}

function chooseDisplayVariant(card) {
  const variants = card?.variants_detailed ?? [];
  if (!variants.length) return null;

  const desiredType = card?.variants?.normal ? "normal" : card?.variants?.holo ? "holo" : variants[0]?.type;

  return [...variants].sort((a, b) => {
    return (
      variantScore(a, desiredType) - variantScore(b, desiredType) ||
      String(a.variantId).localeCompare(String(b.variantId))
    );
  })[0];
}

function variantScore(variant, desiredType) {
  let score = 0;
  if (variant.type !== desiredType) score += 20;
  if (variant.size !== "standard") score += 10;
  if (variant.stamp?.includes("1st-edition")) score += 8;
  if (variant.subtype && variant.subtype !== "unlimited") score += 4;
  return score;
}

function getEstimatedPrice(card, variant = null) {
  const candidates = [];
  collectPricingCandidates(variant?.pricing, candidates);
  collectPricingCandidates(card?.pricing, candidates, variant);

  const best = candidates
    .filter((candidate) => Number.isFinite(candidate.value))
    .sort((a, b) => a.priority - b.priority || b.value - a.value)[0];

  return best ?? {
    value: null,
    unit: "USD",
    source: "No market price",
    label: "No market price",
  };
}

function collectPricingCandidates(pricing, candidates, variant = null) {
  if (!pricing) return;

  const tcgplayer = pricing.tcgplayer ?? {};
  const allowedKeys = getTcgplayerKeysForVariant(variant);
  Object.entries(tcgplayer).forEach(([variant, prices]) => {
    if (allowedKeys.length && !allowedKeys.includes(variant)) return;
    if (!prices || typeof prices !== "object") return;
    addPriceCandidate(candidates, prices.marketPrice, "USD", `TCGplayer ${variant} market`, 1);
    addPriceCandidate(candidates, prices.midPrice, "USD", `TCGplayer ${variant} mid`, 2);
    addPriceCandidate(candidates, prices.lowPrice, "USD", `TCGplayer ${variant} low`, 3);
  });

  const cardmarket = pricing.cardmarket ?? {};
  if (variant?.type === "holo" || variant?.type === "reverse") {
    addPriceCandidate(candidates, cardmarket["trend-holo"], "EUR", "Cardmarket holo trend", 4);
    addPriceCandidate(candidates, cardmarket["avg-holo"], "EUR", "Cardmarket holo avg", 5);
  }
  addPriceCandidate(candidates, cardmarket.trend, "EUR", "Cardmarket trend", 6);
  addPriceCandidate(candidates, cardmarket.avg, "EUR", "Cardmarket avg", 7);
  addPriceCandidate(candidates, cardmarket.low, "EUR", "Cardmarket low", 8);
}

function getTcgplayerKeysForVariant(variant) {
  if (!variant) return [];

  const prefix = variant.stamp?.includes("1st-edition") ? "1st-edition-" : "unlimited-";
  if (variant.type === "holo") return [`${prefix}holofoil`, "holofoil"];
  if (variant.type === "reverse") return ["reverse-holofoil", `${prefix}reverse-holofoil`];
  return [`${prefix}normal`, "normal"];
}

function addPriceCandidate(candidates, value, unit, source, priority) {
  const number = Number(value);
  if (!Number.isFinite(number)) return;
  candidates.push({
    value: number,
    unit,
    source,
    priority,
    label: `${unit} ${number.toFixed(2)} (${source})`,
  });
}

function filteredSingles() {
  return state.singles.filter((card) => clampTier(card.tier) === state.selectedTier);
}

async function loadSingles() {
  if (!requireAdmin()) return;
  const response = await fetch(await authedFirebaseUrl(SINGLES_PATH));
  if (!response.ok) throw new Error("Could not load Firebase singles.");
  const data = await response.json();
  state.singles = Object.entries(data ?? {})
    .map(([key, card]) => ({ ...card, key }))
    .sort(compareCardsByRelease);
  renderSingles();
}

async function updateSingleQuantity(key, direction) {
  if (!requireAdmin()) return;
  const single = state.singles.find((card) => card.key === key);
  if (!single) return;

  const quantity = Number(single.quantity) + direction;
  if (quantity <= 0) {
    await deleteSingle(key);
    return;
  }

  const response = await fetch(await authedFirebaseUrl(`${SINGLES_PATH}/${key}/quantity`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(quantity),
  });
  if (!response.ok) throw new Error("Could not update quantity. Admin access is required.");
  await loadSingles();
}

async function refreshSinglePricing(key) {
  if (!requireAdmin()) return;
  const single = state.singles.find((card) => card.key === key);
  if (!single) return;

  const details = await fetchCardDetails(single.cardId);
  const variant = chooseDisplayVariant(details);
  const price = getEstimatedPrice(details, variant);
  const tier = getTierFromPrice(price.value);

  const response = await fetch(await authedFirebaseUrl(`${SINGLES_PATH}/${key}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      variant,
      price,
      tier,
      updatedAt: new Date().toISOString(),
    }),
  });
  if (!response.ok) throw new Error("Could not refresh pricing. Admin access is required.");
  await loadSingles();
}

async function deleteSingle(key) {
  if (!requireAdmin()) return;
  const response = await fetch(await authedFirebaseUrl(`${SINGLES_PATH}/${key}`), { method: "DELETE" });
  if (!response.ok) throw new Error("Could not delete single. Admin access is required.");
  await loadSingles();
}

function requireAdmin() {
  if (state.isAdmin) return true;
  openAdminGate("Sign in as Kyle789XBL@gmail.com to edit the rotation database.");
  return false;
}

function openAdminGate(message = "Admin login required.") {
  els.adminAuthStatus.textContent = message;
  els.adminLoginModal.classList.remove("hidden");
}

function closeAdminGate() {
  if (state.isAdmin) els.adminLoginModal.classList.add("hidden");
}

function renderAdmin() {
  const email = state.currentUser?.email ?? "Not signed in.";
  els.adminSummary.innerHTML = `
    <strong>${escapeHtml(email)}</strong>
    <span>${state.isAdmin ? "Add Cards access confirmed" : "Kyle789XBL@gmail.com required"}</span>
  `;
  els.loadCardsButton.disabled = !state.isAdmin || state.isLoadingCards;
  els.refreshButton.disabled = !state.isAdmin;
  els.searchInput.disabled = !state.isAdmin;
  els.searchForm.querySelector("button").disabled = !state.isAdmin;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing?.dataset.loaded === "true") {
      resolve();
      return;
    }
    const script = existing ?? document.createElement("script");
    script.src = src;
    script.async = false;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    if (!existing) document.head.append(script);
  });
}

async function ensureFirebaseSdk() {
  if (!window.firebase) await loadScript(FIREBASE_APP_SDK);
  if (!window.firebase?.auth) await loadScript(FIREBASE_AUTH_SDK);
}

async function initFirebaseAuth() {
  if (!window.FIREBASE_CONFIG?.apiKey) {
    renderAdmin();
    openAdminGate("Firebase config is required. Fill firebase-config.js before using admin tools.");
    return;
  }

  try {
    await ensureFirebaseSdk();
    if (!window.firebase.apps.length) window.firebase.initializeApp(window.FIREBASE_CONFIG);
    firebaseAuth = window.firebase.auth();
    firebaseAuth.onAuthStateChanged(async (user) => {
      state.currentUser = user;
      state.isAdmin = false;
      if (!user) {
        renderAdmin();
        openAdminGate("Sign in as Kyle789XBL@gmail.com.");
        return;
      }

      state.isAdmin = normalize(user.email) === ADMIN_EMAIL;
      renderAdmin();
      if (!state.isAdmin) {
        openAdminGate("This Firebase account cannot add cards. Sign in as Kyle789XBL@gmail.com.");
        return;
      }

      els.adminAuthStatus.textContent = "Add Cards access confirmed.";
      closeAdminGate();
      loadSingles().catch((error) => {
        console.error(error);
        els.singlesList.textContent = "Could not load Firebase singles. Check rules and database URL.";
      });
    });
  } catch (error) {
    renderAdmin();
    openAdminGate(`Firebase Auth unavailable: ${error.message}`);
  }
}

async function signInAdmin() {
  if (!firebaseAuth) {
    els.adminAuthStatus.textContent = "Firebase Auth is required. Add your real Firebase web config first.";
    return;
  }

  const email = els.adminEmail.value.trim();
  const password = els.adminPassword.value;
  if (!email || !password) {
    els.adminAuthStatus.textContent = "Email and password are required.";
    return;
  }

  try {
    els.adminAuthStatus.textContent = "Signing in...";
    await firebaseAuth.signInWithEmailAndPassword(email, password);
  } catch (error) {
    els.adminAuthStatus.textContent = error.message;
  }
}

async function signInAdminWithGoogle() {
  if (!firebaseAuth || !window.firebase?.auth?.GoogleAuthProvider) {
    els.adminAuthStatus.textContent = "Google sign-in needs Firebase Auth to load first.";
    return;
  }

  try {
    els.adminAuthStatus.textContent = "Opening Google sign-in...";
    const provider = new window.firebase.auth.GoogleAuthProvider();
    provider.addScope("email");
    provider.setCustomParameters({ prompt: "select_account" });
    await firebaseAuth.signInWithPopup(provider);
  } catch (error) {
    if (error.code === "auth/popup-blocked" || error.code === "auth/cancelled-popup-request") {
      const provider = new window.firebase.auth.GoogleAuthProvider();
      provider.addScope("email");
      provider.setCustomParameters({ prompt: "select_account" });
      await firebaseAuth.signInWithRedirect(provider);
      return;
    }
    els.adminAuthStatus.textContent = error.message;
  }
}

function renderSingles() {
  els.singlesList.replaceChildren();
  const singles = filteredSingles();
  const total = singles.reduce((sum, card) => sum + Number(card.quantity), 0);
  els.rotationSummary.textContent = `${total} total cards across ${singles.length} Tier ${state.selectedTier} singles.`;
  els.tierDescription.textContent = `Viewing Tier ${state.selectedTier} singles. New cards are tiered automatically from market pricing.`;
  els.tierButtons.forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.tier) === state.selectedTier);
  });

  if (!singles.length) {
    els.singlesList.textContent = `No Tier ${state.selectedTier} singles in Firebase yet.`;
    els.singlesList.classList.add("empty-state");
    return;
  }

  els.singlesList.classList.remove("empty-state");
  const fragment = document.createDocumentFragment();

  singles.forEach((card) => {
    const article = document.createElement("article");
    article.className = "rotation-card";
    article.innerHTML = `
      <img alt="${escapeHtml(card.name)} card image">
      <div>
        <h3>${escapeHtml(card.name)}</h3>
        <p>${escapeHtml(card.setName)} - ${escapeHtml(card.cardId)}</p>
        <p>${escapeHtml(card.rarity ?? "Unknown rarity")}</p>
        <p>${escapeHtml(formatVariant(card.variant))}</p>
        <p>${escapeHtml(formatPrice(card.price))}</p>
        <p><span class="quantity-pill">${card.quantity}</span> in rotation - Tier ${clampTier(card.tier)}</p>
        <div class="rotation-controls">
          <button class="small-button ghost-button" type="button" data-action="minus">-</button>
          <button class="small-button ghost-button" type="button" data-action="plus">+</button>
          <button class="small-button ghost-button" type="button" data-action="refresh">Refresh price</button>
          <button class="small-button danger-button" type="button" data-action="delete">Delete</button>
        </div>
      </div>
    `;

    article.querySelector('[data-action="minus"]').addEventListener("click", () => updateSingleQuantity(card.key, -1));
    article.querySelector('[data-action="plus"]').addEventListener("click", () => updateSingleQuantity(card.key, 1));
    article.querySelector('[data-action="refresh"]').addEventListener("click", () => refreshSinglePricing(card.key));
    article.querySelector('[data-action="delete"]').addEventListener("click", () => deleteSingle(card.key));
    applyImageFallback(article.querySelector("img"), card);
    fragment.append(article);
  });

  els.singlesList.append(fragment);
}

function formatPrice(price) {
  if (!price || !Number.isFinite(Number(price.value))) return "No market price";
  return `${price.unit} ${Number(price.value).toFixed(2)} - ${price.source}`;
}

function formatVariant(variant) {
  if (!variant) return "Default display variant";
  const stamp = Array.isArray(variant.stamp) && variant.stamp.length ? ` - ${variant.stamp.join(", ")}` : "";
  const subtype = variant.subtype ? ` - ${variant.subtype}` : "";
  return `${variant.type ?? "variant"}${subtype}${stamp}`;
}

els.loadCardsButton.addEventListener("click", loadCards);
els.refreshButton.addEventListener("click", loadSingles);
els.adminLoginToggle.addEventListener("click", () => {
  renderAdmin();
  els.adminLoginModal.classList.remove("hidden");
});
els.closeAdminLogin.addEventListener("click", closeAdminGate);
els.adminLoginModal.addEventListener("click", (event) => {
  if (event.target === els.adminLoginModal) closeAdminGate();
});
els.adminSignInButton.addEventListener("click", signInAdmin);
els.adminGoogleSignInButton.addEventListener("click", signInAdminWithGoogle);
els.tierButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.selectedTier = clampTier(button.dataset.tier);
    localStorage.setItem("singles-tier", state.selectedTier);
    renderSingles();
  });
});

els.searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  searchCards(els.searchInput.value);
});

els.searchInput.addEventListener("input", () => {
  if (els.searchInput.value.trim().length >= 3) {
    searchCards(els.searchInput.value);
  }
});

renderAdmin();
initFirebaseAuth();

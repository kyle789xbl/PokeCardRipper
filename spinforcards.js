const FIREBASE_DB_URL = "https://arcadescores-9b4f7-default-rtdb.firebaseio.com";
const SINGLES_PATH = "singles";
const USERS_PATH = "users";
const FALLBACK_SPIN_DURATION_MS = 2200;
const SPIN_TICK_MS = 72;
const DEFAULT_DEMO_CREDITS = 10;
const USER_KEY = "tcgrip-user";
const ADDRESS_KEY = "tcgrip-postage-address";
const ADMIN_EMAIL = "kyle789xbl@gmail.com";
const TIER_COSTS = {
  1: 5,
  2: 10,
  3: 100,
  4: 1000,
};

const state = {
  rotationCards: [],
  selectedTier: clampTier(localStorage.getItem("spinforcards-tier") ?? 1),
  discount: Number(localStorage.getItem("spinforcards-discount") ?? 0),
  credits: Number(localStorage.getItem("spinforcards-credits") ?? DEFAULT_DEMO_CREDITS),
  previousPulls: loadJson("spinforcards-previous-pulls", []),
  pullTab: "kept",
  user: null,
  address: loadJson(ADDRESS_KEY, null),
  currentPull: null,
  currentPullLogId: null,
  isSpinning: false,
  authReady: false,
};

const els = {
  rotationToggle: document.querySelector("#rotationToggle"),
  addCardsLink: document.querySelector("#addCardsLink"),
  rotationDrawer: document.querySelector("#rotationDrawer"),
  closeRotation: document.querySelector("#closeRotation"),
  previousToggle: document.querySelector("#previousToggle"),
  previousDrawer: document.querySelector("#previousDrawer"),
  closePrevious: document.querySelector("#closePrevious"),
  previousList: document.querySelector("#previousList"),
  pullTabs: document.querySelectorAll(".pull-tab"),
  termsToggle: document.querySelector("#termsToggle"),
  termsModal: document.querySelector("#termsModal"),
  closeTerms: document.querySelector("#closeTerms"),
  accountToggle: document.querySelector("#accountToggle"),
  accountModal: document.querySelector("#accountModal"),
  closeAccount: document.querySelector("#closeAccount"),
  accountSummary: document.querySelector("#accountSummary"),
  loginEmail: document.querySelector("#loginEmail"),
  loginPassword: document.querySelector("#loginPassword"),
  authFields: document.querySelectorAll(".auth-field"),
  googleSignInButton: document.querySelector("#googleSignInButton"),
  signInButton: document.querySelector("#signInButton"),
  createAccountButton: document.querySelector("#createAccountButton"),
  logoutButton: document.querySelector("#logoutButton"),
  authStatus: document.querySelector("#authStatus"),
  addressSearch: document.querySelector("#addressSearch"),
  findAddressButton: document.querySelector("#findAddressButton"),
  addressResults: document.querySelector("#addressResults"),
  shipName: document.querySelector("#shipName"),
  addressLine1: document.querySelector("#addressLine1"),
  addressLine2: document.querySelector("#addressLine2"),
  addressCity: document.querySelector("#addressCity"),
  addressPostcode: document.querySelector("#addressPostcode"),
  addressCountry: document.querySelector("#addressCountry"),
  saveAddressButton: document.querySelector("#saveAddressButton"),
  addressStatus: document.querySelector("#addressStatus"),
  creditsToggle: document.querySelector("#creditsToggle"),
  creditsModal: document.querySelector("#creditsModal"),
  closeCredits: document.querySelector("#closeCredits"),
  creditsCount: document.querySelector("#creditsCount"),
  modalCreditsCount: document.querySelector("#modalCreditsCount"),
  creditTrack: document.querySelector(".credit-track"),
  creditPrev: document.querySelector("#creditPrev"),
  creditNext: document.querySelector("#creditNext"),
  creditPacks: document.querySelectorAll(".credit-pack"),
  selectedPackText: document.querySelector("#selectedPackText"),
  mockCheckoutButton: document.querySelector("#mockCheckoutButton"),
  ageGate: document.querySelector("#ageGate"),
  confirmAge: document.querySelector("#confirmAge"),
  rotationCount: document.querySelector("#rotationCount"),
  poolSummary: document.querySelector("#poolSummary"),
  rotationList: document.querySelector("#rotationList"),
  reel: document.querySelector("#reel"),
  discountValue: document.querySelector("#discountValue"),
  spinButton: document.querySelector("#spinButton"),
  resultPanel: document.querySelector("#resultPanel"),
  resultName: document.querySelector("#resultName"),
  resultMeta: document.querySelector("#resultMeta"),
  postPullActions: document.querySelector("#postPullActions"),
  hudCardName: document.querySelector("#hudCardName"),
  hudSetName: document.querySelector("#hudSetName"),
  hudTier: document.querySelector("#hudTier"),
  hudPrice: document.querySelector("#hudPrice"),
  burnButton: document.querySelector("#burnButton"),
  keepButton: document.querySelector("#keepButton"),
  tierButtons: document.querySelectorAll(".tier-button"),
  randomizerSound: document.querySelector("#randomizerSound"),
  rareOverlay: document.querySelector("#rareOverlay"),
  rareImage: document.querySelector("#rareImage"),
  rareName: document.querySelector("#rareName"),
  rareLineOne: document.querySelector("#rareLineOne"),
  rareLineTwo: document.querySelector("#rareLineTwo"),
};

let selectedCreditPack = null;
let firebaseAuth = null;
const FIREBASE_APP_SDK = "https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js";
const FIREBASE_AUTH_SDK = "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth-compat.js";
const POSTCODES_IO_URL = "https://api.postcodes.io/postcodes";

function firebaseUrl(path) {
  return `${FIREBASE_DB_URL}/${path}.json`;
}

async function authedFirebaseUrl(path) {
  const currentUser = firebaseAuth?.currentUser;
  if (!currentUser) return firebaseUrl(path);
  const token = await currentUser.getIdToken();
  return `${firebaseUrl(path)}?auth=${encodeURIComponent(token)}`;
}

function loadJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function getEffectLayers() {
  return Array.from(els.reel.querySelectorAll(".reel-flash, .burst, .spark-field"));
}

async function fetchRotation() {
  if (!canUseApp()) return;
  const response = await fetch(await authedFirebaseUrl(SINGLES_PATH));
  if (!response.ok) throw new Error("Could not load Firebase singles.");
  const data = await response.json();
  state.rotationCards = Object.entries(data ?? {})
    .map(([key, card]) => ({ ...card, key }))
    .filter((card) => Number(card.quantity) > 0)
    .sort(compareCardsByRelease);
  render();
}

async function updateFirebaseQuantity(card, quantity) {
  let response;
  if (quantity <= 0) {
    response = await fetch(await authedFirebaseUrl(`${SINGLES_PATH}/${card.key}`), { method: "DELETE" });
    if (!response.ok) throw new Error("Could not update Firebase inventory.");
    return;
  }

  response = await fetch(await authedFirebaseUrl(`${SINGLES_PATH}/${card.key}/quantity`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(quantity),
  });
  if (!response.ok) throw new Error("Could not update Firebase inventory.");
}

async function saveUserAddressToFirebase() {
  if (!isSignedIn()) return false;
  const response = await fetch(await authedFirebaseUrl(`${USERS_PATH}/${state.user.uid}/postageAddress`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...state.address, updatedAt: new Date().toISOString() }),
  });
  return response.ok;
}

async function loadUserAddressFromFirebase(uid) {
  const response = await fetch(await authedFirebaseUrl(`${USERS_PATH}/${uid}/postageAddress`));
  if (!response.ok) return;
  const address = await response.json();
  if (!address) return;
  state.address = address;
  localStorage.setItem(ADDRESS_KEY, JSON.stringify(state.address));
  renderAccount();
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

function localIdSortValue(localId = "") {
  const number = Number.parseInt(String(localId).match(/\d+/)?.[0] ?? "", 10);
  return Number.isFinite(number) ? number : Number.MAX_SAFE_INTEGER;
}

function compareCardsByRelease(a, b) {
  return (
    (a.setOrder ?? Number.MAX_SAFE_INTEGER) - (b.setOrder ?? Number.MAX_SAFE_INTEGER) ||
    localIdSortValue(a.localId) - localIdSortValue(b.localId) ||
    String(a.localId).localeCompare(String(b.localId), undefined, { numeric: true }) ||
    String(a.name).localeCompare(String(b.name))
  );
}

function clampTier(tier) {
  const number = Number(tier);
  return Number.isInteger(number) && number >= 1 && number <= 4 ? number : 1;
}

function filteredRotationCards() {
  return state.rotationCards.filter((card) => clampTier(card.tier) === state.selectedTier);
}

function selectedTierCost() {
  return TIER_COSTS[state.selectedTier] ?? TIER_COSTS[1];
}

function totalQuantity() {
  return filteredRotationCards().reduce((total, card) => total + Number(card.quantity), 0);
}

function pickWeightedCard() {
  const total = totalQuantity();
  if (!total) return null;

  let ticket = Math.floor(Math.random() * total);
  for (const card of filteredRotationCards()) {
    ticket -= Number(card.quantity);
    if (ticket < 0) return card;
  }

  return filteredRotationCards().at(-1) ?? null;
}

function renderSpinCard(card, options = {}) {
  const effectLayers = getEffectLayers();
  els.reel.replaceChildren(...effectLayers);
  if (!card) {
    const placeholder = document.createElement("div");
    placeholder.className = "reel-placeholder";
    placeholder.textContent = `Add Tier ${state.selectedTier} singles in the database to start spinning.`;
    els.reel.append(placeholder);
    return;
  }

  const cardNode = document.createElement("div");
  cardNode.className = `spin-card${options.reveal ? " is-final-card" : ""}`;
  cardNode.innerHTML = `
    <img alt="${escapeHtml(card.name)} card image">
  `;
  applyImageFallback(cardNode.querySelector("img"), card);
  els.reel.append(cardNode);
}

function getSoundDurationMs() {
  const audio = els.randomizerSound;
  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    return Math.round(audio.duration * 1000);
  }

  return new Promise((resolve) => {
    const finish = () => {
      cleanup();
      const duration = Number.isFinite(audio.duration) && audio.duration > 0
        ? Math.round(audio.duration * 1000)
        : FALLBACK_SPIN_DURATION_MS;
      resolve(duration);
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      audio.removeEventListener("loadedmetadata", finish);
      audio.removeEventListener("durationchange", finish);
    };
    const timeout = window.setTimeout(finish, 900);
    audio.addEventListener("loadedmetadata", finish, { once: true });
    audio.addEventListener("durationchange", finish, { once: true });
    audio.load();
  });
}

function triggerRevealEffects() {
  els.reel.classList.remove("is-revealing");
  void els.reel.offsetWidth;
  els.reel.classList.add("is-revealing");
  window.setTimeout(() => els.reel.classList.remove("is-revealing"), 2200);
}

async function spin() {
  if (!canUseApp()) {
    openAccountGate(isSignedIn() ? "Save your postage address before ripping." : "Sign in before ripping.");
    return;
  }
  if (state.isSpinning || state.currentPull || !totalQuantity()) return;
  const ripCost = selectedTierCost();
  if (state.credits < ripCost) return;

  state.isSpinning = true;
  state.credits -= ripCost;
  localStorage.setItem("spinforcards-credits", state.credits);
  state.currentPull = null;
  els.resultName.textContent = "Ripping...";
  els.resultMeta.textContent = `Tier ${state.selectedTier} rip - ${ripCost} credits.`;
  els.postPullActions.classList.add("hidden");
  updateCardHud(null, "Ripping...");
  els.spinButton.disabled = true;
  els.reel.classList.add("is-spinning");
  const spinDuration = await getSoundDurationMs();

  try {
    els.randomizerSound.currentTime = 0;
    await els.randomizerSound.play();
  } catch {
    // User-gesture/audio policy can block this; the spin still works.
  }

  const spinStarted = Date.now();
  const tick = window.setInterval(() => renderSpinCard(pickWeightedCard()), SPIN_TICK_MS);

  window.setTimeout(() => {
    window.clearInterval(tick);
    const pulled = pickWeightedCard();
    state.currentPull = pulled;
    state.currentPullLogId = recordPreviousPull(pulled);
    renderSpinCard(pulled, { reveal: true });
    renderPullActions(pulled);
    triggerRevealEffects();
    if (pulled?.isRare) triggerRareReveal(pulled);
    state.isSpinning = false;
    els.reel.classList.remove("is-spinning");
    renderSummary();
  }, Math.max(700, spinDuration - (Date.now() - spinStarted)));
}

function renderPullActions(card) {
  if (!card) return;
  els.resultName.textContent = "Pull ready";
  els.resultMeta.textContent = `${card.name} - ${formatPrice(card.price)}`;
  els.postPullActions.classList.remove("hidden");
  updateCardHud(card);
  els.resultPanel.classList.remove("hidden");
}

function triggerRareReveal(card) {
  els.rareName.textContent = card.name;
  els.rareLineOne.textContent = "Rare pull detected";
  els.rareLineTwo.textContent = `${card.rarity ?? "Rare"} - ${card.setName}`;
  applyImageFallback(els.rareImage, card);

  els.rareOverlay.classList.remove("hidden", "is-hiding");
  els.rareOverlay.classList.add("is-showing");
  playRareSfx();

  window.setTimeout(() => els.rareOverlay.classList.add("is-hiding"), 3600);
  window.setTimeout(() => {
    els.rareOverlay.classList.add("hidden");
    els.rareOverlay.classList.remove("is-showing", "is-hiding");
  }, 4400);
}

function playRareSfx() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;

  const ctx = new AudioContext();
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, ctx.currentTime);
  master.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.05);
  master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 2.4);
  master.connect(ctx.destination);

  [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98, 2093].forEach((frequency, index) => {
    const start = ctx.currentTime + index * 0.14;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = index % 2 ? "triangle" : "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.045, start + 0.12);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.42, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(start);
    oscillator.stop(start + 0.26);
  });
}

function burnPull() {
  if (!state.currentPull) return;
  updatePullRecord(state.currentPullLogId, {
    status: "burned",
    shippingStatus: "Burned - no shipment",
    resolvedAt: new Date().toISOString(),
  });
  state.discount = Math.min(100, state.discount + 5);
  localStorage.setItem("spinforcards-discount", state.discount);
  clearPull();
  render();
}

async function keepPull() {
  if (!state.currentPull) return;
  const newQuantity = Number(state.currentPull.quantity) - 1;
  try {
    await updateFirebaseQuantity(state.currentPull, newQuantity);
  } catch {
    els.resultMeta.textContent = "Inventory update needs the secure rip backend.";
    return;
  }
  updatePullRecord(state.currentPullLogId, {
    status: "kept",
    shippingStatus: "Pending fulfillment",
    resolvedAt: new Date().toISOString(),
  });
  state.discount = 0;
  localStorage.setItem("spinforcards-discount", state.discount);
  clearPull();
  await fetchRotation();
}

function clearPull() {
  state.currentPull = null;
  state.currentPullLogId = null;
  els.resultName.textContent = "TCG RIP";
  els.resultMeta.textContent = `Tier ${state.selectedTier} selected - ${selectedTierCost()} credits per rip.`;
  els.postPullActions.classList.add("hidden");
  updateCardHud(null);
}

function isSignedIn() {
  return Boolean(firebaseAuth?.currentUser && state.user?.firebase);
}

function isAdminUser() {
  return normalize(state.user?.email) === ADMIN_EMAIL;
}

function hasPostageAddress() {
  return Boolean(
    state.address?.fullName &&
    state.address?.line1 &&
    state.address?.city &&
    state.address?.postcode &&
    state.address?.country
  );
}

function canUseApp() {
  return isSignedIn() && hasPostageAddress();
}

function openAccountGate(message = "Sign in to continue.") {
  document.body.classList.add("auth-locked");
  els.accountModal.classList.toggle("is-address-step", isSignedIn() && !hasPostageAddress());
  els.accountModal.classList.toggle("is-signed-in", isSignedIn());
  els.authStatus.textContent = message;
  els.accountModal.classList.remove("hidden");
}

function closeAccountGate() {
  if (!canUseApp()) return;
  document.body.classList.remove("auth-locked");
  els.accountModal.classList.remove("is-address-step");
  els.accountModal.classList.add("hidden");
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
    state.authReady = true;
    els.authStatus.textContent = "Firebase config is required. Fill firebase-config.js before this page can be used.";
    openAccountGate("Firebase login is required. Add firebase-config.js first.");
    renderSummary();
    return;
  }

  try {
    await ensureFirebaseSdk();
    if (!window.firebase.apps.length) window.firebase.initializeApp(window.FIREBASE_CONFIG);
    firebaseAuth = window.firebase.auth();
    firebaseAuth.onAuthStateChanged(async (user) => {
      state.authReady = true;
      if (!user) {
        state.user = null;
        state.address = null;
        localStorage.removeItem(USER_KEY);
        localStorage.removeItem(ADDRESS_KEY);
        renderAccount();
        renderSummary();
        openAccountGate("Sign in or create an account to use TCG RIP.");
        return;
      }

      state.user = {
        uid: user.uid,
        email: user.email,
        firebase: true,
      };
      state.address = null;
      localStorage.removeItem(ADDRESS_KEY);
      localStorage.setItem(USER_KEY, JSON.stringify(state.user));
      els.authStatus.textContent = "Signed in with Firebase.";
      await loadUserAddressFromFirebase(user.uid).catch(() => {
        els.addressStatus.textContent = "Could not load saved Firebase postage address.";
      });
      renderAccount();
      if (!hasPostageAddress()) {
        openAccountGate("Add your postage address before ripping.");
        els.addressStatus.textContent = "Your cards need somewhere to ship. Save postage to continue.";
        renderSummary();
        return;
      }

      closeAccountGate();
      fetchRotation().catch((error) => {
        console.error(error);
        renderSpinCard(null);
      });
    });
  } catch (error) {
    firebaseAuth = null;
    state.authReady = true;
    els.authStatus.textContent = `Firebase Auth unavailable: ${error.message}`;
    openAccountGate("Firebase Auth is unavailable. Check firebase-config.js.");
    renderSummary();
  }
}

async function signIn(mode) {
  if (!firebaseAuth) {
    els.authStatus.textContent = "Firebase Auth is required. Add your real Firebase web config first.";
    return;
  }

  const email = els.loginEmail.value.trim();
  const password = els.loginPassword.value;
  if (!email || !password) {
    els.authStatus.textContent = "Email and password are required.";
    return;
  }
  try {
    els.authStatus.textContent = mode === "create" ? "Creating Firebase account..." : "Signing in...";
    const credential = mode === "create"
      ? await firebaseAuth.createUserWithEmailAndPassword(email, password)
      : await firebaseAuth.signInWithEmailAndPassword(email, password);
    state.user = {
      uid: credential.user.uid,
      email: credential.user.email,
      firebase: true,
    };
    localStorage.setItem(USER_KEY, JSON.stringify(state.user));
    els.authStatus.textContent = "Firebase account connected.";
    renderAccount();
  } catch (error) {
    els.authStatus.textContent = error.message;
  }
}

async function signInWithGoogle() {
  if (!firebaseAuth || !window.firebase?.auth?.GoogleAuthProvider) {
    els.authStatus.textContent = "Google sign-in needs Firebase Auth to load first.";
    return;
  }

  try {
    els.authStatus.textContent = "Opening Google sign-in...";
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
    els.authStatus.textContent = error.message;
  }
}

async function logout() {
  if (!firebaseAuth) return;
  await firebaseAuth.signOut();
  state.user = null;
  state.address = null;
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(ADDRESS_KEY);
  renderAccount();
  renderSummary();
  openAccountGate("Signed out. Sign in to use TCG RIP.");
}

function fillAddressForm(address = {}) {
  const safeAddress = address ?? {};
  els.shipName.value = safeAddress.fullName ?? "";
  els.addressLine1.value = safeAddress.line1 ?? "";
  els.addressLine2.value = safeAddress.line2 ?? "";
  els.addressCity.value = safeAddress.city ?? "";
  els.addressPostcode.value = safeAddress.postcode ?? "";
  els.addressCountry.value = safeAddress.country ?? "United Kingdom";
}

function readAddressForm() {
  return {
    fullName: els.shipName.value.trim(),
    line1: els.addressLine1.value.trim(),
    line2: els.addressLine2.value.trim(),
    city: els.addressCity.value.trim(),
    postcode: els.addressPostcode.value.trim().toUpperCase(),
    country: els.addressCountry.value.trim() || "United Kingdom",
  };
}

function formatAddress(address) {
  if (!address) return "No postage address saved.";
  return [address.fullName, address.line1, address.line2, address.city, address.postcode, address.country]
    .filter(Boolean)
    .join(", ");
}

function normalizeLookupResult(result) {
  if (typeof result === "string") {
    return {
      label: result,
      fullName: els.shipName.value.trim(),
      line1: "",
      line2: "",
      city: "",
      postcode: result,
      country: "United Kingdom",
    };
  }

  return {
    label: result.label ?? result.summary ?? [result.line1, result.city, result.postcode].filter(Boolean).join(", "),
    fullName: els.shipName.value.trim(),
    line1: result.line1 ?? result.addressLine1 ?? result.thoroughfare ?? "",
    line2: result.line2 ?? result.addressLine2 ?? result.premise ?? "",
    city: result.city ?? result.town ?? result.postTown ?? "",
    postcode: result.postcode ?? result.postCode ?? "",
    country: result.country ?? "United Kingdom",
  };
}

function renderAddressResults(results) {
  if (!els.addressResults) return;
  els.addressResults.replaceChildren();
  if (!results.length) {
    els.addressResults.textContent = "No matches found. Enter the address manually.";
    els.addressResults.classList.add("empty-state");
    return;
  }

  els.addressResults.classList.remove("empty-state");
  results.slice(0, 8).forEach((rawResult) => {
    const result = normalizeLookupResult(rawResult);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "address-result";
    button.textContent = result.label;
    button.addEventListener("click", async () => {
      const fullResult = result.postcode ? await lookupPostcode(result.postcode).catch(() => result) : result;
      fillAddressForm({ ...result, ...fullResult });
      els.addressStatus.textContent = "Address selected. Check it, then save postage.";
    });
    els.addressResults.append(button);
  });
}

async function fetchConfiguredAddressLookup(query) {
  const endpoint = window.ADDRESS_LOOKUP_ENDPOINT;
  if (!endpoint) return null;
  const separator = endpoint.includes("?") ? "&" : "?";
  const response = await fetch(`${endpoint}${separator}query=${encodeURIComponent(query)}`);
  if (!response.ok) throw new Error("Configured address lookup failed.");
  const data = await response.json();
  return Array.isArray(data) ? data : data.results ?? data.addresses ?? [];
}

async function lookupPostcode(postcode) {
  const response = await fetch(`${POSTCODES_IO_URL}/${encodeURIComponent(postcode)}`);
  if (!response.ok) throw new Error("Postcode lookup failed.");
  const data = await response.json();
  const result = data.result ?? {};
  return {
    fullName: els.shipName.value.trim(),
    line1: els.addressLine1.value.trim(),
    line2: els.addressLine2.value.trim(),
    city: result.admin_district || result.parish || result.region || "",
    postcode: result.postcode ?? postcode,
    country: result.country ?? "United Kingdom",
    label: [result.postcode ?? postcode, result.admin_district, result.country].filter(Boolean).join(", "),
  };
}

async function searchPostcodes(query) {
  const autocomplete = await fetch(`${POSTCODES_IO_URL}/${encodeURIComponent(query)}/autocomplete`);
  if (autocomplete.ok) {
    const data = await autocomplete.json();
    if (Array.isArray(data.result) && data.result.length) return data.result;
  }

  const search = await fetch(`${POSTCODES_IO_URL}?q=${encodeURIComponent(query)}&limit=8`);
  if (!search.ok) return [];
  const data = await search.json();
  return (data.result ?? []).map((item) => ({
    label: [item.postcode, item.admin_district, item.country].filter(Boolean).join(", "),
    line1: "",
    line2: "",
    city: item.admin_district || item.parish || item.region || "",
    postcode: item.postcode,
    country: item.country ?? "United Kingdom",
  }));
}

async function findAddress() {
  if (!els.addressSearch) return;
  const query = els.addressSearch.value.trim();
  if (!query) {
    els.addressStatus.textContent = "Enter a postcode or address to search.";
    return;
  }

  els.addressStatus.textContent = "Searching address lookup...";
  try {
    const configuredResults = await fetchConfiguredAddressLookup(query);
    const results = configuredResults ?? await searchPostcodes(query);
    renderAddressResults(results);
    els.addressStatus.textContent = results.length
      ? "Select the postcode, then add street/address line 1 manually."
      : "No postcode matches. Enter the address manually.";
  } catch {
    if (els.addressResults) {
      els.addressResults.textContent = "Lookup failed. Enter the address manually.";
      els.addressResults.classList.add("empty-state");
    }
    els.addressStatus.textContent = "Enter the address manually.";
  }
}

async function saveAddress() {
  if (!isSignedIn()) {
    openAccountGate("Sign in before saving a postage address.");
    return;
  }

  const address = readAddressForm();
  if (!address.fullName || !address.line1 || !address.city || !address.postcode) {
    els.addressStatus.textContent = "Full name, address line 1, city, and postcode are required.";
    return;
  }

  state.address = address;
  const savedToFirebase = await saveUserAddressToFirebase().catch(() => false);
  if (!savedToFirebase) {
    els.addressStatus.textContent = "Could not save postage address to Firebase.";
    return;
  }

  localStorage.setItem(ADDRESS_KEY, JSON.stringify(state.address));
  els.addressStatus.textContent = "Postage address saved to Firebase.";
  renderAccount();
  closeAccountGate();
  fetchRotation().catch((error) => {
    console.error(error);
    renderSpinCard(null);
  });
}

function renderAccount() {
  const userLabel = state.user?.email ? state.user.email : "Not signed in.";
  const modeLabel = state.user?.firebase ? "Firebase account" : "Login required";
  els.accountModal.classList.toggle("is-signed-in", isSignedIn());
  els.accountSummary.innerHTML = `
    <strong>${state.user ? `Signed in as ${escapeHtml(userLabel)}` : escapeHtml(userLabel)}</strong>
    <span>${state.user ? modeLabel : "Create or sign in before ripping."}</span>
    <em>${escapeHtml(formatAddress(state.address))}</em>
  `;
  if (state.user?.email) els.loginEmail.value = state.user.email;
  els.loginEmail.disabled = isSignedIn();
  els.loginPassword.disabled = isSignedIn();
  els.authFields.forEach((field) => {
    field.classList.toggle("hidden", isSignedIn());
    field.hidden = isSignedIn();
  });
  els.googleSignInButton.classList.toggle("hidden", isSignedIn());
  els.signInButton.classList.toggle("hidden", isSignedIn());
  els.createAccountButton.classList.toggle("hidden", isSignedIn());
  els.logoutButton.classList.toggle("hidden", !isSignedIn());
  els.addCardsLink.classList.toggle("hidden", !isAdminUser());
  els.authStatus.textContent = isSignedIn()
    ? "You can edit and save your postage address anytime."
    : els.authStatus.textContent;
  fillAddressForm(state.address);
}

function recordPreviousPull(card) {
  if (!card) return null;
  const logId = `pull-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  state.previousPulls.unshift({
    id: logId,
    pulledAt: new Date().toISOString(),
    cardId: card.cardId,
    name: card.name,
    setName: card.setName,
    tier: clampTier(card.tier),
    price: card.price,
    variant: card.variant,
    image: card.image,
    status: "pending",
    shippingStatus: "Choose keep or burn",
  });
  state.previousPulls = state.previousPulls.slice(0, 25);
  localStorage.setItem("spinforcards-previous-pulls", JSON.stringify(state.previousPulls));
  return logId;
}

function updatePullRecord(id, changes) {
  if (!id) return;
  state.previousPulls = state.previousPulls.map((pull) => (
    pull.id === id ? { ...pull, ...changes } : pull
  ));
  localStorage.setItem("spinforcards-previous-pulls", JSON.stringify(state.previousPulls));
  renderPreviousPulls();
}

function renderRotation() {
  els.rotationList.replaceChildren();
  const cards = filteredRotationCards();
  const total = totalQuantity();
  els.poolSummary.textContent = `${cards.length} singles - ${total} total cards - Tier ${state.selectedTier} full pool`;

  if (!cards.length) {
    els.rotationList.textContent = `No Tier ${state.selectedTier} cards in rotation yet.`;
    els.rotationList.classList.add("empty-state");
    renderSpinCard(null);
    return;
  }

  els.rotationList.classList.remove("empty-state");
  const fragment = document.createDocumentFragment();

  cards.forEach((card) => {
    const article = document.createElement("article");
    article.className = "rotation-card";
    article.innerHTML = `
      <img alt="${escapeHtml(card.name)} card image">
      <div>
        <h3>${escapeHtml(card.name)}</h3>
        <p>${escapeHtml(card.setName)} - ${escapeHtml(card.cardId)}</p>
        <p>${escapeHtml(card.rarity ?? "Unknown rarity")}</p>
        <p>${escapeHtml(formatVariant(card.variant))}</p>
        <p>${escapeHtml(formatPriceWithSource(card.price))}</p>
        <p><span class="quantity-pill">${card.quantity}</span> remaining - ${formatProbability(card.quantity, total)}</p>
      </div>
    `;
    applyImageFallback(article.querySelector("img"), card);
    fragment.append(article);
  });

  els.rotationList.append(fragment);
  if (!state.isSpinning && !state.currentPull && !els.reel.querySelector(".spin-card")) {
    renderSpinCard(cards[0]);
  }
}

function renderPreviousPulls() {
  els.previousList.replaceChildren();
  els.pullTabs.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.pullTab === state.pullTab);
  });

  const pulls = filteredPullHistory();
  if (!pulls.length) {
    els.previousList.textContent = getEmptyPullMessage();
    els.previousList.classList.add("empty-state");
    return;
  }

  els.previousList.classList.remove("empty-state");
  const fragment = document.createDocumentFragment();
  pulls.forEach((card) => {
    const article = document.createElement("article");
    article.className = `rotation-card pull-card is-${getPullStatus(card)}`;
    article.innerHTML = `
      <img alt="${escapeHtml(card.name)} card image">
      <div>
        <div class="pull-card-head">
          <h3>${escapeHtml(card.name)}</h3>
          <span class="pull-status">${escapeHtml(formatPullStatus(card))}</span>
        </div>
        <p>${escapeHtml(card.setName)} - Tier ${clampTier(card.tier)}</p>
        <p>${escapeHtml(formatVariant(card.variant))}</p>
        <p>${escapeHtml(formatPriceWithSource(card.price))}</p>
        <p>${new Date(card.pulledAt).toLocaleString()}</p>
        ${state.pullTab === "shipping" ? `<p class="shipping-line">${escapeHtml(card.shippingStatus ?? "Pending fulfillment")}</p>` : ""}
      </div>
    `;
    applyImageFallback(article.querySelector("img"), card);
    fragment.append(article);
  });
  els.previousList.append(fragment);
}

function filteredPullHistory() {
  if (state.pullTab === "burned") {
    return state.previousPulls.filter((pull) => getPullStatus(pull) === "burned");
  }
  if (state.pullTab === "shipping") {
    return state.previousPulls.filter((pull) => getPullStatus(pull) === "kept");
  }
  return state.previousPulls.filter((pull) => {
    const status = getPullStatus(pull);
    return status === "kept" || status === "pending";
  });
}

function getPullStatus(pull) {
  return pull.status ?? "kept";
}

function formatPullStatus(pull) {
  const status = getPullStatus(pull);
  if (status === "burned") return "Burned";
  if (status === "pending") return "Pending";
  return "Kept";
}

function getEmptyPullMessage() {
  if (state.pullTab === "burned") return "No burned pulls yet.";
  if (state.pullTab === "shipping") return "No kept cards awaiting shipment yet.";
  return "No kept pulls yet.";
}

function formatPrice(price) {
  if (!price || !Number.isFinite(Number(price.value))) return "No market price";
  return `${price.unit} ${Number(price.value).toFixed(2)}`;
}

function formatPriceWithSource(price) {
  if (!price || !Number.isFinite(Number(price.value))) return "No market price";
  return `${price.unit} ${Number(price.value).toFixed(2)} - ${price.source ?? "market estimate"}`;
}

function formatProbability(quantity, total) {
  if (!total) return "0.00%";
  return `${((Number(quantity) / total) * 100).toFixed(2)}% chance`;
}

function formatVariant(variant) {
  if (!variant) return "Default display variant";
  const stamp = Array.isArray(variant.stamp) && variant.stamp.length ? ` - ${variant.stamp.join(", ")}` : "";
  const subtype = variant.subtype ? ` - ${variant.subtype}` : "";
  return `${variant.type ?? "variant"}${subtype}${stamp}`;
}

function renderSummary() {
  els.rotationCount.textContent = totalQuantity();
  els.creditsCount.textContent = state.credits;
  els.modalCreditsCount.textContent = state.credits;
  els.discountValue.textContent = `${state.discount}%`;
  els.spinButton.disabled = !canUseApp() || state.isSpinning || Boolean(state.currentPull) || totalQuantity() === 0 || state.credits < selectedTierCost();
  els.spinButton.classList.toggle("is-ready", !els.spinButton.disabled);
  if (!state.currentPull && !state.isSpinning) updateCardHud(null);
  els.tierButtons.forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.tier) === state.selectedTier);
  });
  els.addCardsLink.classList.toggle("hidden", !isAdminUser());
}

function updateCardHud(card, overrideName = null) {
  els.hudCardName.textContent = overrideName ?? card?.name ?? "Ready to rip";
  els.hudSetName.textContent = card ? `${card.setName} - ${card.cardId}` : `Tier ${state.selectedTier} selected`;
  els.hudTier.textContent = card ? clampTier(card.tier) : state.selectedTier;
  els.hudPrice.textContent = card ? formatPrice(card.price) : `${selectedTierCost()} credits`;
}

function render() {
  renderSummary();
  renderRotation();
  renderPreviousPulls();
}

els.rotationToggle.addEventListener("click", () => {
  const isOpen = els.rotationDrawer.classList.toggle("is-open");
  els.rotationToggle.setAttribute("aria-expanded", String(isOpen));
});

els.closeRotation.addEventListener("click", () => {
  els.rotationDrawer.classList.remove("is-open");
  els.rotationToggle.setAttribute("aria-expanded", "false");
});

els.previousToggle.addEventListener("click", () => {
  const isOpen = els.previousDrawer.classList.toggle("is-open");
  els.previousToggle.setAttribute("aria-expanded", String(isOpen));
});

els.closePrevious.addEventListener("click", () => {
  els.previousDrawer.classList.remove("is-open");
  els.previousToggle.setAttribute("aria-expanded", "false");
});

els.pullTabs.forEach((button) => {
  button.addEventListener("click", () => {
    state.pullTab = button.dataset.pullTab;
    renderPreviousPulls();
  });
});

els.termsToggle.addEventListener("click", () => els.termsModal.classList.remove("hidden"));
els.closeTerms.addEventListener("click", () => els.termsModal.classList.add("hidden"));
els.termsModal.addEventListener("click", (event) => {
  if (event.target === els.termsModal) els.termsModal.classList.add("hidden");
});

els.accountToggle.addEventListener("click", () => {
  renderAccount();
  els.accountModal.classList.remove("hidden");
});
els.closeAccount.addEventListener("click", closeAccountGate);
els.accountModal.addEventListener("click", (event) => {
  if (event.target === els.accountModal) closeAccountGate();
});
els.signInButton.addEventListener("click", () => signIn("sign-in"));
els.createAccountButton.addEventListener("click", () => signIn("create"));
els.googleSignInButton.addEventListener("click", signInWithGoogle);
els.logoutButton.addEventListener("click", logout);
els.loginPassword.addEventListener("keydown", (event) => {
  if (event.key === "Enter") signIn("sign-in");
});
if (els.findAddressButton) els.findAddressButton.addEventListener("click", findAddress);
if (els.addressSearch) {
  els.addressSearch.addEventListener("keydown", (event) => {
    if (event.key === "Enter") findAddress();
  });
}
els.saveAddressButton.addEventListener("click", saveAddress);

els.creditsToggle.addEventListener("click", () => els.creditsModal.classList.remove("hidden"));
els.closeCredits.addEventListener("click", () => els.creditsModal.classList.add("hidden"));
els.creditsModal.addEventListener("click", (event) => {
  if (event.target === els.creditsModal) els.creditsModal.classList.add("hidden");
});

els.creditPacks.forEach((pack) => {
  pack.addEventListener("click", () => {
    selectedCreditPack = {
      credits: Number(pack.dataset.credits),
      price: Number(pack.dataset.price),
      label: pack.querySelector("strong").textContent,
    };
    els.creditPacks.forEach((item) => item.classList.toggle("is-selected", item === pack));
    els.selectedPackText.textContent = `${selectedCreditPack.label} selected`;
    els.mockCheckoutButton.disabled = false;
  });
});

els.creditPrev.addEventListener("click", () => {
  els.creditTrack.scrollBy({ left: -260, behavior: "smooth" });
});

els.creditNext.addEventListener("click", () => {
  els.creditTrack.scrollBy({ left: 260, behavior: "smooth" });
});

els.mockCheckoutButton.addEventListener("click", () => {
  if (!selectedCreditPack) return;
  state.credits += selectedCreditPack.credits;
  localStorage.setItem("spinforcards-credits", state.credits);
  els.creditsModal.classList.add("hidden");
  renderSummary();
});

els.confirmAge.addEventListener("click", () => {
  localStorage.setItem("tcgrip-age-confirmed", "true");
  els.ageGate.classList.add("hidden");
});

els.spinButton.addEventListener("click", spin);
els.burnButton.addEventListener("click", burnPull);
els.keepButton.addEventListener("click", keepPull);
els.tierButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.selectedTier = clampTier(button.dataset.tier);
    localStorage.setItem("spinforcards-tier", state.selectedTier);
    clearPull();
    renderSpinCard(filteredRotationCards()[0] ?? null);
    render();
  });
});

renderAccount();
initFirebaseAuth();

if (localStorage.getItem("tcgrip-age-confirmed") !== "true") {
  els.ageGate.classList.remove("hidden");
}

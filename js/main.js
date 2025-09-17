let allItems = { tv: [], movies: [], series: [] };
var player = '';

// IndexedDB setup
const DB_NAME = 'iptvDB';
const STORE_NAME = 'm3u';
const KEY = 'playlist';

let CURRENT_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, CURRENT_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getM3UFromDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(KEY);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveM3UToDB(text) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(text, KEY);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

async function loadFromUrl(url) {
  const loadListPanel = document.getElementById('load-list-panel');
  const urlInput = document.getElementById('urlInput');
  const btnLoadList = document.getElementById('load-list');
  const status = document.getElementById('status')

  urlInput.disabled = true;
  btnLoadList.disabled = true;
  btnLoadList.textContent = 'Carregando...';
  status.textContent = '';

  try {
    let resp;
    try {
      resp = await fetch(url);
    } catch {
      resp = await fetch('https://corsproxy.io/?' + encodeURIComponent(url));
    }
    if (!resp.ok) throw new Error("HTTP " + resp.status);

    const text = await resp.text();
    parseM3U(text);

    await saveM3UToDB(text);
    localStorage.setItem('iptv_m3u_url', url);

    loadListPanel.classList.add('d-none');
    status.classList.add('d-none');
  } catch (e) {
    console.error(e);
    status.innerHTML = `
      <div class="alert alert-warning alert-dismissible fade show" role="alert">
        ⚠️ Algo inesperado aconteceu ao ao carregar playlist, acesse o log do console para mais detalhes.
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
      </div>`;
    status.classList.remove('d-none');
  } finally {
    urlInput.disabled = false;
    btnLoadList.disabled = false;
    btnLoadList.textContent = 'Atualizar Lista';

    toggleSettings();
  }
}

// Make loadFromUrl available globally for button onclick
window.loadFromUrl = loadFromUrl;

// Save and restore last active tab
function saveLastTab(tabId) {
  localStorage.setItem('iptv_last_tab', tabId);
}

function restoreLastTab() {
  const lastTab = localStorage.getItem('iptv_last_tab');
  if (lastTab) {
    const tabBtn = document.querySelector(`#tabs .nav-link[data-bs-target='${lastTab}']`);
    if (tabBtn) {
      new bootstrap.Tab(tabBtn).show();
    }
  }
}

// Save last viewed category for each section (TV, movies, series)
function saveLastCategory(section, category) {
  localStorage.setItem('iptv_last_cat_' + section, category);
}

// Restore last viewed category for a section, returns the category name or null
function getLastCategory(section) {
  return localStorage.getItem('iptv_last_cat_' + section);
}

// Initial load logic
window.addEventListener('DOMContentLoaded', async () => {
  const urlInput = document.getElementById('urlInput');
  const lastUrl = localStorage.getItem('iptv_m3u_url');

  toggleSettings();

  try {
    const cachedText = await getM3UFromDB();
    if (cachedText) {
      parseM3U(cachedText);
      if (lastUrl) urlInput.value = lastUrl;
      setupSearchListeners();
    } else if (lastUrl) {
      urlInput.value = lastUrl;
      await loadFromUrl(lastUrl);
      setupSearchListeners();
    } else {
      setupSearchListeners();
    }
  } catch (e) {
    toggleSettings();
    console.warn("IndexedDB fetch failed:", e);
    setupSearchListeners();
  }

  // Register tab listeners here
  const tabLinks = document.querySelectorAll('#tabs .nav-link[data-bs-toggle="tab"]');
  tabLinks.forEach(tab => {
    tab.addEventListener('shown.bs.tab', function(e) {
      const tabId = e.target.getAttribute('data-bs-target');
      if (tabId) saveLastTab(tabId);
    });
  });

  // Restore last tab after everything is ready
  restoreLastTab();
});

// Listen for tab changes and save the last active tab
const tabLinks = document.querySelectorAll('#tabs .nav-link[data-bs-toggle="tab"]');
tabLinks.forEach(tab => {
  tab.addEventListener('shown.bs.tab', function(e) {
    const tabId = e.target.getAttribute('data-bs-target');
    if (tabId) saveLastTab(tabId);
  });
});

function parseM3U(text) {
  allItems = { tv: [], movies: [], series: [] };

  let current = {};
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith('#EXTINF')) {
      const name = line.split(',').pop().trim();
      const tvgLogo = /tvg-logo="(.*?)"/.exec(line);
      const group = /group-title="(.*?)"/.exec(line);
      current = { name, logo: tvgLogo ? tvgLogo[1] : '', group: group ? group[1] : 'Outros' };
    } else if (line && !line.startsWith('#')) {
      current.url = line.trim();
      if (/series/i.test(current.url)) {
        allItems.series.push(current);
      } else if (/movie/i.test(current.url)) {
        allItems.movies.push(current);
      } else if (/.ts/i.test(current.url) || /.m3u8/i.test(current.url)) {
        current.baseName = getBaseChannelName(current.name); allItems.tv.push(current);
      }

      current = {};
    }
  }
  renderAll();
}

function getBaseChannelName(name) {
  if (!name) return '';
  let base = name.trim();
  base = base.replace(/\s*\[ALT\]$/i, '').trim();

  const quality = /(\s+(FHD|FULL ?HD|UHD|4K|HD|SD|1080P|720P))$/i;
  while(quality.test(base)) base = base.replace(quality, '').trim();
  return base;
}

function getVariantExtra(baseName, fullName) {
  if (!fullName) return '';
  const safeBase = baseName.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  let rest = fullName.replace(new RegExp('^'+safeBase, 'i'), '').trim();
  if (!rest) rest = 'Principal';
  return rest;
}

function getWatched() {
  return JSON.parse(localStorage.getItem('watchedEpisodes') || '[]');
}

function saveWatched(list) {
  localStorage.setItem('watchedEpisodes', JSON.stringify(list));
}

function toggleWatchedIcon(url, btn) {
  let watched = getWatched();
  const icon = btn.querySelector('i');

  if (watched.includes(url)) {
    watched = watched.filter(u => u !== url);

    icon.classList.replace('bi-eye-slash', 'bi-eye');
    btn.classList.replace('btn-success', 'btn-outline-light');
  } else {
    watched.push(url);

    icon.classList.replace('bi-eye', 'bi-eye-slash');
    btn.classList.replace('btn-outline-light', 'btn-success');
  }

  saveWatched(watched);
}

function toggleSettings() {
  const loadListPanel = document.getElementById('load-list-panel');
  const btnLoadList = document.getElementById('load-list');

  if (loadListPanel.classList.contains('d-none')) {
    loadListPanel.classList.remove('d-none');
  } else {
    loadListPanel.classList.add('d-none');
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }

  btnLoadList.focus();
}

function renderAll() {
  renderSection('tv', allItems.tv);
  renderSection('movies', allItems.movies);
  renderSection('series', allItems.series);
}

// --- Favorites logic start
function getFavorites() {
  return JSON.parse(localStorage.getItem('favorites') || '{}');
}

function saveFavorites(favorites) {
  localStorage.setItem('favorites', JSON.stringify(favorites));
}

function toggleFavorite(section, url, iconElement) {
  let favorites = getFavorites();
  if (!favorites[section]) {
    favorites[section] = [];
  }

  let isCurrentlyFavorite = false;

  if (section === 'tv') {
    const item = allItems.tv.find(i => i.url === url);
    if (item) {
      const favoriteUrlsForBase = allItems.tv.filter(i => i.baseName === item.baseName).map(i => i.url);

      isCurrentlyFavorite = favoriteUrlsForBase.some(favUrl => favorites.tv.includes(favUrl));
      if (isCurrentlyFavorite) {
        favorites.tv = favorites.tv.filter(favUrl => {
          const favItem = allItems.tv.find(i => i.url === favUrl);
          return favItem && favItem.baseName !== item.baseName;
        });
      } else {
        favorites.tv.push(url);
      }
    }
  } else {
    const index = favorites[section].indexOf(url);

    isCurrentlyFavorite = index > -1;
    if (isCurrentlyFavorite) {
      favorites[section].splice(index, 1);
    } else {
      favorites[section].push(url);
    }
  }

  saveFavorites(favorites);

  if (iconElement) {
    const isNowFavorite = isFavorite(section, url);
    iconElement.textContent = isNowFavorite ? '★' : '☆';

    const activeCatButton = document.querySelector(`#cat-list-${section} .list-group-item.active`);
    if (activeCatButton && activeCatButton.textContent.includes('Favoritos') && !isNowFavorite) {
      activeCatButton.click();
    }
  }
}

function isFavorite(section, url) {
  const favorites = getFavorites();
  if (!favorites[section]) return false;

  if (section === 'tv') {
    const item = allItems.tv.find(i => i.url === url);
    if (!item) return false;

    return favorites.tv.some(favUrl => {
      const favItem = allItems.tv.find(i => i.url === favUrl);
      return favItem && favItem.baseName === item.baseName;
    });
  }

  return favorites[section].includes(url);
}
// --- Favorites logic end

// Save last viewed category for each section (TV, movies, series)
function saveLastCategory(section, category) {
  localStorage.setItem('iptv_last_cat_' + section, category);
}

// Restore last viewed category for a section, returns the category name or null
function getLastCategory(section) {
  return localStorage.getItem('iptv_last_cat_' + section);
}

function renderSection(section, items) {
  const catList = document.getElementById('cat-list-' + section);
  if (catList) catList.innerHTML = '';

  const grid = document.getElementById('items-' + section);
  grid.innerHTML = "";

  // Add "Favorites" category at the top
  const favoritesBtn = document.createElement('button');
  favoritesBtn.className = 'list-group-item list-group-item-action';
  favoritesBtn.textContent = '⭐ Favoritos';
  favoritesBtn.onclick = () => {
    const favorites = getFavorites();
    const favoriteUrls = favorites[section] || [];
    const favoriteItems = allItems[section].filter(item => favoriteUrls.includes(item.url));
    renderItems(section, favoriteItems, true);
    document.querySelectorAll(`#cat-list-${section} .list-group-item`).forEach(btn => btn.classList.remove('active'));
    favoritesBtn.classList.add('active');
    // Save last category as '⭐ Favoritos'
    saveLastCategory(section, '⭐ Favoritos');
  };
  catList.appendChild(favoritesBtn);

  let catArray = Array.from(new Set(items.map(i => i.group || 'Outros')));

  // Order by: ⭐ top, ❌ end, alphabetic order for others
  catArray.sort((a, b) => {
    const aHasStar = a.includes('⭐');
    const bHasStar = b.includes('⭐');
    const aHasX = a.includes('❌');
    const bHasX = b.includes('❌');

    if (aHasStar && !bHasStar) return -1;
    if (!aHasStar && bHasStar) return 1;

    if (aHasX && !bHasX) return 1;
    if (!aHasX && bHasX) return -1;

    return a.localeCompare(b, 'pt-BR');
  });

  let firstCat = null;
  catArray.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'list-group-item list-group-item-action';
    btn.textContent = cat;
    btn.onclick = () => {
      renderItems(section, items.filter(i => (i.group || 'Outros') === cat));
      document.querySelectorAll(`#cat-list-${section} .list-group-item`).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.body.scrollTop = 0;
      document.documentElement.scrollTop = 0;
      // Save last category
      saveLastCategory(section, cat);
    }
    catList.appendChild(btn);
    if (!firstCat) firstCat = btn;
  });

  // Restore last viewed category if available
  const lastCat = getLastCategory(section);
  let foundCatBtn = null;
  if (lastCat) {
    // Try to find the button with the saved category name
    foundCatBtn = Array.from(catList.children).find(btn => btn.textContent === lastCat);
  }
  if (foundCatBtn) {
    document.querySelectorAll(`#cat-list-${section} .list-group-item`).forEach(b => b.classList.remove('active'));
    foundCatBtn.classList.add('active');
    if (foundCatBtn === favoritesBtn) {
      favoritesBtn.onclick();
    } else {
      renderItems(section, items.filter(i => (i.group || 'Outros') === lastCat));
    }
  } else if (firstCat) {
    document.querySelectorAll(`#cat-list-${section} .list-group-item`).forEach(b => b.classList.remove('active'));
    firstCat.classList.add('active');
    renderItems(section, items.filter(i => (i.group || 'Outros') === firstCat.textContent));
  } else if (favoritesBtn) {
    document.querySelectorAll(`#cat-list-${section} .list-group-item`).forEach(b => b.classList.remove('active'));

    favoritesBtn.classList.add('active');
    favoritesBtn.onclick();
  }
}

function getWatchedMovies() {
  return JSON.parse(localStorage.getItem('watchedMovies') || '[]');
}

function saveWatchedMovies(list) {
  localStorage.setItem('watchedMovies', JSON.stringify(list));
}

function toggleWatchedMovieIcon(url, btn) {
  let watched = getWatchedMovies();
  const icon = btn.querySelector('i');

  if (watched.includes(url)) {
    watched = watched.filter(u => u !== url);
    icon.classList.replace('bi-eye-slash', 'bi-eye');
    btn.classList.replace('btn-success', 'btn-outline-light');
  } else {
    watched.push(url);
    icon.classList.replace('bi-eye', 'bi-eye-slash');
    btn.classList.replace('btn-outline-light', 'btn-success');
  }
  saveWatchedMovies(watched);
}

// Helper to get the label for the alternative (channel or movie)
function getVariantLabel(type, name) {
  if (type === 'movies') {
    if (/\[L\]/i.test(name)) return 'Legendado';
    if (/4K/i.test(name)) return '4K';
    if (/\[Cinema\]|HDCAM|\[CAM\]|\(CAM\)/i.test(name)) return 'Cinema';
    return 'Dublado';
  } else {
    // For channels, use the extra from the name
    return getVariantExtra(getBaseChannelName(name), name);
  }
}

// Single function to open the player modal for channels and movies
function openPlayerModal({ title, variants, activeUrl, type }) {
  const modal = document.getElementById('player-modal');
  const modalTitle = document.getElementById('player-modal-title');
  const altDiv = document.getElementById('channel-alternatives');
  const playerDiv = document.getElementById('player');
  modalTitle.textContent = title;
  // Group by unique url
  const uniqueVariants = variants.filter((v, i, arr) => arr.findIndex(x => x.url === v.url) === i);
  altDiv.innerHTML = '';
  if (uniqueVariants.length > 1) {
    let html = '<span class="label">Alternatives: </span>';
    html += uniqueVariants.map((m, idx) => `
      <a href="#" data-idx="${idx}" class="me-3" style="${m.url===activeUrl?'font-weight:bold;text-decoration:underline;':''}">
        <i class="bi bi-play-btn"></i> ${getVariantLabel(type, m.name)}
      </a>`
    ).join(' ');
    altDiv.innerHTML = html;
    altDiv.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', function(e) {
        e.preventDefault();
        const idx = parseInt(a.getAttribute('data-idx'));
        playVariant(uniqueVariants[idx], modal, type);
        // Highlight the active option
        altDiv.querySelectorAll('a').forEach((el, j) => {
          el.style.fontWeight = (j === idx) ? 'bold' : '';
          el.style.textDecoration = (j === idx) ? 'underline' : '';
        });
      });
    });
  }
  // Select the active variant (or first)
  let toPlay = uniqueVariants.find(v => v.url === activeUrl) || uniqueVariants[0];
  playVariant(toPlay, modal, type);
  new bootstrap.Modal(modal).show();
}

// Function to play channel or movie
function playVariant(item, modal, type) {
  const playerDiv = document.getElementById('player');
  playerDiv.innerHTML = '';
  let url = item.url;
  if (url.match(/\.ts(\?.*)?$/i) || url.match(/\.mp4(\?.*)?$/i)) {
    url = url.replace(/^https?:\/\/[^/]+/, 'http://deylernew.xyz').replace(/\.ts$/, '.m3u8');
  }
  const title = item.baseName || getBaseChannelName(item.name) || item.name;
  try {
    player = new Playerjs({ id: playerDiv.id || 'player', file: url, title });
  } catch(e) {
    console.error(e);
  }
}

// Destroy the player when the player modal is closed
const playerModal = document.getElementById('player-modal');
if (playerModal) {
  playerModal.addEventListener('hidden.bs.modal', function () {
    if (window.player && typeof window.player.destroy === 'function') {
      window.player.destroy();
    }
    // Fallback: clear the player div in case destroy is not available
    const playerDiv = document.getElementById('player');
    if (playerDiv) playerDiv.innerHTML = '';
  });
}

// Helper to open series modal (should be global for series cards)
function openSeriesModal(serieName, serieItems) {
  const modalTitle = document.getElementById('series-modal-label');
  const container = document.getElementById('seriesSeasons');
  container.innerHTML = '';
  modalTitle.textContent = serieName;

  const seasonsMap = {};
  serieItems.forEach(it => {
    const match = it.name.match(/S(\d+)E(\d+)/i);
    const seasonNum = match ? parseInt(match[1]) : 1;
    if (!seasonsMap[seasonNum]) seasonsMap[seasonNum] = [];
    seasonsMap[seasonNum].push(it);
  });

  Object.keys(seasonsMap).sort((a, b) => a - b).forEach(season => {
    const episodes = seasonsMap[season];
    const seasonDiv = document.createElement('div');
    seasonDiv.className = 'mb-3 border-bottom pb-2';

    const allWatched = episodes.every(ep => getWatched().includes(ep.url));

    const header = document.createElement('h6');
    header.style.cursor = 'pointer';
    header.className = 'mb-2';
    header.innerHTML = `Season ${season} <i class="bi ${allWatched ? 'bi-chevron-down' : 'bi-chevron-up'}"></i>`;
    seasonDiv.appendChild(header);

    const epList = document.createElement('div');
    epList.style.display = allWatched ? 'none' : 'block';

    episodes.forEach(ep => {
      const epDiv = document.createElement('div');
      epDiv.className = 'd-flex justify-content-between align-items-center mb-1';

      const watched = getWatched().includes(ep.url);

      const watchBtn = document.createElement('button');
      watchBtn.className = 'btn btn-sm btn-outline-light me-1';
      watchBtn.innerHTML = '▶️ Assistir';
      watchBtn.addEventListener('click', () => {
        playItem(ep);
      });

      const toggleBtn = document.createElement('button');
      toggleBtn.className = `btn btn-sm ${watched ? 'btn-success' : 'btn-outline-light'}`;
      toggleBtn.innerHTML = `<i class="bi ${watched ? 'bi-eye-slash' : 'bi-eye'}"></i>`;
      toggleBtn.addEventListener("click", () => toggleWatchedIcon(ep.url, toggleBtn));

      const btnGroup = document.createElement('div');
      btnGroup.appendChild(watchBtn);
      btnGroup.appendChild(toggleBtn);

      const nameSpan = document.createElement('span');
      nameSpan.textContent = ep.name;

      epDiv.appendChild(nameSpan);
      epDiv.appendChild(btnGroup);

      epList.appendChild(epDiv);
    });

    header.addEventListener('click', () => {
      if (epList.style.display === 'none') {
        epList.style.display = 'block';
        header.querySelector('i').classList.replace('bi-chevron-down', 'bi-chevron-up');
      } else {
        epList.style.display = 'none';
        header.querySelector('i').classList.replace('bi-chevron-up', 'bi-chevron-down');
      }
    });

    seasonDiv.appendChild(epList);
    container.appendChild(seasonDiv);
  });

  new bootstrap.Modal(document.getElementById('series-modal')).show();
}

// Play a single episode (series) in the player modal
function playItem(episode) {
  // For series, find all variants (episodes with the same base name) if available
  let variants = [episode];
  let type = 'series';
  // For TV and movies, use the correct variant grouping
  if (allItems.tv.some(i => i.url === episode.url)) {
    const base = episode.baseName || getBaseChannelName(episode.name);
    variants = allItems.tv.filter(i => i.baseName === base);
    type = 'tv';
  } else if (allItems.movies.some(i => i.url === episode.url)) {
    const base = getBaseMovieName(episode.name);
    variants = allItems.movies.filter(m => getBaseMovieName(m.name) === base);
    type = 'movies';
  }
  openPlayerModal({
    title: episode.name,
    variants,
    activeUrl: episode.url,
    type
  });
}

// Helper to perform search in each section (TV, movies, series)
function performSearch(section) {
  const input = document.getElementById('search-' + section);
  const query = (input && input.value) ? input.value.trim().toLowerCase() : '';
  if (!query) {
    renderSection(section, allItems[section]);
    return;
  }
  const filtered = allItems[section].filter(item => {
    // For series, search by episode and base name
    if (section === 'series') {
      return item.name.toLowerCase().includes(query);
    }
    // For TV and movies, search by name and group
    return (item.name && item.name.toLowerCase().includes(query)) ||
           (item.group && item.group.toLowerCase().includes(query));
  });
  renderSection(section, filtered);
}

// Helper to setup search listeners (should be global for initial load)
function setupSearchListeners() {
  ['tv', 'movies', 'series'].forEach(section => {
    const btn = document.getElementById('search-btn-' + section);
    const clear = document.getElementById('clear-' + section);
    const input = document.getElementById('search-' + section);
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          performSearch(section);
        }
        if (e.key === 'Escape') {
          input.value = '';
          performSearch(section);
        }
      });
    }
    if (btn) {
      btn.addEventListener('click', () => performSearch(section));
    }
    if (clear) {
      clear.addEventListener('click', () => {
        const inp = document.getElementById('search-' + section);
        if (inp) inp.value = '';
        renderSection(section, allItems[section]);
      });
    }
  });
  // When switching tabs, clear searches so user sees categories again
  document.querySelectorAll('#tabs .nav-link').forEach(tab => {
    tab.addEventListener('shown.bs.tab', (e) => {
      const target = e.target.getAttribute('data-bs-target');
      if (!target) return;
      const sec = target.replace('#tab-','');
      const inp = document.getElementById('search-' + sec);
      if (inp) {
        inp.value = '';
        renderSection(sec, allItems[sec]);
      }
    });
  });
}

function renderItems(section, list, isFavoritesView = false) {
  const grid = document.getElementById('items-' + section);
  grid.innerHTML = '';

  if (section === 'series') {
    // Group episodes by base series name
    const seriesMap = {};
    let sourceList = list;
    if (isFavoritesView) {
      // In favorites, show all episodes of series that have at least one favorite episode
      const favUrls = (getFavorites().series || []);
      const favBaseNames = new Set();
      allItems.series.forEach(item => {
        if (favUrls.includes(item.url)) {
          const baseName = item.name.replace(/S\d+E\d+/i, '').trim();
          favBaseNames.add(baseName);
        }
      });
      // Use all episodes of those series, but ensure no duplicates by URL
      const seenUrls = new Set();
      sourceList = allItems.series.filter(item => {
        const baseName = item.name.replace(/S\d+E\d+/i, '').trim();
        if (favBaseNames.has(baseName) && !seenUrls.has(item.url)) {
          seenUrls.add(item.url);
          return true;
        }
        return false;
      });
    }
    // Group episodes by base name
    sourceList.forEach(item => {
      const baseName = item.name.replace(/S\d+E\d+/i, '').trim();
      if (!seriesMap[baseName]) seriesMap[baseName] = [];
      seriesMap[baseName].push(item);
    });
    Object.keys(seriesMap).forEach(function(name) {
      const episodes = seriesMap[name];
      const logo = episodes[0].logo || 'https://via.placeholder.com/300x169?text=Serie';
      const favUrls = (getFavorites().series || []);
      const isFav = episodes.some(ep => favUrls.includes(ep.url));
      const col = document.createElement('div');
      col.className = 'col-6 col-md-3 col-lg-2';
      // Card HTML
      col.innerHTML =
        '<div class="card h-100 border-0 shadow-sm" style="cursor:pointer;">' +
          '<span class="favorite-icon" data-url="' + episodes[0].url + '" data-section="' + section + '">' +
            (isFav ? '★' : '☆') +
          '</span>' +
          '<div class="ratio ratio-16x9">' +
            '<img src="' + logo + '" class="card-img-top" alt="' + name + '">' +
          '</div>' +
          '<div class="card-body p-1 text-center">' +
            '<h6 class="card-title mb-0 text-truncate">' + name + '</h6>' +
          '</div>' +
        '</div>';
      // Card click opens modal with all episodes
      col.querySelector('.card').addEventListener('click', function() { openSeriesModal(name, episodes); });
      // Favorite icon click toggles favorite
      col.querySelector('.favorite-icon').addEventListener('click', function(e) {
        e.stopPropagation();
        const url = e.target.dataset.url;
        const section = e.target.dataset.section;
        toggleFavorite(section, url, e.target);
      });
      grid.appendChild(col);
    });
    return;
  }

  if (section === 'tv') {
    const grouped = {};
    const uniqueItems = Array.from(new Set(list.map(item => item.url)))
      .map(url => list.find(item => item.url === url));
    uniqueItems.forEach(it => {
      const base = it.baseName || getBaseChannelName(it.name);
      (grouped[base] ||= []).push(it);
    });
    Object.keys(grouped).forEach(base => {
      const variants = allItems.tv.filter(i => i.baseName === base);
      const primary = variants[0];
      const isFav = isFavorite(section, primary.url);
      const col = document.createElement('div');
      col.className = 'col-6 col-md-3 col-lg-2';
      col.innerHTML = `
        <div class="card h-100 border-0 shadow-sm" style="cursor:pointer;">
          <span class="favorite-icon" data-url="${primary.url}" data-section="${section}">${isFav ? '★' : '☆'}</span>
          <div class="ratio ratio-16x9">
            <img src="${primary.logo || 'https://via.placeholder.com/300x169?text=No+Image'}" class="card-img-top"
              alt="${base}">
          </div>
          <div class="card-body p-1 text-center">
            <h6 class="card-title mb-0 text-truncate">${base}</h6>
          </div>
        </div>`;
      // Clique chama openPlayerModal
      col.querySelector('.card').addEventListener('click',()=>openPlayerModal({
        title: base,
        variants,
        activeUrl: primary.url,
        type: 'tv'
      }));
      // ...favoritos...
      col.querySelector('.favorite-icon').addEventListener('click', (e) => {
        e.stopPropagation();
        const url = e.target.dataset.url;
        const section = e.target.dataset.section;
        toggleFavorite(section, url, e.target);
      });
      grid.appendChild(col);
    });
    return;
  }

  if (section === 'movies') {
    // Only add one card per movie (by base name) to favorites, even if there are multiple alternative links
    const uniqueMovies = [];
    const seenBaseNames = new Set();
    list.forEach(item => {
      const base = getBaseMovieName(item.name);
      if (!seenBaseNames.has(base)) {
        uniqueMovies.push(item);
        seenBaseNames.add(base);
      }
    });
    list = uniqueMovies;
  }
  list.forEach(item => {
    const isFav = isFavorite(section, item.url);
    const isWatched = getWatchedMovies().includes(item.url);
    const col = document.createElement('div');
    col.className = 'col-6 col-md-3 col-lg-2';
    col.innerHTML = `
      <div class="card h-100 border-0 shadow-sm" style="cursor:pointer; position:relative;">
        <span class="watched-icon" data-url="${item.url}" title="Marcar como visto">
          <i class="bi ${isWatched ? 'bi-eye-slash' : 'bi-eye'}"></i>
        </span>
        <span class="favorite-icon" data-url="${item.url}" data-section="${section}">${isFav ? '★' : '☆'}</span>
        <div class="ratio ratio-16x9">
          <img src="${item.logo || 'https://via.placeholder.com/300x169?text=No+Image'}" class="card-img-top"
            alt="${item.name}">
        </div>
        <div class="card-body p-1 text-center">
          <h6 class="card-title mb-0 text-truncate">${getBaseMovieName(item.name)}</h6>
        </div>
      </div>`;
    // Clique chama openPlayerModal
    col.querySelector('.card').addEventListener('click', function() {
      const baseName = getBaseMovieName(item.name);
      const variants = allItems.movies.filter(m => getBaseMovieName(m.name) === baseName);
      openPlayerModal({
        title: baseName,
        variants,
        activeUrl: item.url,
        type: 'movies'
      });
    });
    // ...favoritos...
    col.querySelector('.favorite-icon').addEventListener('click', function(e) {
      e.stopPropagation();
      const url = e.target.dataset.url;
      const section = e.target.dataset.section;
      toggleFavorite(section, url, e.target);
    });
    // ...visto...
    col.querySelector('.watched-icon').addEventListener('click', function(e) {
      e.stopPropagation();
      toggleWatchedMovieIcon(item.url, e.currentTarget);
    });
    grid.appendChild(col);
  });
}

// Adiciona a função utilitária getBaseMovieName para evitar ReferenceError
function getBaseMovieName(name) {
  if (!name) return '';
  // Remove sufixos comuns de qualidade, idioma, etc, para agrupar variantes
  let base = name.trim();
  // Remove [ALT], [DUB], [L], [Cinema], 4K, HDCAM, etc
  base = base.replace(/\s*\[(ALT|DUB|L|Cinema|CAM)\]/gi, '').trim();
  base = base.replace(/\b(4K|HDCAM|HD|FHD|FULL ?HD|UHD|SD|1080P|720P)\b/gi, '').trim();
  // Remove parênteses e colchetes vazios
  base = base.replace(/[\[\]()]/g, '').trim();
  return base;
}

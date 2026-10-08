// ====================== Cinemate App ======================
// Полностью соответствует ТЗ + тёмная/светлая тема + экспорт/импорт + прогресс сезонов/эпизодов

const TMDB_API_KEY = 'd7da4a53fdf93ec21961e71d845be2e7'; // Получите бесплатно: https://www.themoviedb.org/settings/api
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w500';

// ===== API + Storage (server-side accounts) =====
// URL API: из config.js, либо тот же origin, либо localhost при file://
const API_BASE = (typeof window.CINEMATE_API === 'string' && window.CINEMATE_API)
    ? window.CINEMATE_API.replace(/\/$/, '')
    : (window.location.protocol === 'file:' ? 'http://127.0.0.1:3000' : '');

const Storage = {
    getToken() {
        return localStorage.getItem('cinemate_token');
    },
    setToken(token) {
        if (token) localStorage.setItem('cinemate_token', token);
        else localStorage.removeItem('cinemate_token');
    },
    getCachedUser() {
        try {
            return JSON.parse(localStorage.getItem('cinemate_user') || 'null');
        } catch {
            return null;
        }
    },
    setCachedUser(user) {
        if (user) localStorage.setItem('cinemate_user', JSON.stringify(user));
        else localStorage.removeItem('cinemate_user');
    },
    async api(path, options = {}) {
        const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
        const token = this.getToken();
        if (token) headers['Authorization'] = 'Bearer ' + token;
        const res = await fetch(API_BASE + path, { ...options, headers });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
        return data;
    },
    saveItems(list) {
        this.api('/api/items', { method: 'PUT', body: JSON.stringify(list) })
            .catch(e => { console.error(e); toast('Ошибка сохранения библиотеки'); });
    },
    saveCollections(cols) {
        this.api('/api/collections', { method: 'PUT', body: JSON.stringify(cols) })
            .catch(e => { console.error(e); toast('Ошибка сохранения подборок'); });
    },
    getTheme() {
        return localStorage.getItem('cinemate_theme') || 'dark';
    },
    saveTheme(theme) {
        localStorage.setItem('cinemate_theme', theme);
    }
};

// ===== State =====
let items = [];
let collections = [];
let currentEditId = null;
let selectedIds = new Set();
let pendingCollectionItemIds = [];
let viewingCollectionId = null;
let currentUser = null;

// ===== Auth =====
async function showApp() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
    if (currentUser) {
        document.getElementById('current-user-name').textContent = currentUser.name;
        document.getElementById('current-user-email').textContent = currentUser.email;
    }
    try {
        items = await Storage.api('/api/items');
        collections = await Storage.api('/api/collections');
    } catch (e) {
        items = [];
        collections = [];
        if (String(e.message).includes('авторизован') || String(e.message).includes('Сессия')) {
            Storage.setToken(null);
            Storage.setCachedUser(null);
            showAuth();
            return;
        }
    }
    selectedIds.clear();
    if (typeof updateBulkBar === 'function') updateBulkBar();
    if (typeof renderLibrary === 'function') renderLibrary();
    if (typeof renderCollections === 'function') renderCollections();
}

function showAuth() {
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('app').style.display = 'none';
    const le = document.getElementById('login-error');
    const re = document.getElementById('register-error');
    if (le) le.textContent = '';
    if (re) re.textContent = '';
}

function showAuthForm(name) {
    document.getElementById('login-form').style.display = name === 'login' ? 'block' : 'none';
    document.getElementById('register-form').style.display = name === 'register' ? 'block' : 'none';
    document.getElementById('reset-form').style.display = name === 'reset' ? 'block' : 'none';
    document.querySelectorAll('.auth-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.auth === name);
        t.style.display = name === 'reset' ? 'none' : '';
    });
    ['login-error', 'register-error', 'reset-error'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '';
    });
}

document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => showAuthForm(tab.dataset.auth));
});

// Eye buttons
document.querySelectorAll('.eye-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.target);
        if (!input) return;
        const isPass = input.type === 'password';
        input.type = isPass ? 'text' : 'password';
        btn.textContent = isPass ? '🙈' : '👁';
    });
});

// Forgot / Reset
document.getElementById('forgot-btn').addEventListener('click', () => showAuthForm('reset'));
document.getElementById('back-to-login').addEventListener('click', () => showAuthForm('login'));

document.getElementById('reset-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('reset-email').value.trim().toLowerCase();
    const pass = document.getElementById('reset-password').value;
    const err = document.getElementById('reset-error');

    if (!email || !pass) { err.textContent = 'Заполните все поля'; return; }
    if (pass.length < 4) { err.textContent = 'Пароль минимум 4 символа'; return; }

    try {
        await Storage.api('/api/reset-password', {
            method: 'POST',
            body: JSON.stringify({ email, password: pass })
        });
        toast('Пароль успешно изменён');
        showAuthForm('login');
        document.getElementById('login-email').value = email;
    } catch (ex) {
        err.textContent = ex.message;
    }
});

function toast(msg) {
    const old = document.querySelector('.toast');
    if (old) old.remove();
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2500);
}

document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim().toLowerCase();
    const pass = document.getElementById('reg-password').value;
    const pass2 = document.getElementById('reg-password2').value;
    const err = document.getElementById('register-error');

    if (!name || !email || !pass) { err.textContent = 'Заполните все поля'; return; }
    if (pass.length < 4) { err.textContent = 'Пароль минимум 4 символа'; return; }
    if (pass !== pass2) { err.textContent = 'Пароли не совпадают'; return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = 'Некорректный email'; return; }

    try {
        const data = await Storage.api('/api/register', {
            method: 'POST',
            body: JSON.stringify({ name, email, password: pass })
        });
        Storage.setToken(data.token);
        Storage.setCachedUser(data.user);
        currentUser = data.user;
        await showApp();
    } catch (ex) {
        err.textContent = ex.message;
    }
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim().toLowerCase();
    const pass = document.getElementById('login-password').value;
    const err = document.getElementById('login-error');

    try {
        const data = await Storage.api('/api/login', {
            method: 'POST',
            body: JSON.stringify({ email, password: pass })
        });
        Storage.setToken(data.token);
        Storage.setCachedUser(data.user);
        currentUser = data.user;
        await showApp();
    } catch (ex) {
        err.textContent = ex.message;
    }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
    try {
        await Storage.api('/api/logout', { method: 'POST' });
    } catch (_) {}
    Storage.setToken(null);
    Storage.setCachedUser(null);
    currentUser = null;
    items = [];
    collections = [];
    selectedIds.clear();
    showAuth();
});

// Init session — check token at end of file
window.__cinemate_authed = !!Storage.getToken();
if (!window.__cinemate_authed) {
    showAuth();
}

// ===== Theme =====
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const icon = document.getElementById('theme-icon');
    const label = document.getElementById('theme-label');
    if (theme === 'dark') {
        icon.textContent = '☀️';
        label.textContent = 'Светлая';
    } else {
        icon.textContent = '🌙';
        label.textContent = 'Тёмная';
    }
    Storage.saveTheme(theme);
}

// Init theme
applyTheme(Storage.getTheme());

document.getElementById('theme-toggle').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    applyTheme(current === 'dark' ? 'light' : 'dark');
});

// ===== Export / Import =====
document.getElementById('export-btn').addEventListener('click', () => {
    const data = {
        version: 1,
        exportedAt: new Date().toISOString(),
        items: items,
        collections: collections
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cinemate-library-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
});

document.getElementById('import-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const data = JSON.parse(event.target.result);
            if (!data.items || !Array.isArray(data.items)) {
                alert('Неверный формат файла');
                return;
            }

            const mode = confirm(
                `Найдено ${data.items.length} единиц контента.\n\n` +
                `OK — заменить текущую библиотеку\n` +
                `Отмена — добавить к существующей`
            );

            if (mode) {
                // Replace
                items = data.items;
                collections = data.collections || [];
            } else {
                // Merge (avoid duplicates by id)
                const existingIds = new Set(items.map(i => i.id));
                data.items.forEach(item => {
                    if (!existingIds.has(item.id)) {
                        items.push(item);
                    }
                });
                if (data.collections) {
                    const existingColIds = new Set(collections.map(c => c.id));
                    data.collections.forEach(col => {
                        if (!existingColIds.has(col.id)) {
                            collections.push(col);
                        }
                    });
                }
            }

            Storage.saveItems(items);
            Storage.saveCollections(collections);
            renderLibrary();
            alert('Импорт успешно выполнен!');
        } catch (err) {
            alert('Ошибка чтения файла: ' + err.message);
        }
        e.target.value = ''; // reset input
    };
    reader.readAsText(file);
});

// ===== Navigation =====
function closeMobileSidebar() {
    const sb = document.getElementById('sidebar');
    const ov = document.getElementById('sidebar-overlay');
    if (sb) sb.classList.remove('open');
    if (ov) ov.classList.remove('open');
    document.body.style.overflow = '';
}

function openMobileSidebar() {
    const sb = document.getElementById('sidebar');
    const ov = document.getElementById('sidebar-overlay');
    if (sb) sb.classList.add('open');
    if (ov) ov.classList.add('open');
    document.body.style.overflow = 'hidden';
}

document.getElementById('menu-toggle')?.addEventListener('click', openMobileSidebar);
document.getElementById('sidebar-close')?.addEventListener('click', closeMobileSidebar);
document.getElementById('sidebar-overlay')?.addEventListener('click', closeMobileSidebar);

document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        // Clear collection view when navigating
        viewingCollectionId = null;
        const cvb = document.getElementById('collection-view-bar');
        if (cvb) cvb.style.display = 'none';
        
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`page-${btn.dataset.page}`).classList.add('active');
        
        if (btn.dataset.page === 'library') renderLibrary();
        if (btn.dataset.page === 'analytics') renderAnalytics();
        if (btn.dataset.page === 'collections') renderCollections();

        closeMobileSidebar();
    });
});

// ===== Tabs =====
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
});

// Show series fields
document.getElementById('m-type').addEventListener('change', e => {
    document.querySelector('.series-only').style.display = 
        e.target.value === 'series' ? 'block' : 'none';
});

// ===== Labels =====
function statusLabel(s) {
    return { planned: 'В планах', watching: 'В процессе', watched: 'Просмотрено' }[s] || s;
}
function typeLabel(t) {
    return { movie: 'Фильм', series: 'Сериал', documentary: 'Документальный' }[t] || t;
}
function sourceLabel(s) {
    return { streaming: 'Стриминг', local: 'Локальный файл', physical: 'Физический носитель' }[s] || s;
}

// ===== Progress helper =====
function getProgress(item) {
    if (item.type !== 'series' || !item.episodes || item.episodes <= 0) return null;
    const watched = item.watchedEpisodes || 0;
    const total = item.episodes;
    const percent = Math.min(100, Math.round((watched / total) * 100));
    return { watched, total, percent };
}

// ===== Populate genre filter =====
function updateGenreFilter() {
    const select = document.getElementById('filter-genre');
    const currentValue = select.value;
    
    // Collect unique genres from all items
    const genreSet = new Set();
    items.forEach(item => {
        (item.genres || []).forEach(g => {
            if (g && g.trim()) genreSet.add(g.trim());
        });
    });
    
    const genres = Array.from(genreSet).sort((a, b) => a.localeCompare(b, 'ru'));
    
    select.innerHTML = '<option value="">Все жанры</option>' + 
        genres.map(g => `<option value="${g}">${g}</option>`).join('');
    
    // Restore previous selection if still available
    if (currentValue && genres.includes(currentValue)) {
        select.value = currentValue;
    }
}

// ===== Render Library =====
function renderLibrary() {
    const grid = document.getElementById('content-grid');
    const searchRaw = document.getElementById('search-input').value.trim().toLowerCase();
    const status = document.getElementById('filter-status').value;
    const type = document.getElementById('filter-type').value;
    const genre = document.getElementById('filter-genre').value;
    const source = document.getElementById('filter-source').value;
    const rating = document.getElementById('filter-rating').value;
    const sortBy = document.getElementById('sort-by').value;

    // Update genre list every render (in case new items were added)
    updateGenreFilter();

    let filtered = items.filter(item => {
        // Improved search: supports multiple words, searches title + genres primarily
        let matchSearch = true;
        if (searchRaw) {
            const words = searchRaw.split(/\s+/).filter(Boolean);
            const searchable = [
                item.title || '',
                item.originalTitle || '',
                item.director || '',
                (item.genres || []).join(' '),
                (item.tags || []).join(' ')
            ].join(' ').toLowerCase();
            
            // All words must be found somewhere (AND logic)
            matchSearch = words.every(word => searchable.includes(word));
        }
        
        const matchStatus = !status || item.status === status;
        const matchType = !type || item.type === type;
        const matchGenre = !genre || (item.genres || []).some(g => g.toLowerCase() === genre.toLowerCase());
        const matchSource = !source || item.source === source;
        const matchRating = !rating || (item.rating >= parseInt(rating));
        
        let matchCollection = true;
        if (viewingCollectionId) {
            const col = collections.find(c => c.id === viewingCollectionId);
            matchCollection = col ? col.itemIds.includes(item.id) : false;
        }

        return matchSearch && matchStatus && matchType && matchGenre && matchSource && matchRating && matchCollection;
    });

    // Sorting
    filtered.sort((a, b) => {
        switch (sortBy) {
            case 'rating-desc':
                return (b.rating || 0) - (a.rating || 0);
            case 'rating-asc':
                return (a.rating || 0) - (b.rating || 0);
            case 'title-asc':
                return (a.title || '').localeCompare(b.title || '', 'ru');
            case 'title-desc':
                return (b.title || '').localeCompare(a.title || '', 'ru');
            case 'date-asc':
                return new Date(a.addedAt) - new Date(b.addedAt);
            case 'date-desc':
            default:
                return new Date(b.addedAt) - new Date(a.addedAt);
        }
    });

    document.getElementById('total-count').textContent = items.length;

    if (filtered.length === 0) {
        grid.innerHTML = `
            <div class="empty-state" style="grid-column:1/-1">
                <span>🎬</span>
                <p>Ничего не найдено. Добавьте первый фильм или сериал!</p>
            </div>`;
        return;
    }

    grid.innerHTML = filtered.map(item => {
        const progress = getProgress(item);
        const checked = selectedIds.has(item.id) ? 'checked' : '';
        return `
        <div class="card">
            <input type="checkbox" class="card-check" ${checked} onclick="event.stopPropagation(); toggleSelect('${item.id}')">
            <div onclick="openDetail('${item.id}')">
                <div class="card-poster">
                    ${item.poster ? `<img src="${item.poster}" alt="${item.title}" loading="lazy">` : '🎬'}
                </div>
                <div class="card-body">
                    <div class="card-title">${item.title}</div>
                    <div class="card-meta">
                        ${item.year || '—'} · ${typeLabel(item.type)}
                        ${item.type === 'series' && item.seasons ? ` · ${item.seasons} сезон${item.seasons > 1 ? 'а' : ''}` : ''}
                        ${item.genres && item.genres.length ? `<br><span style="opacity:0.8">${item.genres.slice(0,3).join(', ')}</span>` : ''}
                    </div>
                    <span class="card-status status-${item.status}">${statusLabel(item.status)}</span>
                    ${item.rating > 0 ? `<div class="card-rating">${'★'.repeat(item.rating)}${'☆'.repeat(5-item.rating)}</div>` : ''}
                    ${progress ? `
                        <div class="progress-wrap">
                            <div class="progress-bar">
                                <div class="progress-fill" style="width:${progress.percent}%"></div>
                            </div>
                            <div class="progress-text">${progress.watched} / ${progress.total} эп. (${progress.percent}%)</div>
                        </div>
                    ` : ''}
                </div>
            </div>
        </div>
    `}).join('');
}

// ===== Selection / Bulk =====
function toggleSelect(id) {
    if (selectedIds.has(id)) selectedIds.delete(id);
    else selectedIds.add(id);
    updateBulkBar();
}

function updateBulkBar() {
    const bar = document.getElementById('bulk-bar');
    const count = selectedIds.size;
    if (count > 0) {
        bar.style.display = 'flex';
        document.getElementById('selected-count').textContent = `${count} выбрано`;
    } else {
        bar.style.display = 'none';
    }
}

document.getElementById('bulk-clear').addEventListener('click', () => {
    selectedIds.clear();
    updateBulkBar();
    renderLibrary();
});

document.getElementById('bulk-add-collection').addEventListener('click', () => {
    if (selectedIds.size === 0) return;
    pendingCollectionItemIds = Array.from(selectedIds);
    openSelectCollectionModal();
});

document.getElementById('bulk-delete').addEventListener('click', () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Удалить ${selectedIds.size} элементов?`)) return;
    
    const ids = Array.from(selectedIds);
    items = items.filter(i => !ids.includes(i.id));
    collections.forEach(col => {
        col.itemIds = col.itemIds.filter(id => !ids.includes(id));
    });
    Storage.saveItems(items);
    Storage.saveCollections(collections);
    selectedIds.clear();
    updateBulkBar();
    renderLibrary();
    toast(`Удалено: ${ids.length}`);
});

// Filters listeners
['search-input', 'filter-status', 'filter-type', 'filter-genre', 'filter-source', 'filter-rating', 'sort-by'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener('input', renderLibrary);
        el.addEventListener('change', renderLibrary);
    }
});

document.getElementById('clear-filters').addEventListener('click', () => {
    document.getElementById('search-input').value = '';
    document.getElementById('filter-status').value = '';
    document.getElementById('filter-type').value = '';
    document.getElementById('filter-genre').value = '';
    document.getElementById('filter-source').value = '';
    document.getElementById('filter-rating').value = '';
    document.getElementById('sort-by').value = 'date-desc';
    renderLibrary();
});

// ===== Manual Add =====
// Poster helper (resize + base64)
function fileToPoster(file) {
    return new Promise((resolve) => {
        if (!file) return resolve(null);
        const reader = new FileReader();
        reader.onload = (ev) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const maxW = 400;
                const scale = Math.min(1, maxW / img.width);
                canvas.width = img.width * scale;
                canvas.height = img.height * scale;
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', 0.8));
            };
            img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    });
}

// Preview on select
document.getElementById('m-poster')?.addEventListener('change', async (e) => {
    const preview = document.getElementById('m-poster-preview');
    const label = document.getElementById('m-poster-label');
    const file = e.target.files[0];
    if (!file) {
        preview.innerHTML = '';
        if (label) label.textContent = 'Выбрать изображение';
        return;
    }
    if (label) label.textContent = file.name;
    const data = await fileToPoster(file);
    preview.innerHTML = data ? `<img src="${data}">` : '';
});

document.getElementById('manual-form').addEventListener('submit', async e => {
    e.preventDefault();
    
    const type = document.getElementById('m-type').value;
    const totalEpisodes = parseInt(document.getElementById('m-episodes').value) || 0;
    let watchedEpisodes = parseInt(document.getElementById('m-watched-episodes').value) || 0;
    if (watchedEpisodes > totalEpisodes) watchedEpisodes = totalEpisodes;

    const posterFile = document.getElementById('m-poster').files[0];
    const poster = await fileToPoster(posterFile);

    const item = {
        id: 'local_' + Date.now(),
        title: document.getElementById('m-title').value.trim(),
        originalTitle: document.getElementById('m-original').value.trim(),
        type: type,
        year: document.getElementById('m-year').value || null,
        director: document.getElementById('m-director').value.trim(),
        genres: document.getElementById('m-genres').value.split(',').map(g => g.trim()).filter(Boolean),
        source: document.getElementById('m-source').value,
        overview: document.getElementById('m-overview').value.trim(),
        status: document.getElementById('m-status').value,
        rating: parseInt(document.getElementById('m-rating').value) || 0,
        tags: document.getElementById('m-tags').value.split(',').map(t => t.trim()).filter(Boolean),
        review: document.getElementById('m-review').value.trim(),
        seasons: type === 'series' ? (parseInt(document.getElementById('m-seasons').value) || null) : null,
        episodes: type === 'series' ? totalEpisodes : null,
        watchedEpisodes: type === 'series' ? watchedEpisodes : 0,
        poster: poster,
        addedAt: new Date().toISOString(),
        tmdbId: null
    };

    if (type === 'series' && totalEpisodes > 0) {
        if (watchedEpisodes >= totalEpisodes) item.status = 'watched';
        else if (watchedEpisodes > 0) item.status = 'watching';
    }

    if (isDuplicate(item)) {
        toast(`«${item.title}» уже есть в библиотеке`);
        return;
    }

    items.unshift(item);
    Storage.saveItems(items);
    
    e.target.reset();
    document.getElementById('m-poster-preview').innerHTML = '';
    const pl = document.getElementById('m-poster-label');
    if (pl) pl.textContent = 'Выбрать изображение';
    document.querySelector('.series-only').style.display = 'none';
    toast('Добавлено успешно');
    
    document.querySelector('[data-page="library"]').click();
});

// ===== TMDB Search =====
document.getElementById('tmdb-search-btn').addEventListener('click', searchTMDB);
document.getElementById('tmdb-search').addEventListener('keydown', e => {
    if (e.key === 'Enter') searchTMDB();
});

async function searchTMDB() {
    const query = document.getElementById('tmdb-search').value.trim();
    if (!query) return;

    const resultsDiv = document.getElementById('tmdb-results');
    resultsDiv.innerHTML = '<p style="color:var(--text-muted)">Ищем...</p>';

    if (TMDB_API_KEY === 'ВАШ_КЛЮЧ_TMDB') {
        resultsDiv.innerHTML = `
            <div style="grid-column:1/-1; padding:20px; background:var(--bg-card); border-radius:12px; border:1px solid var(--border);">
                <p><strong>Для полноценной работы вставьте свой API-ключ TMDB</strong> в начале файла <code>app.js</code>.</p>
                <p style="margin-top:12px; color:var(--text-muted)">Получить бесплатно: <a href="https://www.themoviedb.org/settings/api" target="_blank" style="color:var(--primary)">themoviedb.org/settings/api</a></p>
                <p style="margin-top:16px">Пока можете добавить контент вручную на вкладке «Ручное добавление».</p>
            </div>`;
        return;
    }

    try {
        const res = await fetch(`${TMDB_BASE}/search/multi?api_key=${TMDB_API_KEY}&language=ru-RU&query=${encodeURIComponent(query)}`);
        const data = await res.json();

        if (!data.results || data.results.length === 0) {
            resultsDiv.innerHTML = '<p>Ничего не найдено</p>';
            return;
        }

        resultsDiv.innerHTML = data.results
            .filter(r => r.media_type === 'movie' || r.media_type === 'tv')
            .slice(0, 12)
            .map(r => {
                const title = r.title || r.name;
                const year = (r.release_date || r.first_air_date || '').slice(0, 4);
                const poster = r.poster_path ? TMDB_IMG + r.poster_path : null;
                const rawStr = JSON.stringify(r).replace(/'/g, "&#39;");
                return `
                    <div class="tmdb-card">
                        <div onclick='addFromTMDB(${rawStr})' style="cursor:pointer">
                            ${poster ? `<img src="${poster}" alt="${title}">` : '<div style="aspect-ratio:2/3;display:flex;align-items:center;justify-content:center;font-size:40px;background:var(--bg-hover)">🎬</div>'}
                            <div class="tmdb-card-info">
                                <strong>${title}</strong><br>
                                <span style="color:var(--text-muted)">${year} · ${r.media_type === 'tv' ? 'Сериал' : 'Фильм'}</span>
                            </div>
                        </div>
                        <div style="padding:8px 10px; display:flex; gap:6px;">
                            <button class="btn-primary" style="flex:1;padding:6px;font-size:12px" onclick='addFromTMDB(${rawStr})'>В библиотеку</button>
                            <button class="btn-secondary" style="padding:6px 10px;font-size:12px" onclick='addFromTMDBToCollection(${rawStr})' title="Добавить в подборку">📁</button>
                        </div>
                    </div>`;
            }).join('');
    } catch (err) {
        resultsDiv.innerHTML = '<p style="color:var(--danger)">Ошибка запроса к TMDB</p>';
    }
}

async function createItemFromTMDB(raw) {
    const isSeries = raw.media_type === 'tv';
    let details = raw;

    try {
        const type = isSeries ? 'tv' : 'movie';
        const res = await fetch(`${TMDB_BASE}/${type}/${raw.id}?api_key=${TMDB_API_KEY}&language=ru-RU&append_to_response=credits`);
        details = await res.json();
    } catch (e) {}

    const director = details.credits?.crew?.find(c => c.job === 'Director')?.name || 
                     details.created_by?.[0]?.name || '';

    return {
        id: 'tmdb_' + raw.id + '_' + Date.now(),
        title: details.title || details.name,
        originalTitle: details.original_title || details.original_name || '',
        type: isSeries ? 'series' : (details.genres?.some(g => g.id === 99) ? 'documentary' : 'movie'),
        year: (details.release_date || details.first_air_date || '').slice(0, 4),
        director: director,
        genres: (details.genres || []).map(g => g.name),
        source: 'streaming',
        overview: details.overview || '',
        status: 'planned',
        rating: 0,
        tags: [],
        review: '',
        seasons: details.number_of_seasons || null,
        episodes: details.number_of_episodes || null,
        watchedEpisodes: 0,
        poster: details.poster_path ? TMDB_IMG + details.poster_path : null,
        addedAt: new Date().toISOString(),
        tmdbId: raw.id
    };
}

function isDuplicate(item) {
    return items.some(i => {
        if (item.tmdbId && i.tmdbId && String(i.tmdbId) === String(item.tmdbId)) return true;
        const sameTitle = (i.title || '').toLowerCase() === (item.title || '').toLowerCase();
        const sameYear = String(i.year || '') === String(item.year || '');
        return sameTitle && sameYear;
    });
}

async function addFromTMDB(raw) {
    const item = await createItemFromTMDB(raw);
    if (isDuplicate(item)) {
        toast(`«${item.title}» уже есть в библиотеке`);
        return;
    }
    items.unshift(item);
    Storage.saveItems(items);
    toast(`«${item.title}» добавлен`);
    document.querySelector('[data-page="library"]').click();
}

async function addFromTMDBToCollection(raw) {
    const item = await createItemFromTMDB(raw);
    if (isDuplicate(item)) {
        // still allow adding existing item to collection
        const existing = items.find(i =>
            (item.tmdbId && i.tmdbId && String(i.tmdbId) === String(item.tmdbId)) ||
            ((i.title || '').toLowerCase() === (item.title || '').toLowerCase() && String(i.year || '') === String(item.year || ''))
        );
        if (existing) {
            promptAddToCollection(existing.id);
            return;
        }
    }
    items.unshift(item);
    Storage.saveItems(items);
    promptAddToCollection(item.id);
}

// ===== Detail Modal =====
function openDetail(id) {
    const item = items.find(i => i.id === id);
    if (!item) return;

    currentEditId = id;
    const modal = document.getElementById('modal');
    const body = document.getElementById('modal-body');
    const progress = getProgress(item);

    body.innerHTML = `
        <div class="detail-header">
            <div class="detail-poster">
                ${item.poster ? `<img src="${item.poster}" style="width:100%;border-radius:10px">` : 
                '<div style="width:180px;aspect-ratio:2/3;background:var(--bg-hover);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:48px">🎬</div>'}
            </div>
            <div class="detail-info">
                <h2>${item.title}</h2>
                ${item.originalTitle ? `<p style="color:var(--text-muted)">${item.originalTitle}</p>` : ''}
                <div class="detail-meta">
                    ${item.year || '—'} · ${typeLabel(item.type)} · ${sourceLabel(item.source)}
                    ${item.director ? `<br>Режиссёр: ${item.director}` : ''}
                    ${item.genres?.length ? `<br>Жанры: ${item.genres.join(', ')}` : ''}
                    ${item.type === 'series' && item.seasons ? `<br>Сезонов: ${item.seasons}` : ''}
                </div>
                <span class="card-status status-${item.status}">${statusLabel(item.status)}</span>
                ${item.rating > 0 ? `<div style="margin-top:8px;color:#fdcb6e">${'★'.repeat(item.rating)}</div>` : ''}
            </div>
        </div>

        ${item.overview ? `<p style="margin-bottom:16px;line-height:1.6">${item.overview}</p>` : ''}
        
        ${item.tags?.length ? `<p><strong>Теги:</strong> ${item.tags.map(t => `<span style="background:var(--bg);padding:2px 8px;border-radius:12px;font-size:12px;margin-right:4px">${t}</span>`).join('')}</p>` : ''}
        
        ${item.review ? `<div style="margin:16px 0;padding:12px;background:var(--bg);border-radius:8px"><strong>Рецензия:</strong><br>${item.review}</div>` : ''}

        ${item.type === 'series' ? `
            <div class="progress-controls">
                <label>Прогресс просмотра сериала</label>
                <div class="row">
                    <div>
                        <small style="color:var(--text-muted)">Просмотрено</small><br>
                        <input type="number" id="edit-watched" min="0" value="${item.watchedEpisodes || 0}">
                    </div>
                    <div>
                        <small style="color:var(--text-muted)">Всего эпизодов</small><br>
                        <input type="number" id="edit-total-ep" min="1" value="${item.episodes || 0}">
                    </div>
                    <div>
                        <small style="color:var(--text-muted)">Сезонов</small><br>
                        <input type="number" id="edit-seasons" min="1" value="${item.seasons || 0}">
                    </div>
                </div>
                ${progress ? `
                    <div class="progress-wrap" style="margin-top:12px">
                        <div class="progress-bar">
                            <div class="progress-fill" style="width:${progress.percent}%"></div>
                        </div>
                        <div class="progress-text">${progress.watched} / ${progress.total} эп. (${progress.percent}%)</div>
                    </div>
                ` : ''}
            </div>
        ` : ''}

        <div class="detail-actions">
            <select id="edit-status" style="padding:8px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text)">
                <option value="planned" ${item.status==='planned'?'selected':''}>В планах</option>
                <option value="watching" ${item.status==='watching'?'selected':''}>В процессе</option>
                <option value="watched" ${item.status==='watched'?'selected':''}>Просмотрено</option>
            </select>
            <select id="edit-rating" style="padding:8px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text)">
                <option value="0">Без оценки</option>
                ${[1,2,3,4,5].map(n => `<option value="${n}" ${item.rating===n?'selected':''}>${n} ★</option>`).join('')}
            </select>
            <button class="btn-primary" onclick="saveDetailChanges()">Сохранить</button>
            <button class="btn-secondary" onclick="promptAddToCollection('${item.id}')">📁 В подборку</button>
            <button class="btn-danger" onclick="deleteItem('${item.id}')">Удалить</button>
        </div>

        <div style="margin-top:20px">
            <label style="font-size:13px;color:var(--text-muted)">Рецензия</label>
            <textarea id="edit-review" rows="3" style="width:100%;margin-top:6px;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text)">${item.review || ''}</textarea>
        </div>
        <div style="margin-top:12px">
            <label style="font-size:13px;color:var(--text-muted)">Теги (через запятую)</label>
            <input id="edit-tags" type="text" value="${(item.tags||[]).join(', ')}" style="width:100%;margin-top:6px;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text)">
        </div>
        <div style="margin-top:12px">
            <label style="font-size:13px;color:var(--text-muted)">Сменить обложку</label>
            <label class="file-btn" for="edit-poster" style="margin-top:6px">
                <span class="file-btn-icon">🖼</span>
                <span class="file-btn-text" id="edit-poster-label">Выбрать изображение</span>
                <input type="file" id="edit-poster" accept="image/*" hidden>
            </label>
        </div>
    `;

    modal.classList.add('open');
}

async function saveDetailChanges() {
    const item = items.find(i => i.id === currentEditId);
    if (!item) return;

    item.status = document.getElementById('edit-status').value;
    item.rating = parseInt(document.getElementById('edit-rating').value) || 0;
    item.review = document.getElementById('edit-review').value.trim();
    item.tags = document.getElementById('edit-tags').value.split(',').map(t => t.trim()).filter(Boolean);

    // Poster
    const posterFile = document.getElementById('edit-poster')?.files[0];
    if (posterFile) {
        item.poster = await fileToPoster(posterFile);
    }

    // Progress for series
    if (item.type === 'series') {
        const watched = parseInt(document.getElementById('edit-watched')?.value) || 0;
        const total = parseInt(document.getElementById('edit-total-ep')?.value) || 0;
        const seasons = parseInt(document.getElementById('edit-seasons')?.value) || 0;

        item.watchedEpisodes = Math.min(watched, total || watched);
        item.episodes = total;
        item.seasons = seasons;

        // Auto-update status based on progress
        if (total > 0) {
            if (item.watchedEpisodes >= total) {
                item.status = 'watched';
            } else if (item.watchedEpisodes > 0 && item.status === 'planned') {
                item.status = 'watching';
            }
        }
    }

    Storage.saveItems(items);
    document.getElementById('modal').classList.remove('open');
    renderLibrary();
}

function deleteItem(id) {
    if (!confirm('Удалить этот элемент?')) return;
    items = items.filter(i => i.id !== id);
    // Удаляем из всех подборок
    collections.forEach(col => {
        col.itemIds = col.itemIds.filter(cid => cid !== id);
    });
    Storage.saveItems(items);
    Storage.saveCollections(collections);
    document.getElementById('modal').classList.remove('open');
    renderLibrary();
}

// Close modals (X button + click outside)
document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
        btn.closest('.modal').classList.remove('open');
    });
});

document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('open');
        }
    });
});

// Escape key closes any open modal
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open'));
    }
});

// ===== Collections =====
document.getElementById('create-collection-btn').addEventListener('click', () => {
    document.getElementById('collection-name').value = '';
    document.getElementById('collection-modal').classList.add('open');
});

document.getElementById('save-collection').addEventListener('click', () => {
    const name = document.getElementById('collection-name').value.trim();
    if (!name) return;

    collections.push({
        id: 'col_' + Date.now(),
        name,
        itemIds: [],
        createdAt: new Date().toISOString()
    });
    Storage.saveCollections(collections);
    document.getElementById('collection-name').value = '';
    document.getElementById('collection-modal').classList.remove('open');
    renderCollections();
});

function renderCollections() {
    const list = document.getElementById('collections-list');
    if (collections.length === 0) {
        list.innerHTML = `<div class="empty-state"><span>📁</span><p>Подборок пока нет. Создайте первую!</p></div>`;
        return;
    }

    list.innerHTML = collections.map(col => {
        const count = items.filter(i => col.itemIds.includes(i.id)).length;
        return `
        <div class="collection-card" style="cursor:pointer" onclick="openCollectionView('${col.id}')">
            <h3>${col.name}</h3>
            <div class="count">${count} элементов</div>
            <div style="margin-top:12px;display:flex;gap:8px">
                <button class="btn-primary" style="flex:1;padding:8px;font-size:13px" onclick="event.stopPropagation(); openCollectionView('${col.id}')">Открыть</button>
                <button class="btn-secondary" style="padding:8px 12px;font-size:13px" onclick="event.stopPropagation(); deleteCollection('${col.id}')">Удалить</button>
            </div>
        </div>`;
    }).join('');
}

function openCollectionView(colId) {
    const col = collections.find(c => c.id === colId);
    if (!col) return;
    viewingCollectionId = colId;
    
    // Switch to library page and filter
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelector('[data-page="library"]').classList.add('active');
    document.getElementById('page-library').classList.add('active');
    
    document.getElementById('collection-view-bar').style.display = 'flex';
    document.getElementById('collection-view-title').textContent = `📁 ${col.name}`;
    
    renderLibrary();
}

document.getElementById('back-to-collections').addEventListener('click', () => {
    viewingCollectionId = null;
    document.getElementById('collection-view-bar').style.display = 'none';
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelector('[data-page="collections"]').classList.add('active');
    document.getElementById('page-collections').classList.add('active');
    renderCollections();
});

function deleteCollection(id) {
    if (!confirm('Удалить подборку?')) return;
    collections = collections.filter(c => c.id !== id);
    Storage.saveCollections(collections);
    renderCollections();
}

function addToCollection(itemId, colId) {
    const col = collections.find(c => c.id === colId);
    if (!col) return;
    if (!col.itemIds.includes(itemId)) {
        col.itemIds.push(itemId);
        Storage.saveCollections(collections);
    }
}

function removeFromCollection(colId, itemId) {
    const col = collections.find(c => c.id === colId);
    if (!col) return;
    col.itemIds = col.itemIds.filter(id => id !== itemId);
    Storage.saveCollections(collections);
    renderCollections();
}

// ===== Proper Collection Select Modal =====
function openSelectCollectionModal(itemIds) {
    if (itemIds) pendingCollectionItemIds = Array.isArray(itemIds) ? itemIds : [itemIds];
    const list = document.getElementById('collection-list');
    
    if (collections.length === 0) {
        list.innerHTML = '<p style="color:var(--text-muted);padding:8px 0">Подборок пока нет. Создайте новую ниже.</p>';
    } else {
        list.innerHTML = collections.map(col => `
            <div class="collection-select-item" onclick="confirmAddToCollection('${col.id}')">
                <span>${col.name}</span>
                <span style="color:var(--text-muted);font-size:12px">${col.itemIds.length} эл.</span>
            </div>
        `).join('');
    }
    
    document.getElementById('new-collection-from-select').value = '';
    document.getElementById('select-collection-modal').classList.add('open');
}

function confirmAddToCollection(colId) {
    const col = collections.find(c => c.id === colId);
    if (!col) return;
    
    let added = 0;
    pendingCollectionItemIds.forEach(id => {
        if (!col.itemIds.includes(id)) {
            col.itemIds.push(id);
            added++;
        }
    });
    
    Storage.saveCollections(collections);
    document.getElementById('select-collection-modal').classList.remove('open');
    
    selectedIds.clear();
    updateBulkBar();
    renderLibrary();
    renderCollections();
    
    alert(added > 0 ? `Добавлено ${added} в «${col.name}»` : 'Уже было в этой подборке');
}

document.getElementById('create-and-add-btn').addEventListener('click', () => {
    const name = document.getElementById('new-collection-from-select').value.trim();
    if (!name) return;
    
    const newCol = {
        id: 'col_' + Date.now(),
        name,
        itemIds: [...pendingCollectionItemIds],
        createdAt: new Date().toISOString()
    };
    collections.push(newCol);
    Storage.saveCollections(collections);
    
    document.getElementById('select-collection-modal').classList.remove('open');
    selectedIds.clear();
    updateBulkBar();
    renderLibrary();
    renderCollections();
    alert(`Создана подборка «${name}»`);
});

// Старый вызов (из деталей и TMDB) теперь открывает модалку
function promptAddToCollection(itemId) {
    openSelectCollectionModal([itemId]);
}

// ===== Analytics =====
function renderAnalytics() {
    const total = items.length;
    const watched = items.filter(i => i.status === 'watched').length;
    const watching = items.filter(i => i.status === 'watching').length;
    const planned = items.filter(i => i.status === 'planned').length;

    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-watched').textContent = watched;
    document.getElementById('stat-watching').textContent = watching;
    document.getElementById('stat-planned').textContent = planned;

    // Genres chart
    const genreCount = {};
    items.forEach(item => {
        (item.genres || []).forEach(g => {
            genreCount[g] = (genreCount[g] || 0) + 1;
        });
    });

    const genreLabels = Object.keys(genreCount).slice(0, 8);
    const genreData = genreLabels.map(g => genreCount[g]);

    const genresCtx = document.getElementById('genres-chart').getContext('2d');
    if (window.genresChart) window.genresChart.destroy();
    window.genresChart = new Chart(genresCtx, {
        type: 'doughnut',
        data: {
            labels: genreLabels.length ? genreLabels : ['Нет данных'],
            datasets: [{
                data: genreData.length ? genreData : [1],
                backgroundColor: ['#6c5ce7','#a29bfe','#00b894','#fdcb6e','#e17055','#74b9ff','#fd79a8','#55efc4']
            }]
        },
        options: {
            plugins: { legend: { position: 'bottom', labels: { color: getComputedStyle(document.documentElement).getPropertyValue('--text-muted') } } }
        }
    });

    // Sources chart
    const sourceCount = { streaming: 0, local: 0, physical: 0 };
    items.forEach(i => sourceCount[i.source] = (sourceCount[i.source] || 0) + 1);

    const sourcesCtx = document.getElementById('sources-chart').getContext('2d');
    if (window.sourcesChart) window.sourcesChart.destroy();
    window.sourcesChart = new Chart(sourcesCtx, {
        type: 'bar',
        data: {
            labels: ['Стриминг', 'Локальные', 'Физические'],
            datasets: [{
                label: 'Количество',
                data: [sourceCount.streaming, sourceCount.local, sourceCount.physical],
                backgroundColor: ['#6c5ce7', '#00b894', '#fdcb6e']
            }]
        },
        options: {
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, ticks: { color: '#a0a0b0' }, grid: { color: '#2a2a3a' } },
                x: { ticks: { color: '#a0a0b0' }, grid: { display: false } }
            }
        }
    });

    // Unfinished report (including series with progress < 100%)
    const unfinished = items.filter(i => {
        if (i.status === 'watching' || i.status === 'planned') return true;
        if (i.type === 'series' && i.episodes > 0 && (i.watchedEpisodes || 0) < i.episodes) return true;
        return false;
    });

    const list = document.getElementById('unfinished-list');
    if (unfinished.length === 0) {
        list.innerHTML = '<p style="color:var(--text-muted)">Недосмотренного контента нет 🎉</p>';
    } else {
        list.innerHTML = unfinished.map(i => {
            const progress = getProgress(i);
            return `
            <div class="unfinished-item">
                <div>
                    <strong>${i.title}</strong>
                    <small style="color:var(--text-muted)"> (${statusLabel(i.status)})</small>
                    ${progress ? `<div class="progress-wrap" style="margin-top:6px;max-width:200px">
                        <div class="progress-bar"><div class="progress-fill" style="width:${progress.percent}%"></div></div>
                        <div class="progress-text">${progress.watched}/${progress.total} эп.</div>
                    </div>` : ''}
                </div>
                <span style="color:var(--text-muted)">${i.year || ''}</span>
            </div>
        `}).join('');
    }
}

// ===== Init =====
(async function init() {
    if (Storage.getToken()) {
        try {
            const data = await Storage.api('/api/me');
            currentUser = data.user;
            Storage.setCachedUser(data.user);
            await showApp();
        } catch {
            Storage.setToken(null);
            Storage.setCachedUser(null);
            showAuth();
        }
    } else {
        showAuth();
    }
})();

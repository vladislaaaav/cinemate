// ====================== Cinemate App ======================
// Полностью соответствует ТЗ + тёмная/светлая тема + экспорт/импорт + прогресс сезонов/эпизодов

// ===== Внешние API (ключи в api-keys.js) =====
const _keys = (typeof window !== 'undefined' && window.CINEMATE_KEYS) ? window.CINEMATE_KEYS : {};
const KP_API_KEY = _keys.kinopoisk || '';
const KP_BASE = 'https://kinopoiskapiunofficial.tech';
const TMDB_API_KEY = _keys.tmdb || '';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w500';

const KP_KEY_PLACEHOLDER = 'ВАШ_КЛЮЧ_КИНОПОИСК';
const TMDB_KEY_PLACEHOLDER = 'ВАШ_КЛЮЧ_TMDB';

function hasKpKey() {
    return KP_API_KEY && KP_API_KEY !== KP_KEY_PLACEHOLDER;
}
function hasTmdbKey() {
    return TMDB_API_KEY && TMDB_API_KEY !== TMDB_KEY_PLACEHOLDER;
}

let currentApiSource = 'kinopoisk'; // kinopoisk | tmdb

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
        return this.api('/api/collections', { method: 'PUT', body: JSON.stringify(cols) })
            .catch(e => { console.error(e); toast('Ошибка сохранения подборок'); throw e; });
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

// ===== Profile =====
document.getElementById('profile-btn')?.addEventListener('click', () => {
    const u = currentUser || Storage.getCachedUser() || {};
    document.getElementById('profile-name').value = u.name || '';
    document.getElementById('profile-email').value = u.email || '';
    document.getElementById('profile-pass-current').value = '';
    document.getElementById('profile-pass-new').value = '';
    document.getElementById('profile-msg').textContent = '';
    document.getElementById('profile-modal').classList.add('open');
});

document.getElementById('profile-save')?.addEventListener('click', async () => {
    const name = document.getElementById('profile-name').value.trim();
    const email = document.getElementById('profile-email').value.trim().toLowerCase();
    const msg = document.getElementById('profile-msg');
    try {
        const data = await Storage.api('/api/me', {
            method: 'PUT',
            body: JSON.stringify({ name, email })
        });
        currentUser = data.user;
        Storage.setCachedUser(data.user);
        document.getElementById('current-user-name').textContent = data.user.name;
        document.getElementById('current-user-email').textContent = data.user.email;
        msg.style.color = 'var(--primary)';
        msg.textContent = 'Профиль сохранён';
        toast('Профиль обновлён');
    } catch (e) {
        msg.style.color = 'var(--danger)';
        msg.textContent = e.message;
    }
});

document.getElementById('profile-pass-save')?.addEventListener('click', async () => {
    const currentPassword = document.getElementById('profile-pass-current').value;
    const newPassword = document.getElementById('profile-pass-new').value;
    const msg = document.getElementById('profile-msg');
    try {
        await Storage.api('/api/me/password', {
            method: 'PUT',
            body: JSON.stringify({ currentPassword, newPassword })
        });
        document.getElementById('profile-pass-current').value = '';
        document.getElementById('profile-pass-new').value = '';
        msg.style.color = 'var(--primary)';
        msg.textContent = 'Пароль изменён';
        toast('Пароль изменён');
    } catch (e) {
        msg.style.color = 'var(--danger)';
        msg.textContent = e.message;
    }
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

function bindTap(el, fn) {
    if (!el) return;
    el.addEventListener('click', fn);
    el.addEventListener('touchend', (e) => { e.preventDefault(); fn(e); }, { passive: false });
}
bindTap(document.getElementById('menu-toggle'), openMobileSidebar);
bindTap(document.getElementById('sidebar-close'), closeMobileSidebar);
bindTap(document.getElementById('sidebar-overlay'), closeMobileSidebar);

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
        if (btn.dataset.page === 'collections') { renderCollections(); }

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
                    <span class="source-badge ${sourceBadgeClass(item)}">${sourceLabel(item)}</span>
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
        tmdbId: null,
        kinopoiskId: null,
        dataSource: 'manual'
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

// ===== External Search (Kinopoisk first, then TMDB) =====
function sourceLabel(item) {
    if (item.dataSource === 'kinopoisk' || item.kinopoiskId) return 'Кинопоиск';
    if (item.dataSource === 'tmdb' || item.tmdbId) return 'TMDB';
    return 'Вручную';
}
function sourceBadgeClass(item) {
    if (item.dataSource === 'kinopoisk' || item.kinopoiskId) return 'kp';
    if (item.dataSource === 'tmdb' || item.tmdbId) return 'tmdb';
    return 'manual';
}

function normTitle(s) {
    return (s || '').toLowerCase().replace(/[«»"'.:,!?—–-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function resultKey(title, year) {
    return normTitle(title) + '|' + String(year || '').slice(0, 4);
}

function updateApiHint() {
    const hint = document.getElementById('api-hint');
    if (!hint) return;
    hint.innerHTML = 'Приоритет: <b>Кинопоиск</b>, если пусто — TMDB. Дубликаты не показываются.';
}

document.getElementById('ext-search-btn')?.addEventListener('click', searchExternal);
document.getElementById('ext-search')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') searchExternal();
});
document.getElementById('tmdb-search-btn')?.addEventListener('click', searchExternal);
document.getElementById('tmdb-search')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') searchExternal();
});

updateApiHint();

function renderSearchCards(list, resultsDiv) {
    if (!list.length) {
        resultsDiv.innerHTML = '<p>Ничего не найдено ни в Кинопоиске, ни в TMDB</p>';
        return;
    }
    resultsDiv.innerHTML = list.map(entry => {
        const { source, raw, title, year, poster, typeLabel: tl, rating } = entry;
        const badge = source === 'kinopoisk'
            ? '<span class="source-badge kp">Кинопоиск</span>'
            : '<span class="source-badge tmdb">TMDB</span>';
        const rawStr = JSON.stringify(raw).replace(/</g, '\\u003c').replace(/'/g, '&#39;');
        const addFn = source === 'kinopoisk' ? 'addFromKP' : 'addFromTMDB';
        const colFn = source === 'kinopoisk' ? 'addFromKPToCollection' : 'addFromTMDBToCollection';
        return `
            <div class="tmdb-card">
                ${badge}
                <div onclick='${addFn}(${rawStr})' style="cursor:pointer">
                    ${poster ? `<img src="${poster}" alt="" loading="lazy">` : '<div class="tmdb-no-poster">🎬</div>'}
                    <div class="tmdb-card-info">
                        <strong>${title}</strong>
                        <span>${year || ''} · ${tl} ${rating || ''}</span>
                    </div>
                </div>
                <div style="display:flex;gap:6px;padding:0 8px 8px">
                    <button class="btn-primary" style="flex:1;padding:6px;font-size:12px" onclick='${addFn}(${rawStr})'>В библиотеку</button>
                    <button class="btn-secondary" style="padding:6px 10px;font-size:12px" onclick='${colFn}(${rawStr})' title="В подборку">📁</button>
                </div>
            </div>`;
    }).join('');
}

async function fetchKpFilms(query) {
    try {
        const res = await fetch(`${API_BASE}/api/kp/search?keyword=${encodeURIComponent(query)}&page=1`);
        let data = await res.json().catch(() => ({}));
        if (res.status === 401 && hasKpKey()) {
            data = await searchKinopoiskDirect(query);
        } else if (!res.ok) {
            if (hasKpKey()) data = await searchKinopoiskDirect(query);
            else return { films: [], error: data.error || 'KP error' };
        }
        return { films: data.films || [], error: null };
    } catch (e) {
        if (hasKpKey()) {
            try {
                const data = await searchKinopoiskDirect(query);
                return { films: data.films || [], error: null };
            } catch (e2) {
                return { films: [], error: e2.message };
            }
        }
        return { films: [], error: e.message };
    }
}

async function fetchTmdbFilms(query) {
    if (!hasTmdbKey()) return { results: [], error: 'no key' };
    try {
        const res = await fetch(`${TMDB_BASE}/search/multi?api_key=${TMDB_API_KEY}&language=ru-RU&query=${encodeURIComponent(query)}`);
        const data = await res.json();
        if (!res.ok) return { results: [], error: data.status_message || 'TMDB error' };
        return {
            results: (data.results || []).filter(r => r.media_type === 'movie' || r.media_type === 'tv'),
            error: null
        };
    } catch (e) {
        return { results: [], error: e.message };
    }
}

async function searchExternal() {
    const input = document.getElementById('ext-search') || document.getElementById('tmdb-search');
    const resultsDiv = document.getElementById('ext-results') || document.getElementById('tmdb-results');
    const query = (input?.value || '').trim();
    if (!query || !resultsDiv) return;

    resultsDiv.innerHTML = '<p style="color:var(--text-muted)">Ищем в Кинопоиске...</p>';

    const seen = new Set();
    const list = [];

    // 1) Kinopoisk first
    const kp = await fetchKpFilms(query);
    for (const f of (kp.films || []).slice(0, 20)) {
        const title = f.nameRu || f.nameEn || f.nameOriginal || 'Без названия';
        const year = String(f.year || '').slice(0, 4);
        const key = resultKey(title, year);
        if (seen.has(key)) continue;
        // skip if already in library
        if (items.some(i =>
            (f.filmId && i.kinopoiskId && String(i.kinopoiskId) === String(f.filmId)) ||
            (normTitle(i.title) === normTitle(title) && String(i.year || '') === year)
        )) continue;
        seen.add(key);
        const typeLabel = (f.type === 'TV_SERIES' || f.type === 'MINI_SERIES' || f.type === 'TV_SHOW') ? 'Сериал' : 'Фильм';
        const rating = f.rating && f.rating !== 'null' ? `★ ${f.rating}` : '';
        list.push({
            source: 'kinopoisk',
            raw: f,
            title,
            year,
            poster: f.posterUrlPreview || f.posterUrl || null,
            typeLabel,
            rating
        });
    }

    // 2) TMDB only if KP empty (priority Kinopoisk)
    if (list.length === 0) {
        resultsDiv.innerHTML = '<p style="color:var(--text-muted)">В Кинопоиске пусто, ищем в TMDB...</p>';
        const tm = await fetchTmdbFilms(query);
        for (const r of (tm.results || []).slice(0, 12)) {
            const title = r.title || r.name || 'Без названия';
            const year = (r.release_date || r.first_air_date || '').slice(0, 4);
            const key = resultKey(title, year);
            if (seen.has(key)) continue;
            if (items.some(i =>
                (r.id && i.tmdbId && String(i.tmdbId) === String(r.id)) ||
                (normTitle(i.title) === normTitle(title) && String(i.year || '') === year)
            )) continue;
            seen.add(key);
            list.push({
                source: 'tmdb',
                raw: r,
                title,
                year,
                poster: r.poster_path ? TMDB_IMG + r.poster_path : null,
                typeLabel: r.media_type === 'tv' ? 'Сериал' : 'Фильм',
                rating: r.vote_average ? `★ ${Number(r.vote_average).toFixed(1)}` : ''
            });
        }
        if (list.length === 0 && kp.error && !hasKpKey() && !hasTmdbKey()) {
            resultsDiv.innerHTML = `
                <div style="grid-column:1/-1;padding:20px;background:var(--bg-card);border-radius:12px;border:1px solid var(--border)">
                    <p><strong>Не заданы ключи API.</strong></p>
                    <p style="margin-top:10px;color:var(--text-muted)">Кинопоиск: переменная <code>KP_API_KEY</code> на Render или <code>api-keys.js</code>. TMDB: ключ в <code>api-keys.js</code>.</p>
                </div>`;
            return;
        }
    }

    renderSearchCards(list, resultsDiv);
}

async function searchKinopoisk(query, resultsDiv) {
    try {
        // Сначала пробуем прокси сервера (ключ на сервере: KP_API_KEY)
        let data;
        try {
            const res = await fetch(`${API_BASE}/api/kp/search?keyword=${encodeURIComponent(query)}&page=1`);
            data = await res.json().catch(() => ({}));
            if (res.status === 401) {
                // нет ключа на сервере — fallback на ключ из api-keys.js
                if (!hasKpKey()) {
                    resultsDiv.innerHTML = `
                        <div style="grid-column:1/-1;padding:20px;background:var(--bg-card);border-radius:12px;border:1px solid var(--border)">
                            <p><strong>Ошибка 401 — ключ Кинопоиска не принят.</strong></p>
                            <p style="margin-top:12px">Сделайте одно из двух:</p>
                            <ol style="margin:12px 0 0 20px;color:var(--text-muted);line-height:1.6">
                                <li><b>На Render:</b> Environment → добавьте <code>KP_API_KEY</code> = ваш токен с <a href="https://kinopoiskapiunofficial.tech" target="_blank" style="color:var(--primary)">kinopoiskapiunofficial.tech</a>, затем Redeploy.</li>
                                <li><b>Локально:</b> впишите токен в <code>api-keys.js</code> → <code>kinopoisk</code>.</li>
                            </ol>
                            <p style="margin-top:12px;color:var(--text-muted)">${data.error || ''}</p>
                        </div>`;
                    return;
                }
                data = await searchKinopoiskDirect(query);
            } else if (!res.ok) {
                throw new Error(data.error || ('HTTP ' + res.status));
            }
        } catch (proxyErr) {
            // сервер недоступен — прямой запрос с клиентским ключом
            if (!hasKpKey()) throw proxyErr;
            data = await searchKinopoiskDirect(query);
        }

        const films = data.films || [];
        if (!films.length) {
            resultsDiv.innerHTML = '<p>Ничего не найдено в Кинопоиске</p>';
            return;
        }
        resultsDiv.innerHTML = films.slice(0, 12).map(f => {
            const title = f.nameRu || f.nameEn || f.nameOriginal || 'Без названия';
            const year = f.year || '';
            const poster = f.posterUrlPreview || f.posterUrl || null;
            const typeLabel = (f.type === 'TV_SERIES' || f.type === 'MINI_SERIES' || f.type === 'TV_SHOW') ? 'Сериал' : 'Фильм';
            const rating = f.rating && f.rating !== 'null' ? `★ ${f.rating}` : '';
            const rawStr = JSON.stringify(f).replace(/</g, '\\u003c').replace(/'/g, '&#39;');
            return `
                <div class="tmdb-card">
                    <div onclick='addFromKP(${rawStr})' style="cursor:pointer">
                        ${poster ? `<img src="${poster}" alt="" loading="lazy">` : '<div class="tmdb-no-poster">🎬</div>'}
                        <div class="tmdb-card-info">
                            <strong>${title}</strong>
                            <span>${year} · ${typeLabel} ${rating}</span>
                        </div>
                    </div>
                    <div style="display:flex;gap:6px;padding:0 8px 8px">
                        <button class="btn-primary" style="flex:1;padding:6px;font-size:12px" onclick='addFromKP(${rawStr})'>В библиотеку</button>
                        <button class="btn-secondary" style="padding:6px 10px;font-size:12px" onclick='addFromKPToCollection(${rawStr})' title="В подборку">📁</button>
                    </div>
                </div>`;
        }).join('');
    } catch (e) {
        console.error(e);
        resultsDiv.innerHTML = `<p style="color:var(--danger)">Ошибка Кинопоиска: ${e.message}</p>`;
    }
}

async function searchKinopoiskDirect(query) {
    const key = (KP_API_KEY || '').trim();
    const res = await fetch(
        `${KP_BASE}/api/v2.1/films/search-by-keyword?keyword=${encodeURIComponent(query)}&page=1`,
        { headers: { 'X-API-KEY': key, 'Accept': 'application/json' } }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        if (res.status === 401) {
            throw new Error('401: неверный ключ в api-keys.js. Скопируйте токен ещё раз с kinopoiskapiunofficial.tech (без пробелов и кавычек).');
        }
        throw new Error(data.message || data.error || ('HTTP ' + res.status));
    }
    return data;
}

async function kpFetchFilm(id, sub) {
    const path = sub ? `/api/kp/film/${id}/${sub}` : `/api/kp/film/${id}`;
    try {
        const res = await fetch(API_BASE + path);
        const data = await res.json().catch(() => ({}));
        if (res.ok) return data;
        if (res.status !== 401 || !hasKpKey()) {
            if (!res.ok) return null;
        }
    } catch (_) {}
    // fallback direct
    if (!hasKpKey()) return null;
    let url = `${KP_BASE}/api/v2.2/films/${id}`;
    if (sub === 'seasons') url += '/seasons';
    else if (sub === 'staff') url = `${KP_BASE}/api/v1/staff?filmId=${id}`;
    const res2 = await fetch(url, { headers: { 'X-API-KEY': KP_API_KEY.trim(), 'Accept': 'application/json' } });
    if (!res2.ok) return null;
    return res2.json();
}

async function createItemFromKP(raw) {
    let details = raw;
    let seasonsCount = null;
    let episodesTotal = null;
    const kpId = raw.filmId || raw.kinopoiskId;

    const full = await kpFetchFilm(kpId);
    if (full) details = full;

    const typeCode = details.type || raw.type || '';
    const isSeries = ['TV_SERIES', 'MINI_SERIES', 'TV_SHOW'].includes(typeCode);

    if (isSeries) {
        const sData = await kpFetchFilm(details.kinopoiskId || kpId, 'seasons');
        if (sData && sData.items) {
            seasonsCount = sData.items.length || null;
            episodesTotal = sData.items.reduce((sum, s) => sum + (s.episodes?.length || 0), 0) || null;
        }
    }

    const genres = (details.genres || raw.genres || [])
        .map(g => (typeof g === 'string' ? g : g.genre))
        .filter(Boolean);

    const title = details.nameRu || details.nameEn || details.nameOriginal || raw.nameRu || 'Без названия';
    const originalTitle = details.nameOriginal || details.nameEn || raw.nameEn || '';
    const year = details.year || raw.year || '';
    const overview = details.description || raw.description || '';
    const poster = details.posterUrl || details.posterUrlPreview || raw.posterUrl || raw.posterUrlPreview || null;
    const id = details.kinopoiskId || kpId;

    let director = '';
    const staff = await kpFetchFilm(id, 'staff');
    if (Array.isArray(staff)) {
        const dir = staff.find(p => p.professionKey === 'DIRECTOR' || p.professionText === 'Режиссеры');
        if (dir) director = dir.nameRu || dir.nameEn || '';
    }

    return {
        id: 'kp_' + id + '_' + Date.now(),
        title,
        originalTitle,
        type: isSeries ? 'series' : 'movie',
        year: year ? String(year) : '',
        genres,
        director,
        overview,
        status: 'planned',
        source: 'streaming',
        rating: 0,
        tags: [],
        review: '',
        seasons: seasonsCount,
        episodes: episodesTotal,
        watchedEpisodes: 0,
        poster,
        addedAt: new Date().toISOString(),
        tmdbId: null,
        kinopoiskId: id,
        dataSource: 'kinopoisk',
        kpRating: details.ratingKinopoisk || raw.rating || null
    };
}

async function addFromKP(raw) {
    try {
        toast('Загрузка данных с Кинопоиска...');
        const item = await createItemFromKP(raw);
        if (isDuplicate(item)) {
            toast(`«${item.title}» уже есть в библиотеке`);
            return;
        }
        items.unshift(item);
        Storage.saveItems(items);
        toast(`«${item.title}» добавлен`);
        document.querySelector('[data-page="library"]').click();
    } catch (e) {
        console.error(e);
        toast('Не удалось добавить: ' + e.message);
    }
}

async function addFromKPToCollection(raw) {
    try {
        const item = await createItemFromKP(raw);
        if (isDuplicate(item)) {
            const existing = items.find(i =>
                (item.kinopoiskId && i.kinopoiskId && String(i.kinopoiskId) === String(item.kinopoiskId)) ||
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
    } catch (e) {
        toast('Ошибка: ' + e.message);
    }
}

// ----- TMDB -----
async function searchTMDB(query, resultsDiv) {
    if (!hasTmdbKey()) {
        resultsDiv.innerHTML = `
            <div style="grid-column:1/-1;padding:20px;background:var(--bg-card);border-radius:12px;border:1px solid var(--border)">
                <p><strong>Вставьте API-ключ TMDB</strong> в начале <code>app.js</code> (<code>TMDB_API_KEY</code>).</p>
                <p style="margin-top:12px;color:var(--text-muted)">Бесплатно: <a href="https://www.themoviedb.org/settings/api" target="_blank" style="color:var(--primary)">themoviedb.org/settings/api</a></p>
            </div>`;
        return;
    }
    try {
        const res = await fetch(`${TMDB_BASE}/search/multi?api_key=${TMDB_API_KEY}&language=ru-RU&query=${encodeURIComponent(query)}`);
        const data = await res.json();
        if (!data.results || data.results.length === 0) {
            resultsDiv.innerHTML = '<p>Ничего не найдено в TMDB</p>';
            return;
        }
        resultsDiv.innerHTML = data.results
            .filter(r => r.media_type === 'movie' || r.media_type === 'tv')
            .slice(0, 12)
            .map(r => {
                const title = r.title || r.name;
                const year = (r.release_date || r.first_air_date || '').slice(0, 4);
                const poster = r.poster_path ? TMDB_IMG + r.poster_path : null;
                const rawStr = JSON.stringify(r).replace(/</g, '\\u003c').replace(/'/g, '&#39;');
                return `
                    <div class="tmdb-card">
                        <div onclick='addFromTMDB(${rawStr})' style="cursor:pointer">
                            ${poster ? `<img src="${poster}" alt="" loading="lazy">` : '<div class="tmdb-no-poster">🎬</div>'}
                            <div class="tmdb-card-info">
                                <strong>${title}</strong>
                                <span>${year} · ${r.media_type === 'tv' ? 'Сериал' : 'Фильм'}</span>
                            </div>
                        </div>
                        <div style="display:flex;gap:6px;padding:0 8px 8px">
                            <button class="btn-primary" style="flex:1;padding:6px;font-size:12px" onclick='addFromTMDB(${rawStr})'>В библиотеку</button>
                            <button class="btn-secondary" style="padding:6px 10px;font-size:12px" onclick='addFromTMDBToCollection(${rawStr})' title="В подборку">📁</button>
                        </div>
                    </div>`;
            }).join('');
    } catch (e) {
        console.error(e);
        resultsDiv.innerHTML = '<p style="color:var(--danger)">Ошибка запроса к TMDB</p>';
    }
}

async function createItemFromTMDB(raw) {
    const type = raw.media_type === 'tv' ? 'tv' : 'movie';
    let details = raw;
    try {
        const res = await fetch(`${TMDB_BASE}/${type}/${raw.id}?api_key=${TMDB_API_KEY}&language=ru-RU&append_to_response=credits`);
        if (res.ok) details = await res.json();
    } catch (_) {}

    const director = (details.credits?.crew || [])
        .filter(c => c.job === 'Director')
        .map(c => c.name)
        .join(', ');

    return {
        id: 'tmdb_' + raw.id + '_' + Date.now(),
        title: details.title || details.name || raw.title || raw.name,
        originalTitle: details.original_title || details.original_name || '',
        type: type === 'tv' ? 'series' : 'movie',
        year: (details.release_date || details.first_air_date || '').slice(0, 4),
        genres: (details.genres || []).map(g => g.name),
        director: director || '',
        overview: details.overview || '',
        status: 'planned',
        source: 'streaming',
        rating: 0,
        tags: [],
        review: '',
        seasons: details.number_of_seasons || null,
        episodes: details.number_of_episodes || null,
        watchedEpisodes: 0,
        poster: details.poster_path ? TMDB_IMG + details.poster_path : null,
        addedAt: new Date().toISOString(),
        tmdbId: raw.id,
        kinopoiskId: null,
        dataSource: 'tmdb'
    };
}

function isDuplicate(item) {
    return items.some(i => {
        if (item.tmdbId && i.tmdbId && String(i.tmdbId) === String(item.tmdbId)) return true;
        if (item.kinopoiskId && i.kinopoiskId && String(i.kinopoiskId) === String(item.kinopoiskId)) return true;
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
                <p style="margin:6px 0 8px"><span class="source-badge ${sourceBadgeClass(item)}">${sourceLabel(item)}</span></p>
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

// ===== Collections (open / closed + share link) =====
function makeShareId() {
    const a = new Uint8Array(9);
    crypto.getRandomValues(a);
    return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
}

function collectionShareUrl(shareId) {
    const base = (API_BASE || window.location.origin || '').replace(/\/$/, '');
    return `${base}/?share=${encodeURIComponent(shareId)}`;
}

document.getElementById('create-collection-btn')?.addEventListener('click', () => {
    document.getElementById('collection-name').value = '';
    const pub = document.getElementById('collection-public');
    if (pub) pub.checked = false;
    document.getElementById('collection-modal').classList.add('open');
});

document.getElementById('save-collection')?.addEventListener('click', () => {
    const name = document.getElementById('collection-name').value.trim();
    if (!name) return;
    const isPublic = !!document.getElementById('collection-public')?.checked;
    const shareId = isPublic ? makeShareId() : null;

    collections.push({
        id: 'col_' + Date.now(),
        name,
        itemIds: [],
        isPublic,
        shareId,
        createdAt: new Date().toISOString()
    });
    Storage.saveCollections(collections);
    document.getElementById('collection-name').value = '';
    document.getElementById('collection-modal').classList.remove('open');
    renderCollections();
    if (isPublic && shareId) {
        toast('Открытая подборка создана. Скопируйте ссылку на карточке.');
    }
});

function renderCollections() {
    const list = document.getElementById('collections-list');
    if (!list) return;
    if (collections.length === 0) {
        list.innerHTML = `<div class="empty-state"><span>📁</span><p>Подборок пока нет. Создайте первую!</p></div>`;
        return;
    }

    list.innerHTML = collections.map(col => {
        const count = items.filter(i => col.itemIds.includes(i.id)).length;
        const isPub = !!col.isPublic && col.shareId;
        const sharedN = (col.sharedWith || []).length;
        const badge = isPub
            ? '<span class="badge-open">Открытая</span>'
            : (sharedN ? '<span class="badge-open">Общая · ' + sharedN + '</span>' : '<span class="badge-closed">Закрытая</span>');
        return `
        <div class="collection-card">
            <h3 onclick="openCollectionView('${col.id}')" style="cursor:pointer">${col.name}${badge}</h3>
            <div class="count">${count} элементов</div>
            <div class="collection-actions">
                <button class="btn-primary" onclick="openCollectionView('${col.id}')">Открыть</button>
                <button class="btn-secondary" onclick="toggleCollectionPublic('${col.id}')">${isPub ? 'Сделать закрытой' : 'Сделать открытой'}</button>
                ${isPub ? `<button class="btn-secondary" onclick="copyCollectionLink('${col.id}')">📋 Ссылка</button>` : ''}
                <button class="btn-secondary" onclick="openShareUserModal('${col.id}')">👥 Доступ</button>
                <button class="btn-secondary" onclick="deleteCollection('${col.id}')">Удалить</button>
            </div>
            ${isPub ? `<p class="hint" style="margin-top:10px;font-size:12px;word-break:break-all">🔗 ${collectionShareUrl(col.shareId)}</p>` : ''}
            ${sharedN ? `<p class="hint" style="margin-top:6px;font-size:12px">Доступ: ${(col.sharedWith||[]).map(m => m.email || m.name).join(', ')}</p>` : ''}
        </div>`;
    }).join('');
    renderSharedWithMe();
}

let sharingCollectionId = null;

function openShareUserModal(colId) {
    const col = collections.find(c => c.id === colId);
    if (!col) return;
    sharingCollectionId = colId;
    if (!col.sharedWith) col.sharedWith = [];
    document.getElementById('share-user-col-name').textContent = 'Подборка: ' + col.name;
    document.getElementById('share-user-email').value = '';
    renderShareUserList();
    document.getElementById('share-user-modal').classList.add('open');
}

function renderShareUserList() {
    const col = collections.find(c => c.id === sharingCollectionId);
    const box = document.getElementById('share-user-list');
    if (!col || !box) return;
    const list = col.sharedWith || [];
    if (!list.length) {
        box.innerHTML = '<p class="hint">Пока никого нет. Добавьте пользователя по email.</p>';
        return;
    }
    box.innerHTML = list.map(m => `
        <div class="share-member">
            <span><strong>${m.name || ''}</strong><br><small>${m.email || ''}</small></span>
            <button class="btn-secondary" onclick="removeShareUser('${m.userId}')">Убрать</button>
        </div>
    `).join('');
}

document.getElementById('share-user-add')?.addEventListener('click', async () => {
    const email = document.getElementById('share-user-email').value.trim().toLowerCase();
    if (!email || !sharingCollectionId) return;
    try {
        const data = await Storage.api('/api/collections/share', {
            method: 'POST',
            body: JSON.stringify({ collectionId: sharingCollectionId, email })
        });
        // синхронизируем локальную копию
        const idx = collections.findIndex(c => c.id === sharingCollectionId);
        if (idx >= 0 && data.collection) {
            collections[idx] = data.collection;
        } else if (data.collection) {
            collections.push(data.collection);
        }
        document.getElementById('share-user-email').value = '';
        renderShareUserList();
        renderCollections();
        toast(data.message || ('Доступ выдан: ' + email));
    } catch (e) {
        toast(e.message || 'Не удалось выдать доступ');
    }
});

async function removeShareUser(userId) {
    if (!sharingCollectionId) return;
    try {
        const data = await Storage.api('/api/collections/share', {
            method: 'DELETE',
            body: JSON.stringify({ collectionId: sharingCollectionId, userId })
        });
        const idx = collections.findIndex(c => c.id === sharingCollectionId);
        if (idx >= 0 && data.collection) collections[idx] = data.collection;
        renderShareUserList();
        renderCollections();
        toast('Доступ закрыт');
    } catch (e) {
        toast(e.message || 'Ошибка');
    }
}

async function renderSharedWithMe() {
    const list = document.getElementById('shared-with-me-list');
    if (!list) return;
    list.innerHTML = '<p class="hint">Загрузка...</p>';
    try {
        const data = await Storage.api('/api/shared-with-me');
        const rows = Array.isArray(data) ? data : [];
        if (!rows.length) {
            list.innerHTML = '<div class="empty-state"><span>🔒</span><p>Нет общих закрытых подборок</p></div>';
            return;
        }
        list.innerHTML = rows.map(s => {
            const safeName = String(s.name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            return `
            <div class="collection-card">
                <h3>${s.name || 'Подборка'} <span class="badge-open">Общая</span></h3>
                <div class="count">${s.itemCount || 0} элементов · от ${s.ownerName || s.ownerEmail || 'пользователя'}</div>
                <div class="collection-actions">
                    <button class="btn-primary" onclick="openSharedCollection('${s.ownerId}','${s.collectionId}','${safeName}')">Открыть / править</button>
                </div>
            </div>`;
        }).join('');
    } catch (e) {
        console.error(e);
        list.innerHTML = '<p class="hint" style="color:var(--danger)">Не удалось загрузить: ' + (e.message || '') + '</p>';
    }
}

let sharedEdit = { ownerId: null, collectionId: null, items: [], name: '' };

function renderSharedEditModal() {
    const body = document.getElementById('modal-body');
    if (!body) return;
    const itemsList = sharedEdit.items || [];
    const inCol = new Set(itemsList.map(i => i.id));
    const myPool = (items || []).filter(i => !inCol.has(i.id));

    body.innerHTML = `
        <h2 style="margin-bottom:8px">Редактирование общей подборки</h2>
        <p class="hint" style="margin-bottom:12px">Вы можете менять название, удалять и добавлять фильмы (из своей библиотеки).</p>
        <div class="form-group">
            <label>Название</label>
            <input type="text" id="shared-edit-name" value="${(sharedEdit.name || '').replace(/"/g, '&quot;')}">
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin:12px 0">
            <button type="button" class="btn-primary" id="shared-edit-save">💾 Сохранить</button>
            <button type="button" class="btn-secondary" id="shared-edit-close">Закрыть</button>
        </div>
        <h3 style="font-size:15px;margin:16px 0 8px">В подборке (${itemsList.length})</h3>
        <div class="content-grid" id="shared-edit-grid">
            ${itemsList.length ? itemsList.map(item => `
                <div class="card" style="cursor:default">
                    <div class="card-poster">
                        ${item.poster ? `<img src="${item.poster}" alt="" loading="lazy">` : '🎬'}
                    </div>
                    <div class="card-body">
                        <div class="card-title">${item.title || ''}</div>
                        <div class="card-meta">${item.year || '—'}</div>
                        <button type="button" class="btn-secondary" style="margin-top:8px;width:100%;padding:8px;font-size:12px"
                            onclick="sharedEditRemove('${item.id}')">Удалить из подборки</button>
                    </div>
                </div>
            `).join('') : '<p class="hint" style="grid-column:1/-1">Пока пусто — добавьте фильмы ниже</p>'}
        </div>
        <h3 style="font-size:15px;margin:20px 0 8px">Добавить из моей библиотеки</h3>
        <div class="content-grid" id="shared-edit-pool">
            ${myPool.length ? myPool.map(item => `
                <div class="card" style="cursor:default">
                    <div class="card-poster">
                        ${item.poster ? `<img src="${item.poster}" alt="" loading="lazy">` : '🎬'}
                    </div>
                    <div class="card-body">
                        <div class="card-title">${item.title || ''}</div>
                        <button type="button" class="btn-primary" style="margin-top:8px;width:100%;padding:8px;font-size:12px"
                            onclick="sharedEditAdd('${item.id}')">+ Добавить</button>
                    </div>
                </div>
            `).join('') : '<p class="hint" style="grid-column:1/-1">В вашей библиотеке нет фильмов для добавления</p>'}
        </div>
    `;

    document.getElementById('shared-edit-save')?.addEventListener('click', sharedEditSave);
    document.getElementById('shared-edit-close')?.addEventListener('click', () => {
        document.getElementById('modal')?.classList.remove('open');
    });
}

function sharedEditRemove(itemId) {
    sharedEdit.items = (sharedEdit.items || []).filter(i => i.id !== itemId);
    renderSharedEditModal();
}

function sharedEditAdd(itemId) {
    const item = (items || []).find(i => i.id === itemId);
    if (!item) return;
    if ((sharedEdit.items || []).some(i => i.id === itemId)) return;
    // копия объекта — уйдёт на сервер в библиотеку владельца
    sharedEdit.items.push({ ...item });
    renderSharedEditModal();
}

async function sharedEditSave() {
    const name = document.getElementById('shared-edit-name')?.value.trim() || sharedEdit.name;
    try {
        toast('Сохранение...');
        const data = await Storage.api(
            `/api/shared-collection/${sharedEdit.ownerId}/${sharedEdit.collectionId}`,
            {
                method: 'PUT',
                body: JSON.stringify({
                    name,
                    itemIds: (sharedEdit.items || []).map(i => i.id),
                    upsertItems: sharedEdit.items || []
                })
            }
        );
        sharedEdit.name = data.name || name;
        sharedEdit.items = data.items || sharedEdit.items;
        toast('Подборка сохранена');
        renderSharedEditModal();
        renderSharedWithMe();
        renderCollections();
    } catch (e) {
        toast(e.message || 'Ошибка сохранения');
    }
}

async function openSharedCollection(ownerId, collectionId, name) {
    try {
        const data = await Storage.api(`/api/shared-collection/${ownerId}/${collectionId}`);
        sharedEdit = {
            ownerId: data.ownerId || ownerId,
            collectionId: data.collectionId || collectionId,
            name: data.name || name || 'Подборка',
            items: data.items || []
        };
        const modal = document.getElementById('modal');
        renderSharedEditModal();
        modal.classList.add('open');
    } catch (e) {
        toast(e.message || 'Нет доступа');
    }
}

window.openShareUserModal = openShareUserModal;
window.removeShareUser = removeShareUser;
window.openSharedCollection = openSharedCollection;
window.sharedEditRemove = sharedEditRemove;
window.sharedEditAdd = sharedEditAdd;


function toggleCollectionPublic(colId) {
    const col = collections.find(c => c.id === colId);
    if (!col) return;
    if (col.isPublic) {
        col.isPublic = false;
        // shareId оставляем, но без isPublic ссылка не работает
        toast('Подборка закрыта');
    } else {
        col.isPublic = true;
        if (!col.shareId) col.shareId = makeShareId();
        toast('Подборка открыта — можно делиться ссылкой');
    }
    Storage.saveCollections(collections);
    renderCollections();
}

async function copyCollectionLink(colId) {
    const col = collections.find(c => c.id === colId);
    if (!col || !col.shareId) return;
    const url = collectionShareUrl(col.shareId);
    try {
        await navigator.clipboard.writeText(url);
        toast('Ссылка скопирована');
    } catch {
        prompt('Скопируйте ссылку:', url);
    }
}

window.toggleCollectionPublic = toggleCollectionPublic;
window.copyCollectionLink = copyCollectionLink;

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
        isPublic: false,
        shareId: null,
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


// ===== Public share view (?share=xxx) =====
async function showPublicShare(shareId) {
    const auth = document.getElementById('auth-screen');
    const app = document.getElementById('app');
    const view = document.getElementById('public-share-view');
    if (auth) auth.style.display = 'none';
    if (auth) auth.classList.add('hidden');
    if (app) app.style.display = 'none';
    if (!view) return;
    view.style.display = 'block';

    const titleEl = document.getElementById('public-share-title');
    const metaEl = document.getElementById('public-share-meta');
    const grid = document.getElementById('public-share-grid');
    const err = document.getElementById('public-share-error');
    if (titleEl) titleEl.textContent = 'Загрузка...';
    if (grid) grid.innerHTML = '';
    if (err) { err.style.display = 'none'; err.textContent = ''; }

    try {
        const res = await fetch(`${API_BASE}/api/public/collection/${encodeURIComponent(shareId)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Не удалось открыть подборку');

        if (titleEl) titleEl.textContent = data.name || 'Подборка';
        if (metaEl) metaEl.textContent = `${data.itemCount || 0} фильмов · открытая подборка`;
        if (!grid) return;

        const list = data.items || [];
        if (!list.length) {
            grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><span>📁</span><p>В подборке пока пусто</p></div>';
            return;
        }
        grid.innerHTML = list.map(item => `
            <div class="card" style="cursor:default">
                <div class="card-poster">
                    ${item.poster ? `<img src="${item.poster}" alt="" loading="lazy">` : '🎬'}
                    <span class="source-badge ${item.kinopoiskId ? 'kp' : (item.tmdbId ? 'tmdb' : 'manual')}">${item.kinopoiskId ? 'Кинопоиск' : (item.tmdbId ? 'TMDB' : 'Вручную')}</span>
                </div>
                <div class="card-body">
                    <div class="card-title">${item.title || ''}</div>
                    <div class="card-meta">
                        ${item.year || '—'} · ${item.type === 'series' ? 'Сериал' : 'Фильм'}
                        ${item.genres && item.genres.length ? `<br><span style="opacity:0.8">${item.genres.slice(0,3).join(', ')}</span>` : ''}
                    </div>
                    ${item.overview ? `<p style="font-size:12px;color:var(--text-muted);margin-top:8px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">${item.overview}</p>` : ''}
                </div>
            </div>
        `).join('');
    } catch (e) {
        if (titleEl) titleEl.textContent = 'Подборка недоступна';
        if (err) {
            err.style.display = 'block';
            err.textContent = e.message || 'Ошибка';
        }
    }
}

function getShareIdFromUrl() {
    try {
        return new URLSearchParams(window.location.search).get('share') || '';
    } catch {
        return '';
    }
}


// ===== Init =====
(async function init() {
    const shareId = getShareIdFromUrl();
    if (shareId) {
        await showPublicShare(shareId);
        return;
    }
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

// onclick-handlers from search cards
window.addFromKP = addFromKP;
window.addFromKPToCollection = addFromKPToCollection;
window.addFromTMDB = addFromTMDB;
window.addFromTMDBToCollection = addFromTMDBToCollection;

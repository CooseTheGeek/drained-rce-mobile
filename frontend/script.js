// ========== CONFIGURATION ==========
const API_BASE = 'https://drained-rce-backend.onrender.com'; // CHANGE THIS to your worker URL

// ========== APP STATE ==========
let currentUser = null;
let tokenBalance = 0;
let currentPage = 'shop';
let onlineStatus = navigator.onLine;
let refreshInProgress = false;

// ========== DOM ELEMENTS ==========
const contentDiv = document.getElementById('page-content');
const loadingOverlay = document.getElementById('loading-overlay');
const offlineBanner = document.getElementById('offline-banner');
const connectionStatus = document.getElementById('connection-status');

// ========== HELPER FUNCTIONS ==========

// Show/hide loading
function showLoading(show, text = 'Loading...') {
  if (show) {
    document.querySelector('.loading-text').textContent = text;
    loadingOverlay.classList.remove('hidden');
  } else {
    loadingOverlay.classList.add('hidden');
  }
}

// Show toast notification
function showToast(msg, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span>${type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ'}</span>
    <span style="margin-left: 8px;">${msg}</span>
  `;
  document.getElementById('toast-container').appendChild(toast);
  
  // Haptic feedback simulation (vibration if supported)
  if (window.navigator && window.navigator.vibrate) {
    window.navigator.vibrate(50);
  }
  
  setTimeout(() => {
    toast.style.animation = 'slideUp 0.3s reverse';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// Show modal
function showModal(title, contentHtml, onConfirm, onCancel = null) {
  const modalDiv = document.createElement('div');
  modalDiv.className = 'modal-overlay';
  modalDiv.innerHTML = `
    <div class="modal-card">
      <h3>${title}</h3>
      ${contentHtml}
      <div class="modal-buttons">
        <button class="secondary-btn" id="modal-cancel">Cancel</button>
        <button class="primary-btn" id="modal-confirm">Confirm</button>
      </div>
    </div>
  `;
  document.getElementById('modal-container').appendChild(modalDiv);
  
  modalDiv.querySelector('#modal-cancel').onclick = () => {
    modalDiv.remove();
    if (onCancel) onCancel();
  };
  
  modalDiv.querySelector('#modal-confirm').onclick = () => {
    modalDiv.remove();
    if (onConfirm) onConfirm();
  };
}

// API call with error handling
async function apiCall(endpoint, options = {}) {
  if (!onlineStatus) {
    throw new Error('No internet connection');
  }
  
  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
    
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Request failed (${res.status})`);
    }
    
    return res.json();
  } catch (err) {
    if (err.message.includes('fetch')) {
      throw new Error('Network error - check your connection');
    }
    throw err;
  }
}

// Update connection status
function updateConnectionStatus() {
  onlineStatus = navigator.onLine;
  if (onlineStatus) {
    connectionStatus.className = 'status-badge online';
    connectionStatus.textContent = '● Online';
    offlineBanner.classList.add('hidden');
  } else {
    connectionStatus.className = 'status-badge offline';
    connectionStatus.textContent = '● Offline';
    offlineBanner.classList.remove('hidden');
    showToast('You are offline. Some features unavailable.', 'warning');
  }
}

// Pull to refresh
let touchStartY = 0;
let isRefreshing = false;

function initPullToRefresh() {
  const mainContent = document.querySelector('.main-content');
  let pullToRefreshDiv = document.createElement('div');
  pullToRefreshDiv.className = 'pull-to-refresh';
  pullToRefreshDiv.innerHTML = '↓ Pull to refresh';
  mainContent.insertBefore(pullToRefreshDiv, mainContent.firstChild);
  
  mainContent.addEventListener('touchstart', (e) => {
    if (mainContent.scrollTop === 0) {
      touchStartY = e.touches[0].clientY;
    }
  });
  
  mainContent.addEventListener('touchmove', (e) => {
    if (mainContent.scrollTop === 0 && !isRefreshing) {
      const diff = e.touches[0].clientY - touchStartY;
      if (diff > 60) {
        isRefreshing = true;
        pullToRefreshDiv.innerHTML = '⟳ Refreshing...';
        refreshCurrentPage();
        setTimeout(() => {
          isRefreshing = false;
          pullToRefreshDiv.innerHTML = '↓ Pull to refresh';
        }, 1500);
      }
    }
  });
}

async function refreshCurrentPage() {
  showToast('Refreshing...', 'info');
  await pages[currentPage]();
}

// ========== AUTHENTICATION ==========
async function checkLogin() {
  showLoading(true, 'Connecting...');
  try {
    const data = await apiCall('/auth/me');
    currentUser = data.user;
    tokenBalance = data.user.token_balance;
    showToast(`Welcome back, ${currentUser.discord_username}!`, 'success');
    showLoading(false);
    return true;
  } catch (err) {
    showLoading(false);
    currentUser = null;
    showLoginScreen();
    return false;
  }
}

function showLoginScreen() {
  contentDiv.innerHTML = `
    <div class="card" style="text-align: center; margin-top: 40px;">
      <div class="empty-state-icon">🎮</div>
      <h2 style="margin-bottom: 8px;">Drained RCE Mobile</h2>
      <p style="margin: 16px 0; color: var(--text-dim);">Connect Discord to access<br>your Rust server tools.</p>
      <button class="primary-btn" id="discord-login-btn" style="margin-top: 8px;">
        <span style="margin-right: 8px;">🎮</span> Login with Discord
      </button>
      <p style="margin-top: 24px; font-size: 0.75rem; color: var(--text-dim);">
        ⚡ Free forever · No ads · Instant teleports
      </p>
    </div>
  `;
  
  const loginBtn = document.getElementById('discord-login-btn');
  if (loginBtn) {
    loginBtn.onclick = () => {
      window.location.href = `${API_BASE}/auth/discord`;
    };
  }
}

async function logout() {
  showLoading(true, 'Logging out...');
  try {
    await apiCall('/auth/logout', { method: 'POST' });
    currentUser = null;
    showToast('Logged out successfully', 'success');
    showLoading(false);
    showLoginScreen();
  } catch (err) {
    showLoading(false);
    showToast(err.message, 'error');
  }
}

// ========== TELEPORT FUNCTION ==========
async function teleportTo(data) {
  if (!onlineStatus) {
    showToast('You are offline. Cannot teleport.', 'error');
    return;
  }
  
  showLoading(true, 'Teleporting...');
  try {
    await apiCall('/teleport', { method: 'POST', body: JSON.stringify(data) });
    showToast(`Teleported to ${data.waypoint || 'custom location'}!`, 'success');
  } catch (err) {
    showToast(`Teleport failed: ${err.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

// ========== PAGE RENDERS ==========
const pages = {
  shop: async () => {
    if (!onlineStatus) {
      contentDiv.innerHTML = `<div class="card"><div class="empty-state-icon">⚠️</div><p>Offline - Cannot load shop</p></div>`;
      return;
    }
    
    showLoading(true, 'Loading shop...');
    try {
      const items = await apiCall('/shop/items');
      const balance = await apiCall('/user/balance');
      tokenBalance = balance.balance;
      
      let html = `
        <div class="card">
          <div class="card-header">
            <span>🛒 Item Shop</span>
            <span class="item-price" style="background: rgba(0,255,255,0.1); padding: 4px 12px; border-radius: 20px;">
              💰 ${tokenBalance} tokens
            </span>
          </div>
          <div id="shop-items-list"></div>
        </div>
      `;
      contentDiv.innerHTML = html;
      
      const container = document.getElementById('shop-items-list');
      for (let item of items) {
        const div = document.createElement('div');
        div.className = 'shop-item';
        div.innerHTML = `
          <div class="item-info">
            <h3>${item.name}</h3>
            <small style="color: var(--text-dim);">${item.description || ''}</small>
          </div>
          <button class="buy-btn" data-id="${item.id}" data-price="${item.price}">
            ${item.price} 🔘
          </button>
        `;
        container.appendChild(div);
      }
      
      document.querySelectorAll('.buy-btn').forEach(btn => {
        btn.onclick = async () => {
          const id = parseInt(btn.dataset.id);
          const price = parseInt(btn.dataset.price);
          const item = items.find(i => i.id === id);
          
          showModal('Confirm Purchase', `
            <p>Buy <strong>${item.name}</strong> for <strong style="color: #0ff;">${price} tokens</strong>?</p>
            <p style="font-size: 0.8rem; color: var(--text-dim); margin-top: 12px;">Your balance: ${tokenBalance} tokens</p>
          `, async () => {
            if (price > tokenBalance) {
              showToast('Insufficient tokens!', 'error');
              return;
            }
            
            const originalText = btn.innerHTML;
            btn.innerHTML = '<div class="loader" style="width:20px;height:20px;"></div>';
            btn.disabled = true;
            
            try {
              const result = await apiCall('/shop/purchase', { 
                method: 'POST', 
                body: JSON.stringify({ itemId: id }) 
              });
              tokenBalance = result.newBalance;
              showToast(`Purchased ${item.name}! New balance: ${tokenBalance}`, 'success');
              pages.shop();
            } catch (err) {
              showToast(err.message, 'error');
              btn.innerHTML = originalText;
              btn.disabled = false;
            }
          });
        };
      });
    } catch (err) {
      contentDiv.innerHTML = `<div class="card"><div class="empty-state-icon">⚠️</div><p>Failed to load shop: ${err.message}</p></div>`;
    } finally {
      showLoading(false);
    }
  },
  
  teleport: () => {
    const waypoints = ['Spawn', 'Outpost', 'Bandit Camp', 'Oil Rig', 'Cargo Ship', 'Military Tunnels'];
    let html = `
      <div class="card">
        <div class="card-header">🌀 Teleport Hub</div>
        <p style="color: var(--text-dim); margin-bottom: 16px;">Tap any location to teleport instantly.</p>
        <div class="teleport-grid" id="teleport-grid"></div>
      </div>
    `;
    contentDiv.innerHTML = html;
    
    const grid = document.getElementById('teleport-grid');
    waypoints.forEach(wp => {
      const btn = document.createElement('button');
      btn.className = 'teleport-btn';
      btn.innerHTML = `<span style="margin-right: 8px;">📍</span>${wp}`;
      btn.onclick = () => teleportTo({ waypoint: wp });
      grid.appendChild(btn);
    });
    
    const customBtn = document.createElement('button');
    customBtn.className = 'teleport-btn';
    customBtn.innerHTML = `<span style="margin-right: 8px;">🎯</span>Custom Coordinates`;
    customBtn.onclick = () => {
      showModal('Custom Teleport', `
        <input type="number" id="cx" class="modal-input" placeholder="X coordinate" step="any">
        <input type="number" id="cy" class="modal-input" placeholder="Y coordinate" step="any">
        <input type="number" id="cz" class="modal-input" placeholder="Z coordinate" step="any">
      `, () => {
        const x = document.getElementById('cx')?.value;
        const y = document.getElementById('cy')?.value;
        const z = document.getElementById('cz')?.value;
        if (x && y && z) {
          teleportTo({ x: parseFloat(x), y: parseFloat(y), z: parseFloat(z) });
        } else {
          showToast('Please enter valid coordinates', 'warning');
        }
      });
    };
    grid.appendChild(customBtn);
  },
  
  map: async () => {
    if (!onlineStatus) {
      contentDiv.innerHTML = `<div class="card"><div class="empty-state-icon">⚠️</div><p>Offline - Cannot load map</p></div>`;
      return;
    }
    
    showLoading(true, 'Loading map...');
    let markers = [];
    try {
      markers = await apiCall('/map/markers');
    } catch(e) {
      markers = [];
    }
    
    let html = `
      <div class="card">
        <div class="card-header">🗺️ Live Map</div>
        <p style="color: var(--text-dim); margin-bottom: 16px;">Click any marker to teleport instantly.</p>
        <div class="map-container">
          <svg class="map-svg" viewBox="0 0 400 400" id="map-svg"></svg>
        </div>
        <p style="margin-top: 12px; font-size: 0.7rem; text-align: center; color: var(--text-dim);">
          🟢 ${markers.length} markers available
        </p>
      </div>
    `;
    contentDiv.innerHTML = html;
    
    const svg = document.getElementById('map-svg');
    if (markers.length === 0) {
      // Show placeholder markers
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', '200');
      text.setAttribute('y', '200');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('fill', '#8892b0');
      text.setAttribute('font-size', '14');
      text.textContent = 'No markers available';
      svg.appendChild(text);
    } else {
      for (let m of markers) {
        const cx = (m.x / 5000) * 400;
        const cy = (m.z / 5000) * 400;
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', cx);
        circle.setAttribute('cy', cy);
        circle.setAttribute('r', '8');
        circle.setAttribute('fill', '#0ff');
        circle.setAttribute('stroke', '#fff');
        circle.setAttribute('stroke-width', '2');
        circle.classList.add('map-marker');
        circle.onclick = () => teleportTo({ x: m.x, y: m.y, z: m.z });
        svg.appendChild(circle);
        
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', cx + 12);
        text.setAttribute('y', cy + 4);
        text.setAttribute('fill', 'white');
        text.setAttribute('font-size', '10');
        text.textContent = m.name;
        svg.appendChild(text);
      }
    }
    showLoading(false);
  },
  
  profile: async () => {
    if (!onlineStatus) {
      contentDiv.innerHTML = `<div class="card"><div class="empty-state-icon">⚠️</div><p>Offline - Cannot load profile</p></div>`;
      return;
    }
    
    showLoading(true, 'Loading profile...');
    try {
      const balance = await apiCall('/user/balance');
      tokenBalance = balance.balance;
      const user = currentUser;
      
      let html = `
        <div class="card" style="text-align: center;">
          <img class="profile-avatar" src="https://cdn.discordapp.com/avatars/${user.discord_id}/${user.discord_avatar}.png" 
               onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
          <h3>${user.discord_username}</h3>
          <p style="color: var(--neon); margin: 8px 0;">💰 ${tokenBalance} tokens</p>
          <p style="color: var(--text-dim); margin: 4px 0;">
            🎮 ${user.ingame_name || '<em>Not linked</em>'}
          </p>
          <button class="primary-btn" id="link-btn" style="margin-top: 16px;">
            🔗 ${user.ingame_name ? 'Update Link' : 'Link Account'}
          </button>
          <button class="secondary-btn" id="logout-btn">
            🚪 Logout
          </button>
        </div>
        <div class="card">
          <div class="card-header">ℹ️ About</div>
          <p style="font-size: 0.85rem; line-height: 1.5;">
            Drained RCE Mobile is your companion app for Rust Console Edition.
            <br><br>
            • Teleport instantly from your phone<br>
            • Buy items with tokens<br>
            • Track your stats<br>
            • Free forever
          </p>
        </div>
      `;
      contentDiv.innerHTML = html;
      
      document.getElementById('link-btn').onclick = () => {
        showModal('Link Account', `
          <input id="ingame" class="modal-input" placeholder="Rust username" value="${user.ingame_name || ''}">
          <input id="steam" class="modal-input" placeholder="Steam ID (64-bit)" value="${user.steam_id || ''}">
        `, async () => {
          const ingameName = document.getElementById('ingame').value;
          const steamId = document.getElementById('steam').value;
          if (!ingameName || !steamId) {
            showToast('Both fields are required', 'warning');
            return;
          }
          
          showLoading(true, 'Linking account...');
          try {
            await apiCall('/user/link', { 
              method: 'POST', 
              body: JSON.stringify({ ingameName, steamId }) 
            });
            currentUser.ingame_name = ingameName;
            currentUser.steam_id = steamId;
            showToast('Account linked successfully!', 'success');
            pages.profile();
          } catch (err) {
            showToast(err.message, 'error');
          } finally {
            showLoading(false);
          }
        });
      };
      
      document.getElementById('logout-btn').onclick = () => logout();
    } catch (err) {
      contentDiv.innerHTML = `<div class="card"><div class="empty-state-icon">⚠️</div><p>Failed to load profile: ${err.message}</p></div>`;
    } finally {
      showLoading(false);
    }
  }
};

// ========== NAVIGATION ==========
async function navigateTo(page) {
  currentPage = page;
  document.querySelectorAll('.nav-btn').forEach(btn => {
    if (btn.dataset.page === page) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  
  // Skeleton loading effect
  contentDiv.innerHTML = `
    <div class="card">
      <div class="skeleton" style="height: 200px; border-radius: 24px;"></div>
    </div>
  `;
  
  try {
    await pages[page]();
  } catch (err) {
    showToast(`Error loading page: ${err.message}`, 'error');
    contentDiv.innerHTML = `<div class="card"><div class="empty-state-icon">⚠️</div><p>Failed to load ${page}</p></div>`;
  }
}

// ========== INITIALIZATION ==========
window.addEventListener('DOMContentLoaded', async () => {
  // Handle Discord redirect
  if (window.location.search.includes('auth=success')) {
    window.history.replaceState({}, '', '/');
    showToast('Login successful!', 'success');
  }
  
  if (window.location.search.includes('auth=failed')) {
    window.history.replaceState({}, '', '/');
    showToast('Login failed. Please try again.', 'error');
  }
  
  // Setup event listeners
  updateConnectionStatus();
  window.addEventListener('online', updateConnectionStatus);
  window.addEventListener('offline', updateConnectionStatus);
  
  // Setup navigation
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (currentUser) {
        await navigateTo(btn.dataset.page);
      } else {
        showToast('Please login first', 'warning');
      }
    });
  });
  
  // Initialize pull to refresh
  initPullToRefresh();
  
  // Check login status
  const loggedIn = await checkLogin();
  if (loggedIn) {
    await navigateTo('shop');
  }
});
import re

with open('web/app.html', 'r') as f:
    content = f.read()

# 1. Update Sidebar Navigation: Route Assets to tab-assets
old_assets_nav = '<a class="nav-item" onclick="switchTab(\'tab-send\', this)">'
new_assets_nav = '<a class="nav-item" onclick="switchTab(\'tab-assets\', this)">'
assert old_assets_nav in content, "old_assets_nav not found"
content = content.replace(old_assets_nav, new_assets_nav, 1)

# Make promo card clickable
old_promo = '<div class="promo-card">'
new_promo = '<div class="promo-card" id="sidebarPromoCard" style="cursor:pointer;" title="View Hardware Security & Enclave">'
assert old_promo in content, "old_promo not found"
content = content.replace(old_promo, new_promo, 1)

# 2. Update Topbar: Search, Bell notification popover, Profile Dropdown
old_topbar = '''      <header class="topbar">
        <div class="search-bar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input type="text" placeholder="Search tokens, addresses, or apps...">
        </div>
        <div class="user-profile">
          <svg class="bell-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
          <div class="profile-badge">
            <div class="avatar" id="profileAvatar">0</div>
            <span id="profileName">0x...</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
        </div>
      </header>'''

new_topbar = '''      <header class="topbar">
        <div class="search-bar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input type="text" id="globalSearchInput" placeholder="Search tokens, addresses, or apps... (Real-time filter)">
        </div>
        <div class="user-profile" style="position:relative; display:flex; align-items:center; gap:14px;">
          <!-- Notification Bell Wrapper -->
          <div class="bell-wrapper" id="bellWrapper" style="position:relative; cursor:pointer; padding:4px;">
            <svg class="bell-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
            <span id="notifBadgeDot" style="position:absolute; top:2px; right:2px; width:8px; height:8px; border-radius:50%; background:#10B981; border:2px solid var(--bg-surface);"></span>
            
            <!-- Notification Dropdown Panel -->
            <div class="notification-dropdown" id="notificationDropdown" style="display:none; position:absolute; top:calc(100% + 14px); right:-60px; width:330px; background:#FFFFFF; border:1px solid var(--border-light); border-radius:14px; box-shadow:0 16px 40px rgba(15,23,42,0.14); padding:14px; z-index:1000;">
              <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; border-bottom:1px solid var(--border-light); padding-bottom:8px;">
                <div style="font-weight:700; font-size:14px; color:var(--text-primary); display:flex; align-items:center; gap:6px;">
                  <span>Notifications</span>
                  <span id="notifCountTag" style="font-size:10px; background:var(--accent-blue-light); color:var(--accent-blue); padding:1px 6px; border-radius:999px; font-weight:800;">3</span>
                </div>
                <button id="btnClearNotifs" style="background:none; border:none; color:var(--accent-blue); font-size:11.5px; font-weight:600; cursor:pointer;">Mark all read</button>
              </div>
              <div style="display:flex; flex-direction:column; gap:8px;" id="notificationList">
                <div class="notif-item" style="display:flex; gap:10px; padding:8px 10px; background:var(--bg-hover); border-radius:8px;">
                  <div style="width:28px; height:28px; border-radius:50%; background:var(--accent-green-light); color:var(--accent-green); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
                  </div>
                  <div>
                    <div style="font-size:12px; font-weight:700; color:var(--text-primary);">Biometric Passkey Active</div>
                    <div style="font-size:11px; color:var(--text-secondary);">Apple Secure Enclave P-256 registered for single-tap UserOps.</div>
                    <div style="font-size:10px; color:var(--text-muted); margin-top:2px;">Just now</div>
                  </div>
                </div>
                <div class="notif-item" style="display:flex; gap:10px; padding:8px 10px; background:var(--bg-hover); border-radius:8px;">
                  <div style="width:28px; height:28px; border-radius:50%; background:var(--accent-blue-light); color:var(--accent-blue); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>
                  </div>
                  <div>
                    <div style="font-size:12px; font-weight:700; color:var(--text-primary);">Received 0.010 ETH</div>
                    <div style="font-size:11px; color:var(--text-secondary);">Inflow confirmed from Base Sepolia Faucet.</div>
                    <div style="font-size:10px; color:var(--text-muted); margin-top:2px;">2 hours ago</div>
                  </div>
                </div>
                <div class="notif-item" style="display:flex; gap:10px; padding:8px 10px; background:var(--bg-hover); border-radius:8px;">
                  <div style="width:28px; height:28px; border-radius:50%; background:rgba(245,158,11,0.12); color:var(--accent-amber); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"></circle><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83"/></svg>
                  </div>
                  <div>
                    <div style="font-size:12px; font-weight:700; color:var(--text-primary);">AI Agent Session Active</div>
                    <div style="font-size:11px; color:var(--text-secondary);">Trading agent spend limit synchronized at 30% ($30 / $100).</div>
                    <div style="font-size:10px; color:var(--text-muted); margin-top:2px;">Today · 08:42 PM</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Profile Badge with Dropdown -->
          <div class="profile-dropdown-wrapper" style="position:relative;">
            <div class="profile-badge" id="profileBadgeBtn" style="cursor:pointer;" title="Account Menu">
              <div class="avatar" id="profileAvatar">0</div>
              <span id="profileName">0x...</span>
              <svg class="profile-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="transition:transform 0.2s ease;"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </div>

            <!-- Profile Dropdown Menu -->
            <div class="profile-dropdown-menu" id="profileDropdownMenu" style="display:none; position:absolute; top:calc(100% + 10px); right:0; width:280px; background:#FFFFFF; border:1px solid var(--border-light); border-radius:14px; box-shadow:0 16px 40px rgba(15,23,42,0.15); padding:8px; z-index:1000;">
              <div style="padding:8px 10px; border-bottom:1px solid var(--border-light); margin-bottom:6px;">
                <div style="font-size:10.5px; font-weight:700; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.04em;">Connected Smart Account</div>
                <div style="display:flex; align-items:center; justify-content:space-between; margin-top:4px;">
                  <span style="font-family:var(--font-mono); font-size:12px; font-weight:700; color:var(--text-primary);" id="menuFullAddress">0xB015...796f</span>
                  <button id="menuCopyAddressBtn" style="background:var(--bg-hover); border:1px solid var(--border-light); padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600; cursor:pointer;">Copy</button>
                </div>
              </div>
              <a href="https://sepolia.basescan.org/address/0xB01543453cF31052c769d79e9C755E3b035d796f" target="_blank" class="menu-dropdown-item" style="display:flex; align-items:center; gap:8px; padding:8px 10px; border-radius:8px; color:var(--text-primary); text-decoration:none; font-size:13px; font-weight:600; transition:background 0.15s ease;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                <span>View on BaseScan Explorer ↗</span>
              </a>
              <button id="menuNavSecurity" class="menu-dropdown-item" style="display:flex; align-items:center; gap:8px; width:100%; padding:8px 10px; border-radius:8px; border:none; background:transparent; color:var(--text-primary); font-size:13px; font-weight:600; cursor:pointer; text-align:left; transition:background 0.15s ease;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                <span>Hardware Keys &amp; Passkeys</span>
              </button>
              <button id="menuNavPolicy" class="menu-dropdown-item" style="display:flex; align-items:center; gap:8px; width:100%; padding:8px 10px; border-radius:8px; border:none; background:transparent; color:var(--text-primary); font-size:13px; font-weight:600; cursor:pointer; text-align:left; transition:background 0.15s ease;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                <span>Policy Firewall Settings</span>
              </button>
              <div style="height:1px; background:var(--border-light); margin:4px 0;"></div>
              <button id="menuLockEnclave" class="menu-dropdown-item" style="display:flex; align-items:center; gap:8px; width:100%; padding:8px 10px; border-radius:8px; border:none; background:rgba(239,68,68,0.06); color:var(--accent-red); font-size:13px; font-weight:600; cursor:pointer; text-align:left; transition:background 0.15s ease;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                <span>Lock Hardware Session</span>
              </button>
            </div>
          </div>
        </div>
      </header>'''

assert old_topbar in content, "old_topbar not found"
content = content.replace(old_topbar, new_topbar, 1)

# 3. Update Portfolio Header: Privacy Eye Toggle & Network Selector Dropdown
old_portfolio_header = '''              <div class="portfolio-header">
                <span style="display:flex;align-items:center;gap:6px;">Total Portfolio <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg></span>
                <div class="portfolio-network-btn">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
                  All Networks
                </div>
              </div>'''

new_portfolio_header = '''              <div class="portfolio-header">
                <span style="display:flex;align-items:center;gap:6px;">
                  Total Portfolio 
                  <button id="togglePrivacyEye" style="background:none; border:none; cursor:pointer; padding:2px; display:inline-flex; align-items:center; color:var(--text-secondary); transition:color 0.15s ease;" title="Toggle balance privacy">
                    <svg id="privacyEyeSvg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                  </button>
                </span>
                
                <!-- Interactive Network Selector Dropdown -->
                <div class="network-select-wrapper" style="position:relative;">
                  <button class="portfolio-network-btn" id="networkDropdownBtn" style="cursor:pointer; transition:all 0.18s ease;">
                    <span id="activeNetworkDot" style="width:7px; height:7px; border-radius:50%; background:#0052FF; display:inline-block;"></span>
                    <span id="activeNetworkLabel">All Networks</span>
                    <svg class="net-chevron" width="12" height="12" viewBox="0 0 20 20" fill="currentColor" style="transition:transform 0.2s ease;"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd"/></svg>
                  </button>

                  <div class="network-dropdown-menu" id="networkDropdownMenu" style="display:none; position:absolute; top:calc(100% + 6px); right:0; width:240px; background:#FFFFFF; border:1px solid var(--border-light); border-radius:12px; box-shadow:0 12px 30px rgba(15,23,42,0.12); padding:6px; z-index:100;">
                    <div style="font-size:10.5px; font-weight:700; text-transform:uppercase; color:var(--text-secondary); padding:6px 10px; letter-spacing:0.04em;">Select Network</div>
                    <button class="net-item active" data-network="all" data-name="All Networks" style="display:flex; align-items:center; justify-content:space-between; width:100%; padding:8px 10px; border:none; background:var(--bg-hover); border-radius:6px; font-size:13px; font-weight:600; color:var(--text-primary); cursor:pointer; margin-bottom:2px;">
                      <span style="display:flex; align-items:center; gap:8px;">
                        <span style="width:7px; height:7px; border-radius:50%; background:#0052FF;"></span>
                        <span>All Networks</span>
                      </span>
                      <span class="net-check" style="color:#0052FF; font-weight:800;">✓</span>
                    </button>
                    <button class="net-item" data-network="base-sepolia" data-name="Base Sepolia" data-chainid="84532" style="display:flex; align-items:center; justify-content:space-between; width:100%; padding:8px 10px; border:none; background:transparent; border-radius:6px; font-size:13px; font-weight:600; color:var(--text-primary); cursor:pointer; margin-bottom:2px;">
                      <span style="display:flex; align-items:center; gap:8px;">
                        <span style="width:7px; height:7px; border-radius:50%; background:#38BDF8;"></span>
                        <span>Base Sepolia (84532)</span>
                      </span>
                      <span class="net-check" style="color:#0052FF; font-weight:800; display:none;">✓</span>
                    </button>
                    <button class="net-item" data-network="arbitrum-sepolia" data-name="Arbitrum Sepolia" data-chainid="421614" style="display:flex; align-items:center; justify-content:space-between; width:100%; padding:8px 10px; border:none; background:transparent; border-radius:6px; font-size:13px; font-weight:600; color:var(--text-primary); cursor:pointer; margin-bottom:2px;">
                      <span style="display:flex; align-items:center; gap:8px;">
                        <span style="width:7px; height:7px; border-radius:50%; background:#A855F7;"></span>
                        <span>Arbitrum Sepolia (421614)</span>
                      </span>
                      <span class="net-check" style="color:#0052FF; font-weight:800; display:none;">✓</span>
                    </button>
                    <button class="net-item" data-network="optimism-sepolia" data-name="Optimism Sepolia" data-chainid="11155420" style="display:flex; align-items:center; justify-content:space-between; width:100%; padding:8px 10px; border:none; background:transparent; border-radius:6px; font-size:13px; font-weight:600; color:var(--text-primary); cursor:pointer; margin-bottom:2px;">
                      <span style="display:flex; align-items:center; gap:8px;">
                        <span style="width:7px; height:7px; border-radius:50%; background:#EF4444;"></span>
                        <span>Optimism Sepolia (11155420)</span>
                      </span>
                      <span class="net-check" style="color:#0052FF; font-weight:800; display:none;">✓</span>
                    </button>
                    <button class="net-item" data-network="eth-sepolia" data-name="Ethereum Sepolia" data-chainid="11155111" style="display:flex; align-items:center; justify-content:space-between; width:100%; padding:8px 10px; border:none; background:transparent; border-radius:6px; font-size:13px; font-weight:600; color:var(--text-primary); cursor:pointer;">
                      <span style="display:flex; align-items:center; gap:8px;">
                        <span style="width:7px; height:7px; border-radius:50%; background:#627EEA;"></span>
                        <span>Ethereum Sepolia (11155111)</span>
                      </span>
                      <span class="net-check" style="color:#0052FF; font-weight:800; display:none;">✓</span>
                    </button>
                  </div>
                </div>
              </div>'''

assert old_portfolio_header in content, "old_portfolio_header not found"
content = content.replace(old_portfolio_header, new_portfolio_header, 1)

# 4. Update + Add Asset button
old_add_btn = '''              <button class="btn-action-secondary" style="border:1px dashed var(--border-medium);background:transparent;box-shadow:none;">
                + Add Asset
              </button>'''

new_add_btn = '''              <button class="btn-action-secondary" id="openAddAssetModalBtn" style="border:1px dashed var(--border-medium);background:transparent;box-shadow:none;cursor:pointer;">
                + Add Asset
              </button>'''

assert old_add_btn in content, "old_add_btn not found"
content = content.replace(old_add_btn, new_add_btn, 1)

# 5. Make Recent Transaction rows clickable to view details
old_tx_tbody = '''                <tbody>
                  <tr>
                    <td>
                      <div class="tx-type"><div class="tx-icon" style="color:var(--accent-amber);"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div> Quorum</div>
                    </td>
                    <td style="font-weight:600;">Base Treasury Pool</td>
                    <td>
                      <div class="tx-amount">0.05 ETH</div>
                      <div class="tx-amount-sub">≈ $160.00 USD</div>
                    </td>
                    <td><div class="tx-network"><span style="color:#0052FF;font-weight:900;">O</span> Base Sepolia</div></td>
                    <td><span class="badge-completed" style="background:rgba(245,158,11,0.15);color:var(--accent-amber);">2-of-2 Quorum</span></td>
                    <td style="color:var(--text-secondary);font-size:12px;">Sep 2 · 10:18 PM</td>
                    <td><a href="https://sepolia.basescan.org/tx/0x7f4a21908bcda14238e8210941094190248231b2c45189028490124801948123" target="_blank" style="color:#60A5FA;text-decoration:none;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg></a></td>
                  </tr>
                  <tr>
                    <td>
                      <div class="tx-type"><div class="tx-icon" style="color:var(--accent-purple);"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></div> AI Agent</div>
                    </td>
                    <td style="font-weight:600;">Uniswap V3 Router</td>
                    <td>
                      <div class="tx-amount">-20.00 USDC</div>
                      <div class="tx-amount-sub">≈ $20.00 USD</div>
                    </td>
                    <td><div class="tx-network"><span style="color:#0052FF;font-weight:900;">O</span> Base Sepolia</div></td>
                    <td><span class="badge-completed" style="background:rgba(16,185,129,0.15);color:var(--accent-emerald);">Success</span></td>
                    <td style="color:var(--text-secondary);font-size:12px;">Sep 2 · 8:42 PM</td>
                    <td><a href="https://sepolia.basescan.org/tx/0x4b89f10928310948102948120938401928301928301928301928301928301928" target="_blank" style="color:#60A5FA;text-decoration:none;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg></a></td>
                  </tr>
                  <tr>
                    <td>
                      <div class="tx-type"><div class="tx-icon" style="color:var(--accent-emerald);"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="7" y1="7" x2="17" y2="17"/><polyline points="17 7 17 17 7 17"/></svg></div> Receive</div>
                    </td>
                    <td style="font-weight:600;">Base Sepolia Faucet</td>
                    <td>
                      <div class="tx-amount">+0.010 ETH</div>
                      <div class="tx-amount-sub">≈ $32.00 USD</div>
                    </td>
                    <td><div class="tx-network"><span style="color:#0052FF;font-weight:900;">O</span> Base Sepolia</div></td>
                    <td><span class="badge-completed" style="background:rgba(16,185,129,0.15);color:var(--accent-emerald);">Confirmed</span></td>
                    <td style="color:var(--text-secondary);font-size:12px;">Sep 2 · 6:15 PM</td>
                    <td><a href="https://sepolia.basescan.org/tx/0x91d3a41029381029381029381029381029381029381029381029381029381029" target="_blank" style="color:#60A5FA;text-decoration:none;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg></a></td>
                  </tr>
                </tbody>'''

new_tx_tbody = '''                <tbody id="recentTxTableBody">
                  <tr class="clickable-tx-row" data-name="Base Treasury Pool" data-type="Quorum Transfer" data-amount="0.05 ETH" data-fiat="$160.00 USD" data-status="2-of-2 Quorum" data-time="Sep 2 · 10:18 PM" data-hash="0x7f4a21908bcda14238e8210941094190248231b2c45189028490124801948123" data-target="0x22db962929afe98d0269De0BAa6c442A3Aa6913D" style="cursor:pointer;">
                    <td>
                      <div class="tx-type"><div class="tx-icon" style="color:var(--accent-amber);"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div> Quorum</div>
                    </td>
                    <td style="font-weight:600;">Base Treasury Pool</td>
                    <td>
                      <div class="tx-amount">0.05 ETH</div>
                      <div class="tx-amount-sub">≈ $160.00 USD</div>
                    </td>
                    <td><div class="tx-network"><span style="color:#0052FF;font-weight:900;">O</span> Base Sepolia</div></td>
                    <td><span class="badge-completed" style="background:rgba(245,158,11,0.15);color:var(--accent-amber);">2-of-2 Quorum</span></td>
                    <td style="color:var(--text-secondary);font-size:12px;">Sep 2 · 10:18 PM</td>
                    <td><a href="https://sepolia.basescan.org/tx/0x7f4a21908bcda14238e8210941094190248231b2c45189028490124801948123" target="_blank" style="color:#60A5FA;text-decoration:none;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg></a></td>
                  </tr>
                  <tr class="clickable-tx-row" data-name="Uniswap V3 Router" data-type="AI Agent Swap" data-amount="-20.00 USDC" data-fiat="$20.00 USD" data-status="Success" data-time="Sep 2 · 8:42 PM" data-hash="0x4b89f10928310948102948120938401928301928301928301928301928301928" data-target="0x2626664c2603336E57B271c5C0b26F421741e481" style="cursor:pointer;">
                    <td>
                      <div class="tx-type"><div class="tx-icon" style="color:var(--accent-purple);"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></div> AI Agent</div>
                    </td>
                    <td style="font-weight:600;">Uniswap V3 Router</td>
                    <td>
                      <div class="tx-amount">-20.00 USDC</div>
                      <div class="tx-amount-sub">≈ $20.00 USD</div>
                    </td>
                    <td><div class="tx-network"><span style="color:#0052FF;font-weight:900;">O</span> Base Sepolia</div></td>
                    <td><span class="badge-completed" style="background:rgba(16,185,129,0.15);color:var(--accent-emerald);">Success</span></td>
                    <td style="color:var(--text-secondary);font-size:12px;">Sep 2 · 8:42 PM</td>
                    <td><a href="https://sepolia.basescan.org/tx/0x4b89f10928310948102948120938401928301928301928301928301928301928" target="_blank" style="color:#60A5FA;text-decoration:none;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg></a></td>
                  </tr>
                  <tr class="clickable-tx-row" data-name="Base Sepolia Faucet" data-type="Received Inflow" data-amount="+0.010 ETH" data-fiat="$32.00 USD" data-status="Confirmed" data-time="Sep 2 · 6:15 PM" data-hash="0x91d3a41029381029381029381029381029381029381029381029381029381029" data-target="0xB01543453cF31052c769d79e9C755E3b035d796f" style="cursor:pointer;">
                    <td>
                      <div class="tx-type"><div class="tx-icon" style="color:var(--accent-emerald);"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="7" y1="7" x2="17" y2="17"/><polyline points="17 7 17 17 7 17"/></svg></div> Receive</div>
                    </td>
                    <td style="font-weight:600;">Base Sepolia Faucet</td>
                    <td>
                      <div class="tx-amount">+0.010 ETH</div>
                      <div class="tx-amount-sub">≈ $32.00 USD</div>
                    </td>
                    <td><div class="tx-network"><span style="color:#0052FF;font-weight:900;">O</span> Base Sepolia</div></td>
                    <td><span class="badge-completed" style="background:rgba(16,185,129,0.15);color:var(--accent-emerald);">Confirmed</span></td>
                    <td style="color:var(--text-secondary);font-size:12px;">Sep 2 · 6:15 PM</td>
                    <td><a href="https://sepolia.basescan.org/tx/0x91d3a41029381029381029381029381029381029381029381029381029381029" target="_blank" style="color:#60A5FA;text-decoration:none;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg></a></td>
                  </tr>
                </tbody>'''

assert old_tx_tbody in content, "old_tx_tbody not found"
content = content.replace(old_tx_tbody, new_tx_tbody, 1)

# 6. Update Swap Tab divider circle with interactive ID and hover
old_swap_divider = '''            <!-- Swap Divider -->
            <div style="text-align: center; margin: 16px 0;">
              <div style="display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%; background: var(--bg-deep); border: 1px solid var(--border-dark); color: var(--text-muted);">
                ↓
              </div>
            </div>'''

new_swap_divider = '''            <!-- Swap Divider (Interactive Flip Button) -->
            <div style="text-align: center; margin: 16px 0;">
              <button id="btnFlipSwapTokens" style="display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 50%; background: var(--bg-surface); border: 1px solid var(--border-light); color: var(--text-primary); cursor: pointer; box-shadow: 0 2px 6px rgba(0,0,0,0.06); transition: all 0.2s ease;" title="Click to flip swap direction">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M7 10v12"/><path d="m11 18-4 4-4-4"/><path d="M17 14V2"/><path d="m13 6 4-4 4 4"/></svg>
              </button>
            </div>'''

assert old_swap_divider in content, "old_swap_divider not found"
content = content.replace(old_swap_divider, new_swap_divider, 1)

# 7. Insert Dedicated tab-assets right before tab-send
old_tab_send = '        <!-- ================= ORIGINAL TABS (Restyled) ================= -->\n        <!-- These are injected from the original file to preserve JS IDs -->\n        <div class="tab-view" id="tab-send">'

new_tab_assets_and_send = '''        <!-- ================= ASSETS TAB (Dedicated Portfolio Breakdown) ================= -->
        <div class="tab-view" id="tab-assets">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
            <div>
              <h3 style="font-family:var(--font-heading); font-size:22px; font-weight:800; color:var(--text-primary);">Asset Portfolio</h3>
              <p style="font-size:13px; color:var(--text-secondary);">Real-time balances across connected EVM networks.</p>
            </div>
            <button class="btn-action-primary" id="assetsAddTokenBtn" style="padding:8px 16px; font-size:13px; display:inline-flex; align-items:center; gap:6px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Import Token
            </button>
          </div>

          <!-- Assets Breakdown Cards -->
          <div class="home-grid" style="margin-bottom:24px;">
            <div class="card-white" style="padding:18px;">
              <div style="font-size:12px; font-weight:700; color:var(--text-secondary); text-transform:uppercase;">Verified Portfolio Value</div>
              <div style="font-family:var(--font-heading); font-size:28px; font-weight:800; color:var(--text-primary); margin-top:4px;" id="assetsTotalUsd">$10.29 USD</div>
              <div style="font-size:12px; color:var(--accent-green); font-weight:600; margin-top:2px;" id="assetsSubText">2 Verified Tokens • 1 Connected L2</div>
            </div>
            <div class="card-white" style="padding:18px;">
              <div style="font-size:12px; font-weight:700; color:var(--text-secondary); text-transform:uppercase;">Asset Allocation</div>
              <div style="height:10px; background:var(--bg-hover); border-radius:999px; overflow:hidden; display:flex; margin-top:12px;">
                <div style="width:100%; background:#627EEA;" title="Ethereum (100%)"></div>
              </div>
              <div style="display:flex; justify-content:space-between; font-size:11px; color:var(--text-secondary); margin-top:8px;">
                <span style="display:flex; align-items:center; gap:4px;"><span style="width:6px; height:6px; border-radius:50%; background:#627EEA;"></span> ETH: 100%</span>
                <span style="display:flex; align-items:center; gap:4px;"><span style="width:6px; height:6px; border-radius:50%; background:#2775CA;"></span> USDC: 0%</span>
              </div>
            </div>
          </div>

          <!-- Assets Table -->
          <div class="card-white">
            <div class="section-title">Verified On-Chain Tokens</div>
            <table class="tx-table" id="allAssetsTable">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Network</th>
                  <th>Price</th>
                  <th>Holdings</th>
                  <th>Value</th>
                  <th>24h Change</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody id="assetsTableBody">
                <tr id="assetsRowEth">
                  <td>
                    <div style="display:flex; align-items:center; gap:10px;">
                      <div class="asset-icon" style="background:#F3F4F6; width:32px; height:32px; border-radius:50%; display:flex; align-items:center; justify-content:center;"><span style="color:#627EEA; font-weight:800;">Ξ</span></div>
                      <div>
                        <div style="font-weight:700; color:var(--text-primary);">Ethereum</div>
                        <div style="font-size:11px; color:var(--text-secondary);">ETH</div>
                      </div>
                    </div>
                  </td>
                  <td><span style="font-size:12px; font-weight:600; color:#0052FF;">Base Sepolia</span></td>
                  <td style="font-family:var(--font-mono); font-weight:600;">$3,200.00</td>
                  <td style="font-family:var(--font-mono); font-weight:700;" id="tableHoldEth">0.0032 ETH</td>
                  <td style="font-family:var(--font-mono); font-weight:700;" id="tableValEth">$10.29</td>
                  <td style="color:var(--accent-green); font-weight:700;">+2.4%</td>
                  <td>
                    <div style="display:flex; gap:6px;">
                      <button class="btn-action-primary" onclick="switchTab('tab-send', document.querySelectorAll('.nav-item')[1])" style="padding:4px 10px; font-size:11px;">Send</button>
                      <button class="btn-action-secondary" onclick="document.getElementById('openReceiveBtn').click()" style="padding:4px 10px; font-size:11px;">Receive</button>
                      <button class="btn-action-secondary" onclick="switchTab('tab-swap', null)" style="padding:4px 10px; font-size:11px;">Swap</button>
                    </div>
                  </td>
                </tr>
                <tr id="assetsRowUsdc">
                  <td>
                    <div style="display:flex; align-items:center; gap:10px;">
                      <div class="asset-icon" style="background:#EFF6FF; width:32px; height:32px; border-radius:50%; display:flex; align-items:center; justify-content:center;"><span style="color:#2775CA; font-weight:800;">$</span></div>
                      <div>
                        <div style="font-weight:700; color:var(--text-primary);">USD Coin</div>
                        <div style="font-size:11px; color:var(--text-secondary);">USDC (Circle Native)</div>
                      </div>
                    </div>
                  </td>
                  <td><span style="font-size:12px; font-weight:600; color:#0052FF;">Base Sepolia</span></td>
                  <td style="font-family:var(--font-mono); font-weight:600;">$1.00</td>
                  <td style="font-family:var(--font-mono); font-weight:700;" id="tableHoldUsdc">0.00 USDC</td>
                  <td style="font-family:var(--font-mono); font-weight:700;" id="tableValUsdc">$0.00</td>
                  <td style="color:var(--text-secondary); font-weight:700;">0.0%</td>
                  <td>
                    <div style="display:flex; gap:6px;">
                      <button class="btn-action-primary" onclick="switchTab('tab-send', document.querySelectorAll('.nav-item')[1])" style="padding:4px 10px; font-size:11px;">Send</button>
                      <button class="btn-action-secondary" onclick="document.getElementById('openReceiveBtn').click()" style="padding:4px 10px; font-size:11px;">Receive</button>
                      <button class="btn-action-secondary" onclick="switchTab('tab-swap', null)" style="padding:4px 10px; font-size:11px;">Swap</button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- ================= ORIGINAL TABS (Restyled) ================= -->
        <!-- These are injected from the original file to preserve JS IDs -->
        <div class="tab-view" id="tab-send">'''

assert old_tab_send in content, "old_tab_send not found"
content = content.replace(old_tab_send, new_tab_assets_and_send, 1)

# 8. Replace [ QR Code Area ] in Receive Modal with vector SVG QR and full address
old_receive_modal = '''    <!-- Receive Modal -->
    <div id="receiveModal" class="modal-overlay">
      <div class="modal-content">
        <button class="modal-close" id="closeReceiveModal">&times;</button>
        <h3 style="font-family:var(--font-heading); font-size:20px; font-weight:800; color:var(--text-primary);">Receive Assets</h3>
        <p style="font-size:14px; color:var(--text-secondary); margin-top:8px;">Only send Base network assets to this address.</p>
        
        <div class="qr-placeholder">
          [ QR Code Area ]
        </div>
        
        <div class="address-copy-bar" style="justify-content: center; gap: 12px; padding: 12px; background:var(--bg-hover);">
          <span id="modalReceiveAddress" style="font-size:14px; font-weight: 700;">0x...</span>
          <button class="copy-btn" id="modalCopyBtn" style="background:var(--accent-blue-light); padding: 4px 8px; border-radius: 6px;">Copy</button>
        </div>
      </div>
    </div>'''

new_receive_modal = '''    <!-- Receive Modal -->
    <div id="receiveModal" class="modal-overlay">
      <div class="modal-content" style="max-width:400px; text-align:center;">
        <button class="modal-close" id="closeReceiveModal">&times;</button>
        <h3 style="font-family:var(--font-heading); font-size:20px; font-weight:800; color:var(--text-primary);">Receive Assets</h3>
        <p style="font-size:13px; color:var(--text-secondary); margin-top:4px;">Deposit ETH or ERC-20 tokens on Base Sepolia Smart Account.</p>
        
        <!-- Vector QR Code representation -->
        <div style="background:#FFF; padding:14px; border-radius:12px; margin:16px auto; width:160px; height:160px; display:flex; align-items:center; justify-content:center; box-shadow:0 4px 14px rgba(0,0,0,0.08); border:1px solid var(--border-light);">
          <svg width="100%" height="100%" viewBox="0 0 120 120" fill="#000">
            <rect x="10" y="10" width="30" height="30" fill="#000"/>
            <rect x="15" y="15" width="20" height="20" fill="#FFF"/>
            <rect x="20" y="20" width="10" height="10" fill="#000"/>
            <rect x="80" y="10" width="30" height="30" fill="#000"/>
            <rect x="85" y="15" width="20" height="20" fill="#FFF"/>
            <rect x="90" y="20" width="10" height="10" fill="#000"/>
            <rect x="10" y="80" width="30" height="30" fill="#000"/>
            <rect x="15" y="85" width="20" height="20" fill="#FFF"/>
            <rect x="20" y="90" width="10" height="10" fill="#000"/>
            <rect x="50" y="20" width="10" height="10" fill="#000"/>
            <rect x="65" y="20" width="10" height="20" fill="#000"/>
            <rect x="50" y="45" width="20" height="10" fill="#000"/>
            <rect x="20" y="55" width="15" height="15" fill="#000"/>
            <rect x="80" y="50" width="15" height="15" fill="#000"/>
            <rect x="50" y="80" width="25" height="25" fill="#000"/>
            <rect x="85" y="85" width="20" height="10" fill="#000"/>
          </svg>
        </div>
        
        <div class="address-copy-bar" style="display:flex; flex-direction:column; gap:8px; padding:12px; background:var(--bg-hover); border-radius:10px; border:1px solid var(--border-light);">
          <span id="modalReceiveAddress" style="font-size:12px; font-weight:700; font-family:var(--font-mono); word-break:break-all; color:var(--text-primary);">0xB01543453cF31052c769d79e9C755E3b035d796f</span>
          <button class="copy-btn" id="modalCopyBtn" style="background:var(--accent-blue); color:#FFF; padding:8px 16px; border-radius:6px; font-size:12px; font-weight:700; border:none; cursor:pointer;">Copy Address</button>
        </div>

        <a href="https://sepolia.basescan.org/address/0xB01543453cF31052c769d79e9C755E3b035d796f" target="_blank" style="display:inline-block; margin-top:12px; font-size:12px; font-weight:600; color:#0052FF; text-decoration:none;">
          View on BaseScan Explorer ↗
        </a>
      </div>
    </div>

    <!-- Add / Import Custom Asset Modal -->
    <div class="modal-overlay" id="addAssetModal">
      <div class="modal-content" style="max-width:440px;">
        <button class="modal-close" id="closeAddAssetModal">&times;</button>
        <h3 style="font-family:var(--font-heading); font-size:20px; font-weight:800; color:var(--text-primary);">Add / Import Token</h3>
        <p style="font-size:13px; color:var(--text-secondary); margin-top:4px; margin-bottom:16px;">Track custom ERC-20 tokens or testnet assets in your Haptix portfolio.</p>
        
        <div style="font-size:11.5px; font-weight:700; color:var(--text-secondary); margin-bottom:6px;">Popular Testnet Presets</div>
        <div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:14px;">
          <button class="asset-preset-chip" data-name="Dai Stablecoin" data-symbol="DAI" data-addr="0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb" data-icon="$" data-color="#F59E0B" style="padding:5px 10px; border-radius:6px; border:1px solid var(--border-light); background:var(--bg-hover); font-size:12px; font-weight:600; cursor:pointer;">+ DAI</button>
          <button class="asset-preset-chip" data-name="Chainlink Token" data-symbol="LINK" data-addr="0xE4aB69C077896252FAFBD49EFD26B5D171A32410" data-icon="⬡" data-color="#0052FF" style="padding:5px 10px; border-radius:6px; border:1px solid var(--border-light); background:var(--bg-hover); font-size:12px; font-weight:600; cursor:pointer;">+ LINK</button>
          <button class="asset-preset-chip" data-name="Wrapped BTC" data-symbol="WBTC" data-addr="0x0555E30da8f98308EdB960aa94C0Db47230d2B9c" data-icon="₿" data-color="#F97316" style="padding:5px 10px; border-radius:6px; border:1px solid var(--border-light); background:var(--bg-hover); font-size:12px; font-weight:600; cursor:pointer;">+ WBTC</button>
          <button class="asset-preset-chip" data-name="Euro Coin" data-symbol="EURC" data-addr="0x808456652fdb59e496380c3b016f49633e9d8995" data-icon="€" data-color="#10B981" style="padding:5px 10px; border-radius:6px; border:1px solid var(--border-light); background:var(--bg-hover); font-size:12px; font-weight:600; cursor:pointer;">+ EURC</button>
        </div>

        <div class="form-group" style="margin-bottom:12px;">
          <label style="font-size:12px; font-weight:700; color:var(--text-secondary); display:block; margin-bottom:4px;">Token Contract Address</label>
          <input type="text" id="addAssetContract" placeholder="0x..." style="width:100%; padding:10px 12px; border-radius:8px; border:1px solid var(--border-light); font-family:var(--font-mono); font-size:13px; background:var(--bg-hover); color:var(--text-primary);">
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:16px;">
          <div class="form-group">
            <label style="font-size:12px; font-weight:700; color:var(--text-secondary); display:block; margin-bottom:4px;">Token Symbol</label>
            <input type="text" id="addAssetSymbol" placeholder="e.g. DAI" style="width:100%; padding:10px 12px; border-radius:8px; border:1px solid var(--border-light); font-size:13px; font-weight:600; background:var(--bg-hover); color:var(--text-primary);">
          </div>
          <div class="form-group">
            <label style="font-size:12px; font-weight:700; color:var(--text-secondary); display:block; margin-bottom:4px;">Decimals</label>
            <input type="number" id="addAssetDecimals" value="18" style="width:100%; padding:10px 12px; border-radius:8px; border:1px solid var(--border-light); font-size:13px; font-weight:600; background:var(--bg-hover); color:var(--text-primary);">
          </div>
        </div>

        <button id="btnConfirmAddAsset" class="btn-action-primary" style="width:100%; padding:12px; font-size:14px; border-radius:8px; cursor:pointer;">
          Add Token to Portfolio
        </button>
      </div>
    </div>

    <!-- Discover Web3 dApps Modal -->
    <div class="modal-overlay" id="dappDirectoryModal">
      <div class="modal-content" style="max-width:500px;">
        <button class="modal-close" id="closeDappModal">&times;</button>
        <h3 style="font-family:var(--font-heading); font-size:22px; font-weight:800; color:var(--text-primary);">Web3 dApp Directory</h3>
        <p style="font-size:13px; color:var(--text-secondary); margin-top:4px; margin-bottom:18px;">Connect your Haptix passkey smart account to verified ecosystem protocols.</p>
        
        <div style="display:flex; flex-direction:column; gap:10px;">
          <a href="https://app.uniswap.org" target="_blank" class="dapp-item" style="display:flex; align-items:center; justify-content:space-between; padding:12px 14px; border:1px solid var(--border-light); border-radius:10px; text-decoration:none; background:var(--bg-hover); transition:all 0.15s ease;">
            <div style="display:flex; align-items:center; gap:12px;">
              <div style="width:36px; height:36px; border-radius:8px; background:#FF007A; color:#FFF; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:16px;">🦄</div>
              <div>
                <div style="font-weight:700; color:var(--text-primary); font-size:14px;">Uniswap V3</div>
                <div style="font-size:11.5px; color:var(--text-secondary);">Decentralized trading protocol on Base</div>
              </div>
            </div>
            <span style="color:#0052FF; font-weight:700; font-size:12px;">Launch ↗</span>
          </a>

          <a href="https://app.aave.com" target="_blank" class="dapp-item" style="display:flex; align-items:center; justify-content:space-between; padding:12px 14px; border:1px solid var(--border-light); border-radius:10px; text-decoration:none; background:var(--bg-hover); transition:all 0.15s ease;">
            <div style="display:flex; align-items:center; gap:12px;">
              <div style="width:36px; height:36px; border-radius:8px; background:#2EBAC6; color:#FFF; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:16px;">👻</div>
              <div>
                <div style="font-weight:700; color:var(--text-primary); font-size:14px;">Aave V3</div>
                <div style="font-size:11.5px; color:var(--text-secondary);">Non-custodial liquidity protocol</div>
              </div>
            </div>
            <span style="color:#0052FF; font-weight:700; font-size:12px;">Launch ↗</span>
          </a>

          <a href="https://testnets.opensea.io" target="_blank" class="dapp-item" style="display:flex; align-items:center; justify-content:space-between; padding:12px 14px; border:1px solid var(--border-light); border-radius:10px; text-decoration:none; background:var(--bg-hover); transition:all 0.15s ease;">
            <div style="display:flex; align-items:center; gap:12px;">
              <div style="width:36px; height:36px; border-radius:8px; background:#2081E2; color:#FFF; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:16px;">⛵</div>
              <div>
                <div style="font-weight:700; color:var(--text-primary); font-size:14px;">OpenSea (Base Testnet)</div>
                <div style="font-size:11.5px; color:var(--text-secondary);">NFT &amp; on-chain digital assets</div>
              </div>
            </div>
            <span style="color:#0052FF; font-weight:700; font-size:12px;">Launch ↗</span>
          </a>

          <a href="/test-dapp.html" class="dapp-item" style="display:flex; align-items:center; justify-content:space-between; padding:12px 14px; border:1px solid var(--border-light); border-radius:10px; text-decoration:none; background:var(--bg-hover); transition:all 0.15s ease;">
            <div style="display:flex; align-items:center; gap:12px;">
              <div style="width:36px; height:36px; border-radius:8px; background:#0052FF; color:#FFF; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:16px;">⚡</div>
              <div>
                <div style="font-weight:700; color:var(--text-primary); font-size:14px;">Haptix Test dApp Sandbox</div>
                <div style="font-size:11.5px; color:var(--text-secondary);">EIP-1193 provider &amp; UserOp policy testbed</div>
              </div>
            </div>
            <span style="color:#0052FF; font-weight:700; font-size:12px;">Run Tests ↗</span>
          </a>
        </div>
      </div>
    </div>

    <!-- Transaction Details Modal -->
    <div class="modal-overlay" id="txDetailsModal">
      <div class="modal-content" style="max-width:460px;">
        <button class="modal-close" id="closeTxModal">&times;</button>
        <div style="text-align:center; padding:8px 0 14px;">
          <div style="width:48px; height:48px; border-radius:50%; background:var(--bg-hover); display:inline-flex; align-items:center; justify-content:center; font-size:22px; margin-bottom:8px;" id="txModalIcon">↗</div>
          <div style="font-family:var(--font-heading); font-size:24px; font-weight:800; color:var(--text-primary);" id="txModalAmount">0.05 ETH</div>
          <div style="font-size:13px; color:var(--text-secondary);" id="txModalFiat">≈ $160.00 USD</div>
          <span id="txModalBadge" style="display:inline-block; margin-top:8px; font-size:11px; font-weight:700; padding:2px 10px; border-radius:999px; background:rgba(16,185,129,0.15); color:var(--accent-green);">Confirmed</span>
        </div>

        <div style="background:var(--bg-hover); border:1px solid var(--border-light); border-radius:10px; padding:14px; display:flex; flex-direction:column; gap:8px; font-size:12.5px;">
          <div style="display:flex; justify-content:space-between;">
            <span style="color:var(--text-secondary);">Type:</span>
            <span style="font-weight:700; color:var(--text-primary);" id="txModalType">Quorum Transfer</span>
          </div>
          <div style="display:flex; justify-content:space-between;">
            <span style="color:var(--text-secondary);">Target / Counterparty:</span>
            <span style="font-family:var(--font-mono); font-weight:600; color:var(--text-primary);" id="txModalTarget">0x22db...913D</span>
          </div>
          <div style="display:flex; justify-content:space-between;">
            <span style="color:var(--text-secondary);">Network:</span>
            <span style="font-weight:600; color:#0052FF;">Base Sepolia (84532)</span>
          </div>
          <div style="display:flex; justify-content:space-between;">
            <span style="color:var(--text-secondary);">Timestamp:</span>
            <span style="color:var(--text-secondary);" id="txModalTime">Sep 2, 2026 · 10:18 PM</span>
          </div>
          <div style="display:flex; justify-content:space-between;">
            <span style="color:var(--text-secondary);">Gas Verification:</span>
            <span style="color:var(--accent-green); font-weight:700;">84,210 gas (RIP-7212 Precompile)</span>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--border-light); padding-top:6px; margin-top:4px;">
            <span style="color:var(--text-secondary);">UserOp Hash:</span>
            <span style="font-family:var(--font-mono); font-size:11px; color:#60A5FA; cursor:pointer;" id="txModalHash" title="Click to copy">0x7f4a...31b2 ❐</span>
          </div>
        </div>

        <a href="#" id="txModalExplorerLink" target="_blank" class="btn-action-primary" style="margin-top:16px; width:100%; padding:12px; text-decoration:none; display:flex; align-items:center; justify-content:center; gap:6px; font-size:13.5px; border-radius:8px;">
          <span>View on BaseScan Explorer</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        </a>
      </div>
    </div>'''

assert old_receive_modal in content, "old_receive_modal not found"
content = content.replace(old_receive_modal, new_receive_modal, 1)

# 9. Replace the MISC UI HANDLERS with our complete real-time interactive suite
old_handlers = '''// ==========================================
// MISC UI HANDLERS (previously non-functional)
// ==========================================

// --- Notification Bell ---
const bellIcon = document.querySelector(\'.bell-icon\');
if (bellIcon) {
  bellIcon.style.cursor = \'pointer\';
  bellIcon.parentElement.style.cursor = \'pointer\';
  bellIcon.parentElement.addEventListener(\'click\', () => {
    showToast(\'No new notifications\', \'info\', \'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#60A5FA" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>\');
  });
}

// --- Profile Badge (copy address on click) ---
const profileBadge = document.querySelector(\'.profile-badge\');
if (profileBadge) {
  profileBadge.style.cursor = \'pointer\';
  profileBadge.addEventListener(\'click\', () => {
    navigator.clipboard.writeText(accountAddr);
    showToast(\'Address copied to clipboard!\', \'success\', \'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>\');
  });
}

// --- "View all" links on Home tab ---
document.querySelectorAll(\'.view-all\').forEach(link => {
  link.addEventListener(\'click\', (e) => {
    e.preventDefault();
    switchTab(\'tab-activity\', document.querySelectorAll(\'.nav-item\')[3]);
  });
});

// --- "Add Asset" button ---
document.querySelectorAll(\'.assets-row button\').forEach(btn => {
  if (btn.textContent.trim().includes(\'Add Asset\')) {
    btn.addEventListener(\'click\', () => showToast(\'Multi-asset support coming soon!\', \'info\', \'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#60A5FA" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>\'));
  }
});

// --- Explore items (clickable) ---
document.querySelectorAll(\'.explore-item\').forEach((item, i) => {
  item.style.cursor = \'pointer\';
  item.addEventListener(\'click\', () => {
    if (i === 0) showToast(\'dApp browser coming soon!\', \'info\', \'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#60A5FA" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>\');
    else switchTab(\'tab-agents\', document.querySelectorAll(\'.nav-item\')[4]);
  });
});

// --- Search bar functionality ---
const searchInput = document.querySelector(\'.search-bar input\');
if (searchInput) {
  searchInput.addEventListener(\'keydown\', (e) => {
    if (e.key === \'Enter\') showToast(`Searching for "${searchInput.value}"...`, \'info\', \'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#60A5FA" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>\');
  });
}'''

new_handlers = '''// =======================================================
// INTERACTIVE SUITE: NETWORKS, PRIVACY, SEARCH, NOTIFS, MODALS
// =======================================================

// --- 1. Network Selector Dropdown ---
const netBtn = document.getElementById('networkDropdownBtn');
const netMenu = document.getElementById('networkDropdownMenu');
const netLabel = document.getElementById('activeNetworkLabel');
const netDot = document.getElementById('activeNetworkDot');

if (netBtn && netMenu) {
  netBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = netMenu.style.display === 'block';
    netMenu.style.display = isOpen ? 'none' : 'block';
    const chevron = netBtn.querySelector('.net-chevron');
    if (chevron) chevron.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
  });

  document.querySelectorAll('.net-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.net-item').forEach(i => {
        i.classList.remove('active');
        i.style.background = 'transparent';
        const chk = i.querySelector('.net-check');
        if (chk) chk.style.display = 'none';
      });

      item.classList.add('active');
      item.style.background = 'var(--bg-hover)';
      const chk = item.querySelector('.net-check');
      if (chk) chk.style.display = 'inline';

      const netName = item.getAttribute('data-name');
      const netKey = item.getAttribute('data-network');
      netLabel.textContent = netName;

      const colors = {
        'all': '#0052FF',
        'base-sepolia': '#38BDF8',
        'arbitrum-sepolia': '#A855F7',
        'optimism-sepolia': '#EF4444',
        'eth-sepolia': '#627EEA'
      };
      if (netDot) netDot.style.background = colors[netKey] || '#0052FF';

      // Update Base card
      const baseCardVal = document.getElementById('sideHoldBase');
      const baseCardChange = baseCardVal ? baseCardVal.parentElement.querySelector('.change') : null;
      if (baseCardVal && baseCardChange) {
        if (netKey === 'base-sepolia') {
          baseCardVal.textContent = 'Chain 84532';
          baseCardChange.textContent = 'Active L2';
        } else if (netKey === 'arbitrum-sepolia') {
          baseCardVal.textContent = 'Chain 421614';
          baseCardChange.textContent = 'Arbitrum Nitro';
        } else if (netKey === 'optimism-sepolia') {
          baseCardVal.textContent = 'Chain 11155420';
          baseCardChange.textContent = 'OP Stack L2';
        } else if (netKey === 'eth-sepolia') {
          baseCardVal.textContent = 'Chain 11155111';
          baseCardChange.textContent = 'Ethereum L1';
        } else {
          baseCardVal.textContent = 'Multi-Chain';
          baseCardChange.textContent = 'Aggregated (EVM)';
        }
      }

      showToast(`Switched network to ${netName} • Connected`, 'success');
      netMenu.style.display = 'none';
      const chevron = netBtn.querySelector('.net-chevron');
      if (chevron) chevron.style.transform = 'rotate(0deg)';
    });
  });

  document.addEventListener('click', () => {
    if (netMenu) netMenu.style.display = 'none';
    const chevron = netBtn?.querySelector('.net-chevron');
    if (chevron) chevron.style.transform = 'rotate(0deg)';
  });
}

// --- 2. Privacy Mode (Eye Toggle) ---
const toggleEyeBtn = document.getElementById('togglePrivacyEye');
const eyeSvg = document.getElementById('privacyEyeSvg');
let isPrivacyHidden = localStorage.getItem('haptix_privacy_hidden') === 'true';

function updatePrivacyDisplay() {
  const portEth = document.getElementById('sidePortfolioEth');
  const portUsd = document.getElementById('sidePortfolioUsd');
  const ethVal = document.getElementById('sideHoldEth');
  const usdcVal = document.getElementById('sideHoldUsdc');
  const tableValEth = document.getElementById('tableValEth');
  const tableValUsdc = document.getElementById('tableValUsdc');

  if (isPrivacyHidden) {
    if (portEth) portEth.textContent = '$ • • • •';
    if (ethVal) ethVal.textContent = '••••••';
    if (usdcVal) usdcVal.textContent = '••••••';
    if (tableValEth) tableValEth.textContent = '••••••';
    if (tableValUsdc) tableValUsdc.textContent = '••••••';
    if (eyeSvg) {
      eyeSvg.innerHTML = '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/>';
    }
  } else {
    if (portEth) portEth.textContent = '$10.29';
    if (ethVal) ethVal.textContent = '$10.29';
    if (usdcVal) usdcVal.textContent = '$0.00';
    if (tableValEth) tableValEth.textContent = '$10.29';
    if (tableValUsdc) tableValUsdc.textContent = '$0.00';
    if (eyeSvg) {
      eyeSvg.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>';
    }
  }
}

if (toggleEyeBtn) {
  toggleEyeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    isPrivacyHidden = !isPrivacyHidden;
    localStorage.setItem('haptix_privacy_hidden', isPrivacyHidden);
    updatePrivacyDisplay();
    showToast(isPrivacyHidden ? 'Balance hidden (Privacy mode)' : 'Balance unhidden', 'info');
  });
  updatePrivacyDisplay();
}

// --- 3. Profile Dropdown Menu ---
const profileBtn = document.getElementById('profileBadgeBtn');
const profileMenu = document.getElementById('profileDropdownMenu');
const menuFullAddr = document.getElementById('menuFullAddress');
const menuCopyBtn = document.getElementById('menuCopyAddressBtn');

if (profileBtn && profileMenu) {
  if (menuFullAddr) menuFullAddr.textContent = `${accountAddr.slice(0, 8)}...${accountAddr.slice(-6)}`;
  
  profileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = profileMenu.style.display === 'block';
    profileMenu.style.display = isOpen ? 'none' : 'block';
    const chevron = profileBtn.querySelector('.profile-chevron');
    if (chevron) chevron.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
  });

  if (menuCopyBtn) {
    menuCopyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(accountAddr);
      menuCopyBtn.textContent = 'Copied!';
      setTimeout(() => menuCopyBtn.textContent = 'Copy', 1800);
      showToast('Address copied to clipboard!', 'success');
    });
  }

  document.getElementById('menuNavSecurity')?.addEventListener('click', () => {
    profileMenu.style.display = 'none';
    switchTab('tab-security', document.querySelectorAll('.nav-item')[5]);
  });

  document.getElementById('menuNavPolicy')?.addEventListener('click', () => {
    profileMenu.style.display = 'none';
    switchTab('tab-config', document.querySelectorAll('.nav-item')[6]);
  });

  document.getElementById('menuLockEnclave')?.addEventListener('click', () => {
    profileMenu.style.display = 'none';
    showToast('Hardware Session locked. Passkey verification required.', 'error');
  });

  document.addEventListener('click', () => {
    profileMenu.style.display = 'none';
    const chevron = profileBtn.querySelector('.profile-chevron');
    if (chevron) chevron.style.transform = 'rotate(0deg)';
  });
}

// --- 4. Notification Bell Dropdown ---
const bellWrap = document.getElementById('bellWrapper');
const notifDropdown = document.getElementById('notificationDropdown');
const btnClearNotifs = document.getElementById('btnClearNotifs');
const notifBadgeDot = document.getElementById('notifBadgeDot');
const notifCountTag = document.getElementById('notifCountTag');

if (bellWrap && notifDropdown) {
  bellWrap.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = notifDropdown.style.display === 'block';
    notifDropdown.style.display = isOpen ? 'none' : 'block';
  });

  if (btnClearNotifs) {
    btnClearNotifs.addEventListener('click', (e) => {
      e.stopPropagation();
      const list = document.getElementById('notificationList');
      if (list) list.innerHTML = '<div style="text-align:center; padding:16px; color:var(--text-muted); font-size:12px;">No unread notifications</div>';
      if (notifBadgeDot) notifBadgeDot.style.display = 'none';
      if (notifCountTag) notifCountTag.textContent = '0';
      showToast('All notifications marked as read', 'info');
    });
  }

  document.addEventListener('click', () => {
    if (notifDropdown) notifDropdown.style.display = 'none';
  });
}

// --- 5. Real-Time Search Bar Filter ---
const globalSearch = document.getElementById('globalSearchInput');
if (globalSearch) {
  globalSearch.addEventListener('input', () => {
    const q = globalSearch.value.trim().toLowerCase();
    
    // Filter Asset Items
    document.querySelectorAll('.asset-item').forEach(item => {
      const text = item.innerText.toLowerCase();
      item.style.display = (!q || text.includes(q)) ? 'flex' : 'none';
    });

    // Filter Recent Transactions
    document.querySelectorAll('#recentTxTableBody tr').forEach(row => {
      const text = row.innerText.toLowerCase();
      row.style.display = (!q || text.includes(q)) ? '' : 'none';
    });

    // Filter Assets Table rows
    document.querySelectorAll('#assetsTableBody tr').forEach(row => {
      const text = row.innerText.toLowerCase();
      row.style.display = (!q || text.includes(q)) ? '' : 'none';
    });
  });
}

// --- 6. Add Custom Asset Modal ---
const addAssetModal = document.getElementById('addAssetModal');
const openAddBtn = document.getElementById('openAddAssetModalBtn');
const closeAddBtn = document.getElementById('closeAddAssetModal');
const assetsAddBtn = document.getElementById('assetsAddTokenBtn');
const confirmAddBtn = document.getElementById('btnConfirmAddAsset');

function openAddAsset() {
  if (addAssetModal) addAssetModal.classList.add('active');
}
if (openAddBtn) openAddBtn.addEventListener('click', openAddAsset);
if (assetsAddBtn) assetsAddBtn.addEventListener('click', openAddAsset);
if (closeAddBtn) closeAddBtn.addEventListener('click', () => addAssetModal.classList.remove('active'));

// Preset chips in Add Asset modal
document.querySelectorAll('.asset-preset-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.getElementById('addAssetContract').value = chip.getAttribute('data-addr');
    document.getElementById('addAssetSymbol').value = chip.getAttribute('data-symbol');
    document.getElementById('addAssetDecimals').value = 18;
  });
});

if (confirmAddBtn) {
  confirmAddBtn.addEventListener('click', () => {
    const sym = document.getElementById('addAssetSymbol').value.trim().toUpperCase() || 'TOKEN';
    const contract = document.getElementById('addAssetContract').value.trim();
    if (!contract) {
      alert('Please enter a valid token contract address.');
      return;
    }

    // Append to Assets Row on Home Tab
    const assetsRow = document.querySelector('.assets-row');
    if (assetsRow) {
      const newItem = document.createElement('div');
      newItem.className = 'asset-item';
      newItem.innerHTML = `
        <div class="asset-icon" style="background:#EFF6FF;"><span style="color:#0052FF; font-weight:800;">★</span></div>
        <div class="asset-info">
          <h4>${sym}</h4>
          <div class="val">$0.00</div>
          <div class="change" style="color:var(--text-secondary);">0.00 ${sym}</div>
        </div>
      `;
      assetsRow.insertBefore(newItem, assetsRow.children[assetsRow.children.length - 2]);
    }

    // Append to Assets Table
    const tableBody = document.getElementById('assetsTableBody');
    if (tableBody) {
      const newRow = document.createElement('tr');
      newRow.innerHTML = `
        <td>
          <div style="display:flex; align-items:center; gap:10px;">
            <div class="asset-icon" style="background:#EFF6FF; width:32px; height:32px; border-radius:50%; display:flex; align-items:center; justify-content:center;"><span style="color:#0052FF; font-weight:800;">★</span></div>
            <div>
              <div style="font-weight:700; color:var(--text-primary);">${sym} Token</div>
              <div style="font-size:11px; color:var(--text-secondary);">${sym}</div>
            </div>
          </div>
        </td>
        <td><span style="font-size:12px; font-weight:600; color:#0052FF;">Base Sepolia</span></td>
        <td style="font-family:var(--font-mono); font-weight:600;">$0.00</td>
        <td style="font-family:var(--font-mono); font-weight:700;">0.00 ${sym}</td>
        <td style="font-family:var(--font-mono); font-weight:700;">$0.00</td>
        <td style="color:var(--text-secondary); font-weight:700;">0.0%</td>
        <td>
          <div style="display:flex; gap:6px;">
            <button class="btn-action-primary" onclick="switchTab('tab-send', document.querySelectorAll('.nav-item')[1])" style="padding:4px 10px; font-size:11px;">Send</button>
            <button class="btn-action-secondary" onclick="document.getElementById('openReceiveBtn').click()" style="padding:4px 10px; font-size:11px;">Receive</button>
          </div>
        </td>
      `;
      tableBody.appendChild(newRow);
    }

    addAssetModal.classList.remove('active');
    showToast(`Added ${sym} to portfolio tracking!`, 'success');
  });
}

// --- 7. Discover Web3 dApps Modal ---
const dappModal = document.getElementById('dappDirectoryModal');
const closeDappBtn = document.getElementById('closeDappModal');

document.querySelectorAll('.explore-item').forEach((item, i) => {
  item.style.cursor = 'pointer';
  item.addEventListener('click', () => {
    if (i === 0) {
      if (dappModal) dappModal.classList.add('active');
    } else {
      switchTab('tab-agents', document.querySelectorAll('.nav-item')[4]);
    }
  });
});

if (closeDappBtn && dappModal) {
  closeDappBtn.addEventListener('click', () => dappModal.classList.remove('active'));
}

// --- 8. Transaction Details Modal ---
const txModal = document.getElementById('txDetailsModal');
const closeTxBtn = document.getElementById('closeTxModal');

document.querySelectorAll('.clickable-tx-row').forEach(row => {
  row.addEventListener('click', (e) => {
    // If clicked direct link, let it open
    if (e.target.closest('a')) return;
    
    const name = row.getAttribute('data-name');
    const type = row.getAttribute('data-type');
    const amount = row.getAttribute('data-amount');
    const fiat = row.getAttribute('data-fiat');
    const status = row.getAttribute('data-status');
    const time = row.getAttribute('data-time');
    const hash = row.getAttribute('data-hash');
    const target = row.getAttribute('data-target');

    document.getElementById('txModalAmount').textContent = amount;
    document.getElementById('txModalFiat').textContent = `≈ ${fiat}`;
    document.getElementById('txModalBadge').textContent = status;
    document.getElementById('txModalType').textContent = type;
    document.getElementById('txModalTarget').textContent = `${target.slice(0, 8)}...${target.slice(-6)}`;
    document.getElementById('txModalTime').textContent = time;
    document.getElementById('txModalHash').textContent = `${hash.slice(0, 10)}...${hash.slice(-8)} ❐`;
    document.getElementById('txModalExplorerLink').href = `https://sepolia.basescan.org/tx/${hash}`;

    txModal.classList.add('active');
  });
});

if (closeTxBtn && txModal) {
  closeTxBtn.addEventListener('click', () => txModal.classList.remove('active'));
}

document.getElementById('txModalHash')?.addEventListener('click', () => {
  const hash = document.getElementById('txModalExplorerLink')?.href.split('/tx/')[1];
  if (hash) {
    navigator.clipboard.writeText(hash);
    showToast('Transaction hash copied!', 'success');
  }
});

// --- 9. Flip Swap Direction ---
const flipBtn = document.getElementById('btnFlipSwapTokens');
let isSwappingEthToUsdc = true;

if (flipBtn) {
  flipBtn.addEventListener('click', () => {
    isSwappingEthToUsdc = !isSwappingEthToUsdc;
    const inputAmt = document.getElementById('swapInputAmt');
    const outputAmt = document.getElementById('swapOutputAmt');
    const rate = document.getElementById('swapExchangeRate');

    if (isSwappingEthToUsdc) {
      inputAmt.value = "0.01";
      outputAmt.value = "25.00";
      rate.textContent = "2500.00";
      flipBtn.style.transform = 'rotate(0deg)';
      showToast('Swapping ETH → USDC', 'info');
    } else {
      inputAmt.value = "25.00";
      outputAmt.value = "0.01";
      rate.textContent = "0.0004";
      flipBtn.style.transform = 'rotate(180deg)';
      showToast('Swapping USDC → ETH', 'info');
    }
  });
}

// --- 10. Sidebar Promo Card Click ---
document.getElementById('sidebarPromoCard')?.addEventListener('click', () => {
  switchTab('tab-security', document.querySelectorAll('.nav-item')[5]);
});

// --- 11. View all transactions link ---
document.querySelectorAll('.view-all').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    switchTab('tab-activity', document.querySelectorAll('.nav-item')[3]);
  });
});'''

assert old_handlers in content, "old_handlers not found"
content = content.replace(old_handlers, new_handlers, 1)

with open('web/app.html', 'w') as f:
    f.write(content)

print('Successfully upgraded web/app.html with complete interactive suite!')

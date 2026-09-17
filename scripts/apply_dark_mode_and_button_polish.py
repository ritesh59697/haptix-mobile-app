import re

file_path = "web/app.html"
with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Update CSS variables with full [data-theme="dark"] and [data-theme="light"]
old_css_root = """  :root {
    --bg-app: #F8FAFC;
    --bg-surface: #FFFFFF;
    --bg-hover: #F1F5F9;
    --bg-active: #E2E8F0;
    
    --text-primary: #0F172A;
    --text-secondary: #64748B;
    --text-muted: #94A3B8;
    
    --accent-blue: #3B82F6;
    --accent-blue-light: #EFF6FF;
    --accent-green: #10B981;
    --accent-green-light: #ECFDF5;
    --accent-red: #EF4444;
    
    --border-light: #E2E8F0;
    --border-medium: #CBD5E1;
    
    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
    --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
    --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
    
    --radius-sm: 8px;
    --radius-md: 12px;
    --radius-lg: 16px;
    --radius-xl: 24px;
    
    --font-heading: 'Outfit', sans-serif;
    --font-main: 'Plus Jakarta Sans', sans-serif;
    --font-mono: 'JetBrains Mono', monospace;
  }"""

new_css_root = """  :root, [data-theme="light"] {
    --bg-app: #F8FAFC;
    --bg-surface: #FFFFFF;
    --bg-card: #FFFFFF;
    --bg-hover: #F1F5F9;
    --bg-active: #E2E8F0;
    --bg-subtle: rgba(0, 0, 0, 0.04);
    
    --text-primary: #0F172A;
    --text-secondary: #64748B;
    --text-muted: #94A3B8;
    --text-dark: #334155;
    
    --accent-blue: #0052FF;
    --accent-blue-light: #EFF6FF;
    --accent-blue-hover: #0045D8;
    --accent-green: #10B981;
    --accent-green-light: #ECFDF5;
    --accent-red: #EF4444;
    --accent-rose: #F43F5E;
    --accent-amber: #F59E0B;
    --accent-amber-light: rgba(245, 158, 11, 0.12);
    --accent-emerald: #10B981;
    
    --border-light: #E2E8F0;
    --border-medium: #CBD5E1;
    --border-focus: #93C5FD;
    
    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
    --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.07), 0 2px 4px -1px rgba(0, 0, 0, 0.04);
    --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.08), 0 4px 6px -2px rgba(0, 0, 0, 0.04);
    --shadow-card: 0 2px 10px rgba(15, 23, 42, 0.04);
    --shadow-dropdown: 0 16px 40px rgba(15, 23, 42, 0.14);
    
    --radius-sm: 8px;
    --radius-md: 12px;
    --radius-lg: 16px;
    --radius-xl: 24px;
    --radius-full: 9999px;
    
    --font-heading: 'Outfit', sans-serif;
    --font-main: 'Plus Jakarta Sans', sans-serif;
    --font-mono: 'JetBrains Mono', monospace;
  }

  [data-theme="dark"] {
    --bg-app: #080B11;
    --bg-surface: #0E121B;
    --bg-card: #131722;
    --bg-hover: #171C28;
    --bg-active: #212738;
    --bg-subtle: rgba(255, 255, 255, 0.04);
    
    --text-primary: #F8FAFC;
    --text-secondary: #94A3B8;
    --text-muted: #64748B;
    --text-dark: #CBD5E1;
    
    --accent-blue: #38BDF8;
    --accent-blue-light: rgba(56, 189, 248, 0.15);
    --accent-blue-hover: #0284C7;
    --accent-green: #10B981;
    --accent-green-light: rgba(16, 185, 129, 0.15);
    --accent-red: #F87171;
    --accent-rose: #FB7185;
    --accent-amber: #FBBF24;
    --accent-amber-light: rgba(245, 158, 11, 0.15);
    --accent-emerald: #34D399;
    
    --border-light: rgba(255, 255, 255, 0.08);
    --border-medium: rgba(255, 255, 255, 0.16);
    --border-focus: #38BDF8;
    
    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.5);
    --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4);
    --shadow-lg: 0 12px 24px -4px rgba(0, 0, 0, 0.6);
    --shadow-card: 0 4px 20px rgba(0, 0, 0, 0.35);
    --shadow-dropdown: 0 20px 50px rgba(0, 0, 0, 0.75);
  }

  /* Header Theme Toggle Button */
  .theme-toggle-header-btn {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--bg-hover);
    border: 1px solid var(--border-light);
    color: var(--text-secondary);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    padding: 0;
    flex-shrink: 0;
  }
  .theme-toggle-header-btn:hover {
    background: var(--bg-active);
    color: var(--text-primary);
    transform: scale(1.06);
    border-color: var(--border-medium);
  }
  [data-theme="light"] .theme-icon-sun { display: none; }
  [data-theme="light"] .theme-icon-moon { display: block; }
  [data-theme="dark"] .theme-icon-sun { display: block; }
  [data-theme="dark"] .theme-icon-moon { display: none; }
  :root:not([data-theme="dark"]) .theme-icon-sun { display: none; }
  :root:not([data-theme="dark"]) .theme-icon-moon { display: block; }

  /* Refined Agent Action Buttons */
  .btn-agent-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px 18px;
    font-size: 13.5px;
    font-weight: 600;
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    border: 1px solid var(--border-light);
    user-select: none;
  }
  .btn-agent-action.secondary {
    background: var(--bg-surface);
    color: var(--text-primary);
    box-shadow: var(--shadow-sm);
  }
  .btn-agent-action.secondary:hover {
    background: var(--bg-hover);
    border-color: var(--border-medium);
    transform: translateY(-1px);
    box-shadow: var(--shadow-md);
  }
  .btn-agent-action.destructive {
    background: rgba(239, 68, 68, 0.06);
    color: var(--accent-red);
    border-color: rgba(239, 68, 68, 0.25);
  }
  .btn-agent-action.destructive:hover {
    background: rgba(239, 68, 68, 0.14);
    border-color: var(--accent-red);
    transform: translateY(-1px);
    box-shadow: 0 4px 14px rgba(239, 68, 68, 0.18);
  }
  .btn-agent-action:active {
    transform: scale(0.98);
  }

  /* Interactive Agent Policy Simulator Tiles */
  .sim-card {
    background: var(--bg-surface);
    border: 1px solid var(--border-light);
    border-radius: 14px;
    padding: 16px 18px;
    cursor: pointer;
    transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1);
    box-shadow: var(--shadow-sm);
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 12px;
    position: relative;
    user-select: none;
  }
  .sim-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
  }
  .sim-card:active {
    transform: scale(0.985);
  }
  .sim-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .sim-icon-circle {
    width: 30px;
    height: 30px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .sim-icon-green {
    background: var(--accent-green-light);
    color: var(--accent-green);
  }
  .sim-icon-amber {
    background: var(--accent-amber-light);
    color: var(--accent-amber);
  }
  .sim-icon-rose {
    background: rgba(244, 63, 94, 0.12);
    color: var(--accent-rose);
  }
  .sim-tag {
    font-size: 11px;
    font-weight: 700;
    padding: 3px 9px;
    border-radius: 999px;
    letter-spacing: 0.02em;
  }
  .sim-tag-green {
    background: var(--accent-green-light);
    color: var(--accent-green);
  }
  .sim-tag-amber {
    background: var(--accent-amber-light);
    color: var(--accent-amber);
  }
  .sim-tag-rose {
    background: rgba(244, 63, 94, 0.12);
    color: var(--accent-rose);
  }
  .sim-card-title {
    font-family: var(--font-heading);
    font-weight: 700;
    font-size: 14.5px;
    color: var(--text-primary);
  }
  .sim-card-desc {
    font-size: 11.5px;
    color: var(--text-secondary);
    margin-top: 3px;
  }
  .sim-card-safe:hover {
    border-color: var(--accent-green);
    box-shadow: 0 6px 20px rgba(16, 185, 129, 0.15);
  }
  .sim-card-warning:hover {
    border-color: var(--accent-amber);
    box-shadow: 0 6px 20px rgba(245, 158, 11, 0.15);
  }
  .sim-card-danger:hover {
    border-color: var(--accent-rose);
    box-shadow: 0 6px 20px rgba(244, 63, 94, 0.15);
  }

  /* Dark mode scrollbars & modal borders */
  [data-theme="dark"] ::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }
  [data-theme="dark"] ::-webkit-scrollbar-track {
    background: var(--bg-app);
  }
  [data-theme="dark"] ::-webkit-scrollbar-thumb {
    background: var(--border-medium);
    border-radius: 3px;
  }
  [data-theme="dark"] .modal-content,
  [data-theme="dark"] .passkey-modal-content {
    background: var(--bg-surface);
    border: 1px solid var(--border-light);
  }
  [data-theme="dark"] .network-dropdown-menu,
  [data-theme="dark"] .profile-dropdown-menu,
  [data-theme="dark"] .notification-dropdown {
    background: var(--bg-surface) !important;
    border: 1px solid var(--border-light) !important;
  }"""

if old_css_root in content:
    content = content.replace(old_css_root, new_css_root)
    print("✓ Updated CSS root variables with dark and light themes")
else:
    print("✗ old_css_root not found exactly, searching alternative")

# 2. Add Theme Toggle Button to Top Header
old_header_start = """        <div class="user-profile" style="position:relative; display:flex; align-items:center; gap:14px;">
          <!-- Notification Bell Wrapper -->"""

new_header_start = """        <div class="user-profile" style="position:relative; display:flex; align-items:center; gap:12px;">
          <!-- Header Theme Toggle Button -->
          <button class="theme-toggle-header-btn" id="btnHeaderThemeToggle" title="Toggle Dark / Light Mode" aria-label="Toggle Dark / Light Mode">
            <svg class="theme-icon-sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path></svg>
            <svg class="theme-icon-moon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path></svg>
          </button>

          <!-- Notification Bell Wrapper -->"""

if old_header_start in content:
    content = content.replace(old_header_start, new_header_start)
    print("✓ Added Theme Toggle Button to Top Header")
else:
    print("✗ old_header_start not found")

# 3. Add Theme option to Profile Dropdown Menu
old_menu_policy = """              <button id="menuNavPolicy" class="menu-dropdown-item" style="display:flex; align-items:center; gap:8px; width:100%; padding:8px 10px; border-radius:8px; border:none; background:transparent; color:var(--text-primary); font-size:13px; font-weight:600; cursor:pointer; text-align:left; transition:background 0.15s ease;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                <span>Policy Firewall Settings</span>
              </button>"""

new_menu_policy = """              <button id="menuNavPolicy" class="menu-dropdown-item" style="display:flex; align-items:center; gap:8px; width:100%; padding:8px 10px; border-radius:8px; border:none; background:transparent; color:var(--text-primary); font-size:13px; font-weight:600; cursor:pointer; text-align:left; transition:background 0.15s ease;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                <span>Policy Firewall Settings</span>
              </button>
              <button id="menuToggleThemeBtn" class="menu-dropdown-item" style="display:flex; align-items:center; justify-content:space-between; width:100%; padding:8px 10px; border-radius:8px; border:none; background:transparent; color:var(--text-primary); font-size:13px; font-weight:600; cursor:pointer; text-align:left; transition:background 0.15s ease;">
                <span style="display:flex; align-items:center; gap:8px;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path></svg>
                  <span>Dark / Light Mode</span>
                </span>
                <span id="menuThemeStatusBadge" style="font-size:10px; padding:2px 7px; border-radius:999px; background:var(--bg-hover); color:var(--text-secondary); text-transform:capitalize;">Theme</span>
              </button>"""

if old_menu_policy in content:
    content = content.replace(old_menu_policy, new_menu_policy)
    print("✓ Added Theme Toggle to Profile Dropdown Menu")
else:
    print("✗ old_menu_policy not found")

# 4. Redesign the odd-looking buttons in the Agents Tab
old_agent_buttons = """<div style="display:flex;gap:10px;margin-top:16px;">
<button class="action-btn-primary" id="btnToggleGrantForm" style="flex:1;padding:10px;font-size:13px;background:var(--bg-hover);color:var(--text-primary);border:1px solid var(--border-light);display:inline-flex;align-items:center;justify-content:center;gap:6px;">
<svg fill="none" height="14" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewbox="0 0 24 24" width="14"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                Reconfigure Session
              </button>
<button class="action-btn-primary" id="btnRevokeAgentSession" style="flex:1;padding:10px;font-size:13px;background:rgba(244,63,94,0.15);color:var(--accent-rose);border:1px solid rgba(244,63,94,0.3);display:inline-flex;align-items:center;justify-content:center;gap:6px;">
<svg fill="none" height="14" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewbox="0 0 24 24" width="14"><circle cx="12" cy="12" r="10"></circle><path d="m4.9 4.9 14.2 14.2"></path></svg>
                Revoke Session
              </button>
</div>"""

new_agent_buttons = """<div style="display:flex; gap:12px; margin-top:20px;">
  <button id="btnToggleGrantForm" class="btn-agent-action secondary" style="flex:1;">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>
    <span>Reconfigure Session</span>
  </button>
  <button id="btnRevokeAgentSession" class="btn-agent-action destructive" style="flex:1;">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="m4.9 4.9 14.2 14.2"></path></svg>
    <span>Revoke Session</span>
  </button>
</div>"""

if old_agent_buttons in content:
    content = content.replace(old_agent_buttons, new_agent_buttons)
    print("✓ Replaced Reconfigure and Revoke buttons with premium action buttons")
else:
    print("✗ old_agent_buttons not found")

# 5. Redesign the three Agent Action Simulator buttons
old_sim_buttons = """<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:12px;">
<button class="action-btn-primary" id="btnTestAgentMicro" style="padding:12px;font-size:13px;background:rgba(16,185,129,0.12);color:var(--accent-emerald);border:1px solid rgba(16,185,129,0.3);display:inline-flex;align-items:center;justify-content:center;gap:6px;">
<svg fill="none" height="14" stroke="currentColor" stroke-width="2.5" viewbox="0 0 24 24" width="14"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"></path></svg>
                Send $20 (Autonomous)
              </button>
<button class="action-btn-primary" id="btnTestAgentEscalated" style="padding:12px;font-size:13px;background:rgba(245,158,11,0.12);color:var(--accent-amber);border:1px solid rgba(245,158,11,0.3);display:inline-flex;align-items:center;justify-content:center;gap:6px;">
<svg fill="none" height="14" stroke="currentColor" stroke-width="2.5" viewbox="0 0 24 24" width="14"><circle cx="7.5" cy="15.5" r="5.5"></circle><path d="m21 2-9.6 9.6"></path><path d="m15.5 7.5 3 3L22 7l-3-3"></path></svg>
                Send $150 (Escalated)
              </button>
<button class="action-btn-primary" id="btnTestAgentCeiling" style="padding:12px;font-size:13px;background:rgba(244,63,94,0.12);color:var(--accent-rose);border:1px solid rgba(244,63,94,0.3);display:inline-flex;align-items:center;justify-content:center;gap:6px;">
<svg fill="none" height="14" stroke="currentColor" stroke-width="2.5" viewbox="0 0 24 24" width="14"><circle cx="12" cy="12" r="10"></circle><path d="m4.9 4.9 14.2 14.2"></path></svg>
                Send $350 (Ceiling Block)
              </button>
</div>"""

new_sim_buttons = """<div class="simulator-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(230px, 1fr)); gap:14px; margin-top:16px;">
  <!-- Test 1: Autonomous -->
  <div class="sim-card sim-card-safe" id="btnTestAgentMicro" role="button" tabindex="0">
    <div class="sim-card-header">
      <div class="sim-icon-circle sim-icon-green">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"></path></svg>
      </div>
      <span class="sim-tag sim-tag-green">1-Sig Fast-Path</span>
    </div>
    <div class="sim-card-body">
      <div class="sim-card-title">Send $20.00 USDC</div>
      <div class="sim-card-desc">Within $50 autonomous limit (Instant)</div>
    </div>
  </div>

  <!-- Test 2: Escalated Quorum -->
  <div class="sim-card sim-card-warning" id="btnTestAgentEscalated" role="button" tabindex="0">
    <div class="sim-card-header">
      <div class="sim-icon-circle sim-icon-amber">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="7.5" cy="15.5" r="5.5"></circle><path d="m21 2-9.6 9.6"></path><path d="m15.5 7.5 3 3L22 7l-3-3"></path></svg>
      </div>
      <span class="sim-tag sim-tag-amber">2-of-2 Quorum</span>
    </div>
    <div class="sim-card-body">
      <div class="sim-card-title">Send $150.00 USDC</div>
      <div class="sim-card-desc">Exceeds threshold → Hardware passkey</div>
    </div>
  </div>

  <!-- Test 3: Ceiling Blocked -->
  <div class="sim-card sim-card-danger" id="btnTestAgentCeiling" role="button" tabindex="0">
    <div class="sim-card-header">
      <div class="sim-icon-circle sim-icon-rose">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"></circle><path d="m4.9 4.9 14.2 14.2"></path></svg>
      </div>
      <span class="sim-tag sim-tag-rose">Firewall Blocked</span>
    </div>
    <div class="sim-card-body">
      <div class="sim-card-title">Send $350.00 USDC</div>
      <div class="sim-card-desc">Exceeds $200 ceiling → Strict reject</div>
    </div>
  </div>
</div>"""

if old_sim_buttons in content:
    content = content.replace(old_sim_buttons, new_sim_buttons)
    print("✓ Replaced simulator buttons with modern policy testbed tiles")
else:
    print("✗ old_sim_buttons not found")

# 6. Replace hardcoded #FFFFFF in dropdowns
content = content.replace('id="notificationDropdown" style="display:none; position:absolute; top:calc(100% + 14px); right:-60px; width:330px; background:#FFFFFF;', 'id="notificationDropdown" style="display:none; position:absolute; top:calc(100% + 14px); right:-60px; width:330px; background:var(--bg-surface);')
content = content.replace('id="profileDropdownMenu" style="display:none; position:absolute; top:calc(100% + 10px); right:0; width:280px; background:#FFFFFF;', 'id="profileDropdownMenu" style="display:none; position:absolute; top:calc(100% + 10px); right:0; width:280px; background:var(--bg-surface);')
content = content.replace('id="networkDropdownMenu" style="display:none; position:absolute; top:calc(100% + 6px); right:0; width:240px; background:#FFFFFF;', 'id="networkDropdownMenu" style="display:none; position:absolute; top:calc(100% + 6px); right:0; width:240px; background:var(--bg-surface);')
content = content.replace('.passkey-modal-content {\n    background: #FFFFFF;', '.passkey-modal-content {\n    background: var(--bg-surface);\n    border: 1px solid var(--border-light);')

# 7. Add Theme Controller in JavaScript (around the end of the script)
theme_js = """
// --- 10. Complete Dark / Light Theme System ---
const THEME_KEY = 'haptix_theme';
function getSystemTheme() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

let currentTheme = localStorage.getItem(THEME_KEY) || getSystemTheme();

function applyTheme(theme, showToastMsg = false) {
  currentTheme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);

  const statusBadge = document.getElementById('menuThemeStatusBadge');
  if (statusBadge) {
    statusBadge.textContent = theme.toUpperCase();
  }

  if (showToastMsg) {
    showToast(`Switched to ${theme === 'dark' ? 'Dark' : 'Light'} mode`, 'info');
  }
}

// Initial apply
applyTheme(currentTheme, false);

// Header button listener
const btnHeaderTheme = document.getElementById('btnHeaderThemeToggle');
if (btnHeaderTheme) {
  btnHeaderTheme.addEventListener('click', (e) => {
    e.stopPropagation();
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme, true);
  });
}

// Menu button listener
const btnMenuTheme = document.getElementById('menuToggleThemeBtn');
if (btnMenuTheme) {
  btnMenuTheme.addEventListener('click', (e) => {
    e.stopPropagation();
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme, true);
    const profileMenu = document.getElementById('profileDropdownMenu');
    if (profileMenu) profileMenu.style.display = 'none';
  });
}
"""

old_script_end = "showToast(`Added ${sym} to portfolio tracking!`, 'success');\n  });\n}"
new_script_end = old_script_end + "\n" + theme_js

if old_script_end in content:
    content = content.replace(old_script_end, new_script_end)
    print("✓ Injected theme controller JavaScript")
else:
    print("✗ old_script_end not found")

with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)

print("Successfully applied dark mode & button redesign!")

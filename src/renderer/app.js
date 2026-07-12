// Application state
let credentials = null;
let updateInterval = null;
let countdownInterval = null;
let latestUsageData = null;
let isExpanded = false;
let isCompactMode = false;
let _settingsOpenedFromCompact = false;
let usageChart = null;
let graphVisible = false;
let graphWasVisible = false; // preserves graph state across compact mode toggle
let appInitializing = true;  // suppresses _saveViewState during startup restore
let isFetching = false;       // in-flight guard — prevents overlapping fetchUsageData calls
const UPDATE_INTERVAL = 5 * 60 * 1000; // 5 minutes
const WIDGET_HEIGHT_COLLAPSED = 155;
const WIDGET_ROW_HEIGHT = 30;
// --- AI Usage: multi-provider --- graph height now includes the chip row.
// Canvas area is preserved at the original 220px; GRAPH_CHIPS_BLOCK is the
// one-row chip strip (min-height 22 + margin-bottom 8) minus the 4px reclaimed
// from the section's reduced top padding (14 -> 10). 232 + 26 = 258.
// GRAPH_CHIP_ROW is the single-row baseline (22px) already budgeted inside
// GRAPH_HEIGHT; when many chips force the flex row to WRAP, buildGraphChips
// measures the real rendered height and stashes the overflow beyond that
// baseline in _graphChipsExtra, which resizeWidget adds to the graph offset.
const GRAPH_CHIPS_BLOCK = 26;
const GRAPH_CHIP_ROW = 22;
const GRAPH_HEIGHT = 232 + GRAPH_CHIPS_BLOCK;
let _graphChipsExtra = 0;
// --- end AI Usage ---

// --- AI Usage: multi-provider ---
// Layout constants for the extra provider sections. Provider data rows are
// sized in CSS (.provider-row / .or-row = 28px + 2px margin) to be exactly
// WIDGET_ROW_HEIGHT tall, and .provider-header to SECTION_HEADER_HEIGHT, so the
// arithmetic in computeCollapsedHeight() stays exact.
const SECTION_HEADER_HEIGHT = 30;   // provider-header footprint (margin+border+padding+line)
const CLAUDE_ROW_HEIGHT = 34;       // Claude .usage-section = 32px + 2px margin
const CONTENT_CHROME = 68;          // title-bar (36) + .content vertical padding (32), no Claude, no toggle
const PLACEHOLDER_HEIGHT = 57;      // #allHiddenPlaceholder message block (~44px padding + ~13px line)

// Provider fetch state. OpenRouter is throttled independently of Claude/Codex.
let lastOpenRouterFetch = 0;
let latestCodexData = null;
let openRouterFetched = false;   // true once OpenRouter has returned any result this session
let codexAuthPresent = false;
// Last OpenRouter result — stored so the compact view can render credits without
// re-fetching (renderOpenRouter is the only place OR data lands in the renderer).
let latestOpenRouterData = null;
// Last window height sent to the main process; used to skip redundant resize IPC.
let _lastSentHeight = -1;
// Compact-mode height memo — mirrors _lastSentHeight for the compact sizing path.
let _lastCompactHeight = -1;

// Compact-mode layout constants. Calibrated so a single two-bar provider (the
// classic Claude-only view) resolves to exactly 105px, preserving the original
// compact window height pixel-for-pixel. Height =
//   COMPACT_BASE + Σ(block heights) + COMPACT_BLOCK_GAP*(blocks-1)
// where a block adds COMPACT_LABEL when a provider heading is shown.
const COMPACT_BASE = 70;        // title bar (36) + content padding (12) + centering slack (22)
const COMPACT_BLOCK_GAP = 10;   // vertical gap between provider blocks (.compact-rows gap)
const COMPACT_TWO_BAR = 35;     // two bars (14 each) + inner gap (7)
const COMPACT_BAR_ROW = 21;     // --- AI Usage: multi-provider --- one extra bar row: bar (14) + block gap (7); adds the pinned Fable bar
const COMPACT_OR_LINE = 14;     // single credits line
const COMPACT_LABEL = 19;       // provider heading line (12) + block gap to first row (7)

// Pinned scoped-limit row. The user's plan surfaces a per-model weekly limit
// (e.g. Fable) that normalizeUsageData registers as a synthetic
// seven_day_scoped_<slug> key. This single pattern decides which scoped slug is
// promoted out of the expand panel into a dedicated pinned row under Weekly.
const PINNED_SCOPED_PATTERN = /fable/i;
let fableDataPresent = false;   // a scoped row matching PINNED_SCOPED_PATTERN has data this cycle
let fablePinnedVisible = false; // gated: claude enabled + Fable row shown + fable data present
let pinnedFableKey = null;      // EXTRA_ROW_CONFIG key currently pinned (excluded from expand panel)
// --- end AI Usage ---

// Debug logging — only shows in DevTools (development mode).
// Regular users won't see verbose logs in production.
const DEBUG = (new URLSearchParams(window.location.search)).has('debug');
function debugLog(...args) {
  if (DEBUG) console.log('[Debug]', ...args);
}

// DOM elements
const elements = {
    loadingContainer: document.getElementById('loadingContainer'),
    loginContainer: document.getElementById('loginContainer'),
    noUsageContainer: document.getElementById('noUsageContainer'),
    mainContent: document.getElementById('mainContent'),
    loginStep1: document.getElementById('loginStep1'),
    loginStep2: document.getElementById('loginStep2'),
    autoDetectBtn: document.getElementById('autoDetectBtn'),
    autoDetectError: document.getElementById('autoDetectError'),
    openBrowserLink: document.getElementById('openBrowserLink'),
    nextStepBtn: document.getElementById('nextStepBtn'),
    backStepBtn: document.getElementById('backStepBtn'),
    sessionKeyInput: document.getElementById('sessionKeyInput'),
    connectBtn: document.getElementById('connectBtn'),
    sessionKeyError: document.getElementById('sessionKeyError'),
    refreshBtn: document.getElementById('refreshBtn'),
    graphBtn: document.getElementById('graphBtn'),
    minimizeBtn: document.getElementById('minimizeBtn'),
    closeBtn: document.getElementById('closeBtn'),

    sessionPercentage: document.getElementById('sessionPercentage'),
    sessionProgress: document.getElementById('sessionProgress'),
    sessionTimer: document.getElementById('sessionTimer'),
    sessionTimeText: document.getElementById('sessionTimeText'),

    weeklyPercentage: document.getElementById('weeklyPercentage'),
    weeklyProgress: document.getElementById('weeklyProgress'),
    weeklyTimer: document.getElementById('weeklyTimer'),
    weeklyTimeText: document.getElementById('weeklyTimeText'),
    weeklyResetsAt: document.getElementById('weeklyResetsAt'),

    // --- AI Usage: multi-provider --- pinned scoped (Fable) row in the Claude section
    claudeFableRow: document.getElementById('claudeFableRow'),
    claudeFableProgress: document.getElementById('claudeFableProgress'),
    claudeFablePercentage: document.getElementById('claudeFablePercentage'),
    claudeFableTimer: document.getElementById('claudeFableTimer'),
    claudeFableTimeText: document.getElementById('claudeFableTimeText'),
    claudeFableResetsAt: document.getElementById('claudeFableResetsAt'),
    // --- end AI Usage ---

    sessionResetsAt: document.getElementById('sessionResetsAt'),

    expandToggle: document.getElementById('expandToggle'),
    expandArrow: document.getElementById('expandArrow'),
    expandSection: document.getElementById('expandSection'),
    extraRows: document.getElementById('extraRows'),
    graphSection: document.getElementById('graphSection'),
    usageChart: document.getElementById('usageChart'),
    graphChips: document.getElementById('graphChips'), // --- AI Usage: multi-provider ---

    settingsBtn: document.getElementById('settingsBtn'),
    settingsOverlay: document.getElementById('settingsOverlay'),
    closeSettingsBtn: document.getElementById('closeSettingsBtn'),
    logoutBtn: document.getElementById('logoutBtn'),
    coffeeBtn: document.getElementById('coffeeBtn'),
    autoStartCol: document.getElementById('autoStartCol'),
    autoStartToggle: document.getElementById('autoStartToggle'),
    autoStartHint: document.getElementById('autoStartHint'),
    minimizeToTrayToggle: document.getElementById('minimizeToTrayToggle'),
    alwaysOnTopToggle: document.getElementById('alwaysOnTopToggle'),
    showTrayStatsToggle: document.getElementById('showTrayStatsToggle'),
    warnThreshold: document.getElementById('warnThreshold'),
    dangerThreshold: document.getElementById('dangerThreshold'),
    themeBtns: document.querySelectorAll('.theme-btn'),
    timeFormat: document.getElementById('timeFormat'),
    weeklyDateFormat: document.getElementById('weeklyDateFormat'),
    refreshInterval: document.getElementById('refreshInterval'),
    orgSelector: document.getElementById('orgSelector'),
    orgSelectorCol: document.getElementById('orgSelectorCol'),

    updateBanner: document.getElementById('updateBanner'),
    updateBannerText: document.getElementById('updateBannerText'),
    updateBannerDismiss: document.getElementById('updateBannerDismiss'),
    settingsVersionLabel: document.getElementById('settingsVersionLabel'),
    settingsUpdateLink: document.getElementById('settingsUpdateLink'),
    usageAlertsToggle: document.getElementById('usageAlertsToggle'),
    compactModeToggle: document.getElementById('compactModeToggle'),
    compactModeToggleCompact: document.getElementById('compactModeToggleCompact'),
    compactContent: document.getElementById('compactContent'),
    compactCollapseBtn: document.getElementById('compactCollapseBtn'),
    compactExpandBtn: document.getElementById('compactExpandBtn'),
    // --- AI Usage: multi-provider --- compact rows are now built dynamically into this container
    compactRows: document.getElementById('compactRows'),
    compactSettingsOverlay: document.getElementById('compactSettingsOverlay'),
    closeCompactSettingsBtn: document.getElementById('closeCompactSettingsBtn'),

    // --- AI Usage: multi-provider ---
    claudeSection: document.getElementById('claudeSection'),
    codexSection: document.getElementById('codexSection'),
    openrouterSection: document.getElementById('openrouterSection'),
    allHiddenPlaceholder: document.getElementById('allHiddenPlaceholder'),

    claudeError: document.getElementById('claudeError'),
    codexError: document.getElementById('codexError'),
    codexSessionRow: document.getElementById('codexSessionRow'),
    codexWeeklyRow: document.getElementById('codexWeeklyRow'),
    codexSessionProgress: document.getElementById('codexSessionProgress'),
    codexSessionPercentage: document.getElementById('codexSessionPercentage'),
    codexSessionTimer: document.getElementById('codexSessionTimer'),
    codexSessionTimeText: document.getElementById('codexSessionTimeText'),
    codexSessionResetsAt: document.getElementById('codexSessionResetsAt'),
    codexWeeklyProgress: document.getElementById('codexWeeklyProgress'),
    codexWeeklyPercentage: document.getElementById('codexWeeklyPercentage'),
    codexWeeklyTimer: document.getElementById('codexWeeklyTimer'),
    codexWeeklyTimeText: document.getElementById('codexWeeklyTimeText'),
    codexWeeklyResetsAt: document.getElementById('codexWeeklyResetsAt'),

    openrouterError: document.getElementById('openrouterError'),
    orWarn: document.getElementById('orWarn'),
    orRowToday: document.getElementById('orRowToday'),
    orRowWeek: document.getElementById('orRowWeek'),
    orRowMonth: document.getElementById('orRowMonth'),
    orRowCredits: document.getElementById('orRowCredits'),
    orTodayVal: document.getElementById('orTodayVal'),
    orWeekVal: document.getElementById('orWeekVal'),
    orMonthVal: document.getElementById('orMonthVal'),
    orCreditsVal: document.getElementById('orCreditsVal'),
    orCreditsTotal: document.getElementById('orCreditsTotal'),

    // Settings — providers group
    providerClaudeToggle: document.getElementById('providerClaudeToggle'),
    providerCodexToggle: document.getElementById('providerCodexToggle'),
    providerOpenrouterToggle: document.getElementById('providerOpenrouterToggle'),
    claudeSub: document.getElementById('claudeSub'),
    codexSub: document.getElementById('codexSub'),
    openrouterSub: document.getElementById('openrouterSub'),
    claudeRowSession: document.getElementById('claudeRowSession'),
    claudeRowWeekly: document.getElementById('claudeRowWeekly'),
    claudeRowFable: document.getElementById('claudeRowFable'), // --- AI Usage: multi-provider ---
    codexRowSession: document.getElementById('codexRowSession'),
    codexRowWeekly: document.getElementById('codexRowWeekly'),
    codexStatusLine: document.getElementById('codexStatusLine'),
    orRowTodayChk: document.getElementById('orRowTodayChk'),
    orRowWeekChk: document.getElementById('orRowWeekChk'),
    orRowMonthChk: document.getElementById('orRowMonthChk'),
    orRowCreditsChk: document.getElementById('orRowCreditsChk'),
    orKeyInput: document.getElementById('orKeyInput'),
    orKeySaveBtn: document.getElementById('orKeySaveBtn'),
    orKeyClearBtn: document.getElementById('orKeyClearBtn'),
    orKeyStatus: document.getElementById('orKeyStatus'),
    orKeysLink: document.getElementById('orKeysLink')
    // --- end AI Usage ---
};

// --- AI Usage: multi-provider ---
// Claude's two data rows have no ids (preserved verbatim from the original
// markup); grab them from the section so per-row visibility can toggle them.
const claudeDataRows = elements.claudeSection
    ? elements.claudeSection.querySelectorAll('.usage-section')
    : [];
const claudeSessionRow = claudeDataRows[0] || null;
const claudeWeeklyRow = claudeDataRows[1] || null;

// Single source of truth for provider/row preference defaults. Everywhere that
// reads settings.providers / settings.visibleRows funnels through here so the
// default literals live in exactly one place.
function getProviderPrefs(settings) {
    const s = settings || {};
    const providers = s.providers || { claude: true, codex: false, openrouter: false };
    const VR = s.visibleRows || {};
    const visibleRows = {
        claude: VR.claude || { session: true, weekly: true, fable: true }, // --- AI Usage: multi-provider --- fable default
        codex: VR.codex || { session: true, weekly: true },
        openrouter: VR.openrouter || { today: true, week: true, month: true, credits: true }
    };
    return { providers, visibleRows };
}
// --- end AI Usage ---

// Populate organization selector dropdown
function populateOrgSelector(organizations, selectedOrgId) {
    if (!organizations || organizations.length === 0) {
        // No orgs - hide selector column
        elements.orgSelectorCol.style.display = 'none';
        return;
    }

    // Only show selector if user has multiple chat orgs
    if (organizations.length > 1) {
        elements.orgSelectorCol.style.display = '';  // Show column (use default flex display)
        
        // Clear existing options
        elements.orgSelector.innerHTML = '';
        
        // Add each org as an option
        organizations.forEach(org => {
            const option = document.createElement('option');
            option.value = org.id;
            option.textContent = `${org.name}${org.isTeam ? ' (Team)' : ' (Personal)'}`;
            if (org.id === selectedOrgId) {
                option.selected = true;
            }
            elements.orgSelector.appendChild(option);
        });
    } else {
        // Single org - hide selector column
        elements.orgSelectorCol.style.display = 'none';
    }
}

// Handle organization change
async function handleOrgChange() {
    const newOrgId = elements.orgSelector.value;
    if (newOrgId && newOrgId !== credentials.organizationId) {
        credentials.organizationId = newOrgId;
        await window.electronAPI.saveCredentials(credentials);
        // Refresh usage data with new org
        await fetchUsageData();
    }
}

// Initialize
async function init() {
    setupEventListeners();
    credentials = await window.electronAPI.getCredentials();

    // Apply saved theme and load thresholds immediately
    const settings = await window.electronAPI.getSettings();
    window._cachedSettings = settings;
    applyTheme(settings.theme);
    if (window.electronAPI.platform === 'darwin') {
        document.getElementById('trayLabel').textContent = 'Hide from Dock';
    }
    warnThreshold = settings.warnThreshold;
    dangerThreshold = settings.dangerThreshold;

    // Restore compact mode from saved settings
    if (settings.compactMode) {
        applyCompactMode(true);
    } else {
        // Ensure compact overlay is hidden in normal mode
        if (elements.compactSettingsOverlay) elements.compactSettingsOverlay.style.display = 'none';
    }

    // Restore graph visibility
    if (settings.graphVisible) {
        if (!settings.compactMode) {
            // Normal mode — show graph immediately
            graphVisible = true;
            elements.graphBtn.classList.add('active');
            elements.graphSection.style.display = 'block';
        } else {
            // Compact mode — store so it restores when exiting compact
            graphWasVisible = true;
        }
    }

    // Restore expanded state
    if (settings.expandedOpen) {
        isExpanded = true;
        elements.expandArrow.classList.add('expanded');
        elements.expandSection.style.display = 'block';
    }

    // --- AI Usage: multi-provider ---
    // Probe Codex auth presence up front so the Settings status line is accurate
    // even before the first fetch. Fire-and-forget so it never blocks first paint.
    window.electronAPI.getCodexStatus()
        .then((cs) => { codexAuthPresent = !!(cs && cs.present); })
        .catch(() => { codexAuthPresent = false; });

    const { providers } = getProviderPrefs(settings);
    if (!providers.claude) {
        // Claude disabled — show main content and fetch the other providers.
        // Never fall through to the login screen.
        showMainContent();
        applyVisibility();
        await fetchUsageData();
        startAutoUpdate();
    } else if (credentials.sessionKey && credentials.organizationId) {
        // Populate org selector if user has multiple orgs
        if (credentials.organizations && credentials.organizations.length > 0) {
            populateOrgSelector(credentials.organizations, credentials.organizationId);
        }
        showMainContent();
        applyVisibility();
        await fetchUsageData();
        startAutoUpdate();
    } else {
        showLoginRequired();
    }
    // --- end AI Usage ---

    // Populate version label then check for updates after a short delay
    const version = await window.electronAPI.getAppVersion();
    if (elements.settingsVersionLabel) {
        elements.settingsVersionLabel.textContent = `Application Version: v${version}`;
    }
    setTimeout(checkForUpdate, 2000);
    // Also check once every 24 hours for users who never close the app
    setInterval(checkForUpdate, 24 * 60 * 60 * 1000);

    // Startup restore complete — allow _saveViewState to persist changes
    appInitializing = false;
}

// Event Listeners
function setupEventListeners() {
    // Step 1: Login via BrowserWindow
    elements.autoDetectBtn.addEventListener('click', handleAutoDetect);

    // Step navigation
    elements.nextStepBtn.addEventListener('click', () => {
        elements.loginStep1.style.display = 'none';
        elements.loginStep2.style.display = 'block';
        elements.sessionKeyInput.focus();
    });

    elements.backStepBtn.addEventListener('click', () => {
        elements.loginStep2.style.display = 'none';
        elements.loginStep1.style.display = 'flex';
        elements.sessionKeyError.textContent = '';
    });

    // Open browser link in step 2
    elements.openBrowserLink.addEventListener('click', (e) => {
        e.preventDefault();
        window.electronAPI.openExternal('https://claude.ai');
    });

    // Step 2: Manual sessionKey connect
    elements.connectBtn.addEventListener('click', handleConnect);
    elements.sessionKeyInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleConnect();
        elements.sessionKeyError.textContent = '';
    });

    elements.refreshBtn.addEventListener('click', async () => {
        debugLog('Refresh button clicked');
        elements.refreshBtn.classList.add('spinning');
        await fetchUsageData({ manual: true }); // --- AI Usage: multi-provider --- manual bypasses OR 60s throttle (>10s)
        elements.refreshBtn.classList.remove('spinning');
    });

    elements.graphBtn.addEventListener('click', async () => {
        graphVisible = !graphVisible;
        elements.graphBtn.classList.toggle('active', graphVisible);
        elements.graphSection.style.display = graphVisible ? 'block' : 'none';
        if (graphVisible) {
            await loadChart();
        }
        if (!isCompactMode) resizeWidget();
        _saveViewState();
    });

    elements.minimizeBtn.addEventListener('click', () => {
        window.electronAPI.minimizeWindow();
    });

    elements.closeBtn.addEventListener('click', () => {
        window.electronAPI.closeWindow();
    });

    // Expand/collapse toggle
    elements.expandToggle.addEventListener('click', async () => {
        const wasExpanded = isExpanded;
        isExpanded = !isExpanded;
        elements.expandArrow.classList.toggle('expanded', isExpanded);
        elements.expandSection.style.display = isExpanded ? 'block' : 'none';
        if (graphVisible) {
            loadChart();
        }
        resizeWidget();
        
        // CRITICAL: Update expandedOpen setting IMMEDIATELY (no debounce) to prevent race condition
        // If we wait for the debounced save, auto-refresh might fetch with stale expandedOpen=false
        const settings = window._cachedSettings || await window.electronAPI.getSettings();
        settings.expandedOpen = isExpanded;
        window._cachedSettings = settings;
        await window.electronAPI.saveSettings(settings);
        
        // Trigger immediate fetch if panel was just opened (collapsed → expanded)
        // This ensures fresh overage/prepaid data is available when user expands the panel
        // Pass forceExtended to bypass any cached setting and fetch extended data immediately
        if (!wasExpanded && isExpanded) {
            debugLog('[Conditional Polling] Panel expanded - triggering immediate fetch with extended data');
            await fetchUsageData({ forceExtended: true });
        }
    });

    // Settings close
    elements.closeSettingsBtn.addEventListener('click', async () => {
        await saveSettings();
        elements.settingsOverlay.style.display = 'none';
        // --- AI Usage: multi-provider --- one immediate visibility pass for instant
        // feedback when toggling rows; applyVisibility() already resizes (when not
        // compact), and the resize memo no-ops any follow-up from fetchUsageData.
        applyVisibility();
        // Rebuild the open chart immediately so a provider toggled off in
        // Settings drops its plotted series and chips now, not on the next
        // successful fetch (which may fail and leave them stale).
        if (graphVisible && !isCompactMode) {
            loadChart().catch(() => {});
        }
        if (_settingsOpenedFromCompact) {
            _settingsOpenedFromCompact = false;
            if (isCompactMode) {
                // Settings temporarily expanded the window to normal size; rebuild
                // and re-size the compact view. Invalidate the memo so the width
                // (reset to normal above) is re-applied even if the height is unchanged.
                _lastCompactHeight = -1;
                renderCompact();
            }
            // else: applyVisibility() already resized the normal-mode window.
        }
        // --- end AI Usage ---
        startAutoUpdate();
        // --- AI Usage: multi-provider --- pick up newly-enabled providers immediately
        fetchUsageData({ manual: true });
        // --- end AI Usage ---
    });

    elements.logoutBtn.addEventListener('click', async () => {
        await window.electronAPI.deleteCredentials();
        credentials = { sessionKey: null, organizationId: null };
        elements.settingsOverlay.style.display = 'none';
        showLoginRequired();
    });

    elements.coffeeBtn.addEventListener('click', () => {
        window.electronAPI.openExternal('https://paypal.me/SlavomirDurej?country.x=GB&locale.x=en_GB');
    });

    // Theme buttons
    elements.themeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            elements.themeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            applyTheme(btn.dataset.theme);
        });
    });

    // Prevent accidental app hiding: bidirectional coupling between Hide from Taskbar and Show Tray Stats
    // If user enables "Hide from Taskbar", automatically enable "Show Tray Stats" (ensures tray icon is visible)
    elements.minimizeToTrayToggle.addEventListener('change', () => {
        if (elements.minimizeToTrayToggle.checked && !elements.showTrayStatsToggle.checked) {
            elements.showTrayStatsToggle.checked = true;
        }
    });

    // If user disables "Show Tray Stats", automatically disable "Hide from Taskbar" (prevents app from being completely hidden)
    elements.showTrayStatsToggle.addEventListener('change', () => {
        if (!elements.showTrayStatsToggle.checked && elements.minimizeToTrayToggle.checked) {
            elements.minimizeToTrayToggle.checked = false;
        }
    });

    // Listen for refresh requests from tray
    window.electronAPI.onRefreshUsage(async () => {
        if (elements.refreshBtn) elements.refreshBtn.classList.add('spinning');
        await fetchUsageData({ manual: true }); // --- AI Usage: multi-provider ---
        if (elements.refreshBtn) elements.refreshBtn.classList.remove('spinning');
    });

    // Listen for session expiration events (403 errors)
    window.electronAPI.onSessionExpired(() => {
        debugLog('Session expired event received');
        credentials = { sessionKey: null, organizationId: null };
        showLoginRequired();
    });

    // Update banner
    elements.updateBannerDismiss.addEventListener('click', () => {
        elements.updateBanner.style.display = 'none';
        resizeWidget();
    });
    elements.updateBannerText.addEventListener('click', () => {
        window.electronAPI.openExternal(`https://github.com/spezzuti/burnrate-widget/releases/latest`);
    });
    elements.settingsUpdateLink.addEventListener('click', () => {
        window.electronAPI.openExternal(`https://github.com/spezzuti/burnrate-widget/releases/latest`);
    });

    // Compact mode — collapse chevron (normal → compact)
    elements.compactCollapseBtn.addEventListener('click', async () => {
        applyCompactMode(true);
        await _saveCompactSetting(true);
    });

    // Compact mode — expand chevron (compact → normal)
    elements.compactExpandBtn.addEventListener('click', async () => {
        applyCompactMode(false);
        await _saveCompactSetting(false);
    });

    // Compact mode toggle in normal settings panel — deferred to Done click

    // Compact mode toggle in compact settings panel — just updates the checkbox, Done applies it
    elements.compactModeToggleCompact.addEventListener('change', () => {
        // No immediate action — Done button reads this value and applies
    });

    // Organization selector — change triggers immediate save and refresh
    elements.orgSelector.addEventListener('change', handleOrgChange);

    // Settings button — always open full settings; if in compact mode, temporarily expand the window first
    elements.settingsBtn.addEventListener('click', async () => {
        stopAutoUpdate();
        if (isCompactMode) {
            _settingsOpenedFromCompact = true;
            window.electronAPI.setCompactMode(false);
        }
        await loadSettings();
        elements.settingsOverlay.style.display = 'flex';
        sizeSettingsWindow(); // --- AI Usage: multi-provider --- size to fit providers group
    });

    // Close compact settings — apply compact toggle value then close
    elements.closeCompactSettingsBtn.addEventListener('click', async () => {
        const compact = elements.compactModeToggleCompact.checked;
        if (compact !== isCompactMode) {
            applyCompactMode(compact);
            await _saveCompactSetting(compact);
        }
        elements.compactSettingsOverlay.style.display = 'none';
        startAutoUpdate();
    });

    // --- AI Usage: multi-provider --- provider settings wiring
    if (elements.providerClaudeToggle) {
        elements.providerClaudeToggle.addEventListener('change', () => {
            updateProviderSubsVisibility();
            sizeSettingsWindow();
        });
    }
    if (elements.providerCodexToggle) {
        elements.providerCodexToggle.addEventListener('change', async () => {
            updateProviderSubsVisibility();
            // Refresh on-disk auth presence so the status line is current.
            try {
                const cs = await window.electronAPI.getCodexStatus();
                codexAuthPresent = !!(cs && cs.present);
            } catch (e) { /* ignore */ }
            updateCodexStatusLine();
            sizeSettingsWindow();
        });
    }
    if (elements.providerOpenrouterToggle) {
        elements.providerOpenrouterToggle.addEventListener('change', () => {
            updateProviderSubsVisibility();
            sizeSettingsWindow();
        });
    }
    if (elements.orKeySaveBtn) {
        elements.orKeySaveBtn.addEventListener('click', async () => {
            const key = elements.orKeyInput.value.trim();
            if (!key) return;
            try {
                await window.electronAPI.saveOpenRouterKey(key);
            } catch (e) { /* ignore */ }
            elements.orKeyInput.value = '';
            // A new key should fetch immediately next cycle.
            lastOpenRouterFetch = 0;
            openRouterFetched = false;
            await refreshOpenRouterKeyStatus();
            sizeSettingsWindow();
        });
    }
    if (elements.orKeyClearBtn) {
        elements.orKeyClearBtn.addEventListener('click', async () => {
            try {
                await window.electronAPI.deleteOpenRouterKey();
            } catch (e) { /* ignore */ }
            elements.orKeyInput.value = '';
            openRouterFetched = false;
            await refreshOpenRouterKeyStatus();
        });
    }
    if (elements.orKeysLink) {
        elements.orKeysLink.addEventListener('click', (e) => {
            e.preventDefault();
            window.electronAPI.openExternal('https://openrouter.ai/keys');
        });
    }
    // Claude section error line — clicking it takes the user to the login screen
    // deliberately (the error is shown non-blockingly when other providers are on).
    if (elements.claudeError) {
        elements.claudeError.addEventListener('click', () => {
            showLoginRequired();
        });
    }
    // --- end AI Usage ---
}

// --- AI Usage: multi-provider ---
// Show/hide the per-provider sub-panels in Settings based on the toggles.
function updateProviderSubsVisibility() {
    if (elements.claudeSub) {
        elements.claudeSub.style.display = elements.providerClaudeToggle.checked ? 'flex' : 'none';
    }
    if (elements.codexSub) {
        elements.codexSub.style.display = elements.providerCodexToggle.checked ? 'flex' : 'none';
    }
    if (elements.openrouterSub) {
        elements.openrouterSub.style.display = elements.providerOpenrouterToggle.checked ? 'flex' : 'none';
    }
}

// Refresh the "Key saved ✓" presence indicator (never echoes the key).
async function refreshOpenRouterKeyStatus() {
    if (!elements.orKeyStatus) return;
    let present = false;
    try {
        const s = await window.electronAPI.getOpenRouterKeyStatus();
        present = !!(s && s.present);
    } catch (e) { present = false; }
    elements.orKeyStatus.textContent = present ? 'Key saved ✓' : 'No key';
    elements.orKeyStatus.className = 'provider-status' + (present ? ' ok' : '');
}

// Resize the window so the (possibly tall) Settings overlay fits without
// clipping. Measures the actual rendered content and clamps to a sane range;
// .settings-rows is overflow-y:auto as a safety net beyond the cap.
function sizeSettingsWindow() {
    const overlay = elements.settingsOverlay;
    if (!overlay || overlay.style.display === 'none') return;
    // Settings sizes the window out-of-band from the widget layout; reset the
    // widget + compact resize memos so the next sizing pass always re-sends.
    _lastSentHeight = -1;
    _lastCompactHeight = -1;
    const header = overlay.querySelector('.settings-header');
    const disc = overlay.querySelector('.settings-disclaimer');
    const rows = overlay.querySelector('.settings-rows');
    const footer = overlay.querySelector('.settings-footer');
    if (!header || !rows || !footer) {
        window.electronAPI.resizeWindow(318);
        return;
    }
    const needed = header.offsetHeight
        + (disc ? disc.offsetHeight : 0)
        + rows.scrollHeight
        + footer.offsetHeight
        + 4;
    const clamped = Math.min(Math.max(needed, 318), 640);
    window.electronAPI.resizeWindow(clamped);
}
// --- end AI Usage ---

// Handle manual sessionKey connect
async function handleConnect() {
    const sessionKey = elements.sessionKeyInput.value.trim();
    if (!sessionKey) {
        elements.sessionKeyError.textContent = 'Please paste your session key';
        return;
    }

    elements.connectBtn.disabled = true;
    elements.connectBtn.textContent = '...';
    elements.sessionKeyError.textContent = '';

    try {
        const result = await window.electronAPI.validateSessionKey(sessionKey);
        if (result.success) {
            credentials = { 
                sessionKey, 
                organizationId: result.organizationId,
                organizations: result.organizations || []
            };
            await window.electronAPI.saveCredentials(credentials);
            populateOrgSelector(result.organizations || [], result.organizationId);
            elements.sessionKeyInput.value = '';
            showMainContent();
            await fetchUsageData();
            startAutoUpdate();
        } else {
            elements.sessionKeyError.textContent = result.error || 'Invalid session key';
        }
    } catch (error) {
        elements.sessionKeyError.textContent = 'Connection failed. Check your key.';
    } finally {
        elements.connectBtn.disabled = false;
        elements.connectBtn.textContent = 'Connect';
    }
}

// Handle auto-detect from browser cookies
async function handleAutoDetect() {
    elements.autoDetectBtn.disabled = true;
    elements.autoDetectBtn.textContent = 'Waiting...';
    elements.autoDetectError.textContent = '';

    try {
        const result = await window.electronAPI.detectSessionKey();
        if (!result.success) {
            elements.autoDetectError.textContent = result.error || 'Login failed';
            return;
        }

        // Got sessionKey from login, now validate it
        elements.autoDetectBtn.textContent = 'Validating...';
        const validation = await window.electronAPI.validateSessionKey(result.sessionKey);

        if (validation.success) {
            credentials = {
                sessionKey: result.sessionKey,
                organizationId: validation.organizationId,
                organizations: validation.organizations || []
            };
            await window.electronAPI.saveCredentials(credentials);
            populateOrgSelector(validation.organizations || [], validation.organizationId);
            showMainContent();
            await fetchUsageData();
            startAutoUpdate();
        } else {
            elements.autoDetectError.textContent =
                'Session invalid. Try again or use Manual →';
        }
    } catch (error) {
        elements.autoDetectError.textContent = error.message || 'Login failed';
    } finally {
        elements.autoDetectBtn.disabled = false;
        elements.autoDetectBtn.textContent = 'Log in';
    }
}

// --- AI Usage: multi-provider ---
// Blank Claude's two data rows to the neutral placeholder state (mirrors the
// Codex null-row handling) so a stale percentage doesn't linger when Claude
// can't authenticate but other providers keep rendering.
function blankClaudeRows() {
    const rows = [
        { prog: elements.sessionProgress, pct: elements.sessionPercentage, timer: elements.sessionTimer, text: elements.sessionTimeText, resets: elements.sessionResetsAt },
        { prog: elements.weeklyProgress, pct: elements.weeklyPercentage, timer: elements.weeklyTimer, text: elements.weeklyTimeText, resets: elements.weeklyResetsAt }
    ];
    rows.forEach(({ prog, pct, timer, text, resets }) => {
        if (prog) { prog.style.width = '0%'; prog.classList.remove('warning', 'danger'); }
        if (pct) pct.textContent = '—';
        if (text) { text.textContent = '—'; text.style.opacity = '0.4'; }
        if (timer) { timer.style.strokeDashoffset = 63; timer.classList.remove('warning', 'danger'); }
        if (resets) { resets.textContent = '—'; resets.style.opacity = '0.4'; }
    });
}

// Degrade Claude gracefully when its credentials are missing/expired but another
// provider is enabled: keep the main content on screen, blank Claude's rows, and
// show a clickable section error that routes to the login screen on demand.
function showClaudeAuthError() {
    latestUsageData = null;
    showMainContent();
    blankClaudeRows();
    if (elements.claudeError) {
        elements.claudeError.textContent = 'Claude session expired — open Settings or restart to log in';
        elements.claudeError.style.display = 'block';
    }
}

// Fan out to every enabled provider CONCURRENTLY. Each provider call is
// independently caught so one failing never blocks the others; a single
// applyVisibility()/startCountdown() runs once all have settled. Claude only
// takes over the whole screen with the login prompt when NO other provider is
// enabled — otherwise its auth failure degrades to an inline, clickable error.
async function fetchUsageData(options = {}) {
    debugLog('fetchUsageData called', options);

    if (isFetching) {
        debugLog('Fetch already in flight — skipping');
        return;
    }

    const settings = window._cachedSettings || {};
    const { providers } = getProviderPrefs(settings);
    const isManual = !!options.manual;
    const otherProviderEnabled = !!(providers.codex || providers.openrouter);

    // Claude enabled but no usable credentials: either own the screen (Claude
    // only) or degrade inline so Codex/OpenRouter can still render.
    if (providers.claude && (!credentials.sessionKey || !credentials.organizationId)) {
        if (!otherProviderEnabled) {
            debugLog('Claude enabled, missing credentials, no other provider — showing login');
            showLoginRequired();
            return; // login screen owns the view
        }
        debugLog('Claude missing credentials but other providers enabled — degrading Claude only');
        showClaudeAuthError();
    }

    isFetching = true;
    let countdownStarted = false;
    try {
        const tasks = [];

        // --- Claude --- (only fetch when it actually has credentials)
        if (providers.claude && credentials.sessionKey && credentials.organizationId) {
            tasks.push(
                window.electronAPI.fetchUsageData(options)
                    .then((data) => {
                        debugLog('Received Claude usage data:', data);
                        if (elements.claudeError) elements.claudeError.style.display = 'none';
                        updateUI(data); // updateUI() restarts the shared countdown
                        countdownStarted = true;
                    })
                    .catch((error) => {
                        console.error('Error fetching Claude usage data:', error);
                        if (error.message && (error.message.includes('SessionExpired') || error.message.includes('Unauthorized'))) {
                            credentials = { sessionKey: null, organizationId: null };
                            if (otherProviderEnabled) {
                                showClaudeAuthError();
                            } else {
                                showLoginRequired();
                            }
                        } else {
                            debugLog('Failed to fetch Claude usage data');
                        }
                    })
            );
        } else if (!providers.claude) {
            // Claude disabled — never show the login screen; ensure the main
            // content is visible so the other providers have somewhere to render.
            latestUsageData = null;
            showMainContent();
        }

        // --- Codex ---
        if (providers.codex) {
            tasks.push(
                window.electronAPI.fetchCodexData()
                    .then((cdata) => {
                        debugLog('Received Codex data:', cdata);
                        renderCodex(cdata);
                    })
                    .catch((error) => {
                        console.error('Error fetching Codex data:', error);
                        renderCodex({ ok: false, errorKind: 'network', error: 'Could not reach Codex' });
                    })
            );
        }

        // --- OpenRouter (throttled) ---
        if (providers.openrouter) {
            const now = Date.now();
            const minGap = isManual ? 10000 : 60000;
            if (now - lastOpenRouterFetch >= minGap) {
                lastOpenRouterFetch = now;
                tasks.push(
                    window.electronAPI.fetchOpenRouterData()
                        .then((odata) => {
                            debugLog('Received OpenRouter data:', odata);
                            renderOpenRouter(odata);
                        })
                        .catch((error) => {
                            console.error('Error fetching OpenRouter data:', error);
                            renderOpenRouter({ ok: false, errorKind: 'network', error: 'Could not reach OpenRouter' });
                        })
                );
            } else {
                debugLog('OpenRouter fetch throttled');
            }
        }

        // Run the enabled provider fetches concurrently; failures stay isolated.
        await Promise.allSettled(tasks);

        // One layout pass + at most one countdown restart for the whole cycle.
        applyVisibility();
        // Refresh the compact view with every enabled provider's latest data.
        if (isCompactMode) renderCompact();
        if (!countdownStarted) startCountdown(); // updateUI() may already have
    } finally {
        isFetching = false;
    }
}
// --- end AI Usage ---


// --- AI Usage: multi-provider ---
// OpenRouter amounts arrive as plain USD numbers (not cents), so formatCurrency
// (which divides by 100) cannot be reused directly. This mirrors its output
// style — "$" + two decimals — with an em dash for missing values.
function fmtUSD(value) {
    if (value === undefined || value === null || Number.isNaN(Number(value))) return '—';
    const n = Number(value);
    const sign = n < 0 ? '-' : '';
    return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function codexFriendlyMessage(data) {
    const kind = data && data.errorKind;
    switch (kind) {
        case 'no-auth': return 'Codex login not found — log in with Codex CLI';
        case 'expired': return 'Codex token expired — run Codex CLI once';
        case 'endpoint': return 'Codex usage endpoint is unavailable';
        case 'network': return 'Could not reach Codex';
        case 'parse': return 'Unrecognized Codex usage response';
        default: return (data && data.error) || 'Codex is unavailable';
    }
}

// Populate a single Codex row (mirrors Claude's row population). `obj` is
// { utilization, resets_at } or null. Reuses updateProgressBar/updateTimer so
// the warn/danger thresholds and countdown behave identically to Claude.
function applyCodexRow(progEl, pctEl, timerEl, timeTextEl, resetsEl, obj, totalMinutes, isWeekly) {
    const settings = window._cachedSettings || {};
    const timeFormat = settings.timeFormat || '12h';
    const weeklyDateFormat = settings.weeklyDateFormat || 'date';

    if (!obj || obj.utilization === undefined || obj.utilization === null) {
        progEl.style.width = '0%';
        progEl.classList.remove('warning', 'danger');
        pctEl.textContent = '—';
        timeTextEl.textContent = '—';
        timeTextEl.style.opacity = '0.4';
        timerEl.style.strokeDashoffset = 63;
        timerEl.classList.remove('warning', 'danger');
        timeTextEl.dataset.resets = '';
        resetsEl.textContent = '—';
        resetsEl.style.opacity = '0.4';
        return;
    }

    updateProgressBar(progEl, pctEl, obj.utilization, isWeekly);
    updateTimer(timerEl, timeTextEl, obj.resets_at, totalMinutes);
    // Stash reset info so refreshCodexTimers() can tick the countdown live.
    timeTextEl.dataset.resets = obj.resets_at || '';
    timeTextEl.dataset.total = totalMinutes;
    resetsEl.textContent = formatResetsAt(obj.resets_at, isWeekly, timeFormat, weeklyDateFormat);
    resetsEl.style.opacity = obj.resets_at ? '1' : '0.4';
}

function renderCodex(data) {
    latestCodexData = data;
    updateCodexStatusLine();

    if (!data || !data.ok) {
        elements.codexError.textContent = codexFriendlyMessage(data);
        elements.codexError.style.display = 'block';
        applyCodexRow(elements.codexSessionProgress, elements.codexSessionPercentage,
            elements.codexSessionTimer, elements.codexSessionTimeText, elements.codexSessionResetsAt,
            null, 5 * 60, false);
        applyCodexRow(elements.codexWeeklyProgress, elements.codexWeeklyPercentage,
            elements.codexWeeklyTimer, elements.codexWeeklyTimeText, elements.codexWeeklyResetsAt,
            null, 7 * 24 * 60, true);
        return;
    }

    elements.codexError.style.display = 'none';
    applyCodexRow(elements.codexSessionProgress, elements.codexSessionPercentage,
        elements.codexSessionTimer, elements.codexSessionTimeText, elements.codexSessionResetsAt,
        data.five_hour, 5 * 60, false);
    applyCodexRow(elements.codexWeeklyProgress, elements.codexWeeklyPercentage,
        elements.codexWeeklyTimer, elements.codexWeeklyTimeText, elements.codexWeeklyResetsAt,
        data.seven_day, 7 * 24 * 60, true);
}

// Live-tick the Codex reset countdowns from the shared 30s interval.
function refreshCodexTimers() {
    if (!latestCodexData || !latestCodexData.ok) return;
    const rows = [
        { text: elements.codexSessionTimeText, circle: elements.codexSessionTimer },
        { text: elements.codexWeeklyTimeText, circle: elements.codexWeeklyTimer }
    ];
    rows.forEach(({ text, circle }) => {
        const resetsAt = text.dataset.resets;
        const totalMinutes = parseInt(text.dataset.total);
        if (resetsAt && circle && totalMinutes) {
            updateTimer(circle, text, resetsAt, totalMinutes);
        }
    });
}

function openRouterFriendlyMessage(data) {
    const kind = data && data.errorKind;
    switch (kind) {
        case 'no-key': return 'No API key configured — add one in Settings';
        case 'auth': return 'OpenRouter rejected the API key — check Settings';
        case 'network': return 'Could not reach OpenRouter';
        case 'http': return 'OpenRouter returned an error';
        case 'parse': return 'Unrecognized OpenRouter response';
        default: return (data && data.error) || 'OpenRouter is unavailable';
    }
}

function renderOpenRouter(data) {
    openRouterFetched = true;
    latestOpenRouterData = data; // --- AI Usage: multi-provider --- keep for compact render

    if (!data || !data.ok) {
        elements.openrouterError.textContent = openRouterFriendlyMessage(data);
        elements.openrouterError.style.display = 'block';
        elements.orWarn.style.display = 'none';
        elements.orTodayVal.textContent = '—';
        elements.orWeekVal.textContent = '—';
        elements.orMonthVal.textContent = '—';
        elements.orCreditsVal.textContent = '—';
        elements.orCreditsTotal.textContent = '';
        return;
    }

    elements.openrouterError.style.display = 'none';
    const spend = data.spend || {};
    elements.orTodayVal.textContent = fmtUSD(spend.today);
    elements.orWeekVal.textContent = fmtUSD(spend.week);
    elements.orMonthVal.textContent = fmtUSD(spend.month);

    const credits = data.credits || {};
    elements.orCreditsVal.textContent = fmtUSD(credits.remaining);
    elements.orCreditsTotal.textContent = (credits.total !== undefined && credits.total !== null)
        ? `of ${fmtUSD(credits.total)}`
        : '';

    // Subtle warning indicator — data still shown.
    if (data.warning) {
        elements.orWarn.style.display = 'inline';
        elements.orWarn.title = data.warning;
    } else {
        elements.orWarn.style.display = 'none';
    }
}

// Compute the collapsed (pre-expand/graph/banner) window height from the
// enabled providers and their visible rows. Anchored to WIDGET_HEIGHT_COLLAPSED
// (155) for the default Claude case so that look is preserved pixel-for-pixel.
function computeCollapsedHeight() {
    const settings = window._cachedSettings || {};
    const { providers: P, visibleRows } = getProviderPrefs(settings);
    const vc = visibleRows.claude;
    const vx = visibleRows.codex;
    const vo = visibleRows.openrouter;

    let h;
    if (P.claude) {
        // 155 == chrome + Claude headers + both Claude rows + expand toggle.
        h = WIDGET_HEIGHT_COLLAPSED;
        if (!vc.session) h -= CLAUDE_ROW_HEIGHT;
        if (!vc.weekly) h -= CLAUDE_ROW_HEIGHT;
        // --- AI Usage: multi-provider --- the 155 anchor covers only session+weekly;
        // the pinned Fable row is additive when its data is present and it's enabled.
        if (computeFablePinnedVisible()) h += CLAUDE_ROW_HEIGHT;
    } else {
        // No Claude section and no expand toggle — build up from bare chrome.
        h = CONTENT_CHROME;
    }

    if (P.codex) {
        h += SECTION_HEADER_HEIGHT;
        if (vx.session) h += WIDGET_ROW_HEIGHT;
        if (vx.weekly) h += WIDGET_ROW_HEIGHT;
    }

    if (P.openrouter) {
        h += SECTION_HEADER_HEIGHT;
        if (vo.today) h += WIDGET_ROW_HEIGHT;
        if (vo.week) h += WIDGET_ROW_HEIGHT;
        if (vo.month) h += WIDGET_ROW_HEIGHT;
        if (vo.credits) h += WIDGET_ROW_HEIGHT;
    }

    if (!P.claude && !P.codex && !P.openrouter) {
        h = CONTENT_CHROME + PLACEHOLDER_HEIGHT;
    }

    // Budget for any visible provider-error line. Messages can wrap, so measure
    // the actual rendered height at compute time; hidden elements report 0.
    const errorEls = [elements.claudeError, elements.codexError, elements.openrouterError];
    for (const el of errorEls) {
        if (el && el.offsetHeight) h += el.offsetHeight;
    }

    return h;
}

// Apply provider/row visibility from current settings, then resize the window.
function applyVisibility() {
    const settings = window._cachedSettings || {};
    const { providers: P, visibleRows } = getProviderPrefs(settings);
    const vc = visibleRows.claude;
    const vx = visibleRows.codex;
    const vo = visibleRows.openrouter;

    // Claude
    if (elements.claudeSection) elements.claudeSection.style.display = P.claude ? 'block' : 'none';
    if (claudeSessionRow) claudeSessionRow.style.display = (P.claude && vc.session) ? '' : 'none';
    if (claudeWeeklyRow) claudeWeeklyRow.style.display = (P.claude && vc.weekly) ? '' : 'none';
    // --- AI Usage: multi-provider --- pinned Fable row: gated on data + checkbox so
    // it is never force-shown before the first Claude fetch delivers scoped data.
    fablePinnedVisible = computeFablePinnedVisible();
    if (elements.claudeFableRow) elements.claudeFableRow.style.display = fablePinnedVisible ? '' : 'none';

    // Codex
    if (elements.codexSection) elements.codexSection.style.display = P.codex ? 'block' : 'none';
    if (elements.codexSessionRow) elements.codexSessionRow.style.display = (P.codex && vx.session) ? '' : 'none';
    if (elements.codexWeeklyRow) elements.codexWeeklyRow.style.display = (P.codex && vx.weekly) ? '' : 'none';

    // OpenRouter
    if (elements.openrouterSection) elements.openrouterSection.style.display = P.openrouter ? 'block' : 'none';
    if (elements.orRowToday) elements.orRowToday.style.display = (P.openrouter && vo.today) ? '' : 'none';
    if (elements.orRowWeek) elements.orRowWeek.style.display = (P.openrouter && vo.week) ? '' : 'none';
    if (elements.orRowMonth) elements.orRowMonth.style.display = (P.openrouter && vo.month) ? '' : 'none';
    if (elements.orRowCredits) elements.orRowCredits.style.display = (P.openrouter && vo.credits) ? '' : 'none';

    // All providers disabled → placeholder
    const allOff = !P.claude && !P.codex && !P.openrouter;
    if (elements.allHiddenPlaceholder) elements.allHiddenPlaceholder.style.display = allOff ? 'block' : 'none';

    // Compact mode is multi-provider now — show its chevron whenever ANY provider
    // is enabled; hide it only when every provider is off.
    const anyProviderEnabled = P.claude || P.codex || P.openrouter;
    if (elements.compactCollapseBtn && !isCompactMode) {
        elements.compactCollapseBtn.style.display = anyProviderEnabled ? 'flex' : 'none';
    }
    // The expand toggle relates to Claude's extended data. Hide it when Claude
    // is off; when Claude is on, restore it based on whether extra rows exist
    // (mirroring buildExtraRows' rule) so re-enabling Claude brings it back.
    if (elements.expandToggle) {
        elements.expandToggle.style.display = P.claude
            ? (elements.extraRows.children.length > 0 ? 'flex' : 'none')
            : 'none';
    }

    if (!isCompactMode) resizeWidget();
}

// Refresh the Codex status line in Settings from the auth-presence probe and
// the most recent fetch result.
function updateCodexStatusLine() {
    const el = elements.codexStatusLine;
    if (!el) return;
    const d = latestCodexData;
    let text;
    let cls = '';
    if (d && d.ok) {
        text = 'Auto-detected ✓';
        cls = 'ok';
    } else if (d && d.errorKind === 'no-auth') {
        text = 'Not found — log in with Codex CLI';
        cls = 'err';
    } else if (d && d.errorKind === 'expired') {
        text = 'Token expired — run Codex CLI once';
        cls = 'err';
    } else if (d && !d.ok) {
        text = codexFriendlyMessage(d);
        cls = 'err';
    } else {
        // No fetch yet — fall back to on-disk auth presence.
        text = codexAuthPresent ? 'Auto-detected ✓' : 'Not found — log in with Codex CLI';
        cls = codexAuthPresent ? 'ok' : 'err';
    }
    el.textContent = text;
    el.className = 'provider-status' + (cls ? ' ' + cls : '');
}
// --- end AI Usage ---

// Update UI with usage data
// Format a cent-based amount with the correct currency symbol.
// Known unambiguous symbols are used; everything else falls back to the
// ISO 4217 code as a suffix so the display is always correct.
function formatCurrency(amountCents, currencyCode) {
  const amount = (amountCents / 100).toFixed(2);
  const symbols = { USD: '$', EUR: '€', GBP: '£' };
  const sym = symbols[currencyCode];
  return sym ? `${sym}${amount}` : `${amount} ${currencyCode || 'USD'}`;
}

// Extra row label mapping for API fields
const EXTRA_ROW_CONFIG = {
    seven_day_sonnet: { label: 'Sonnet (7d)', color: 'sonnet' },
    seven_day_opus: { label: 'Opus (7d)', color: 'opus' },
    seven_day_cowork: { label: 'Cowork (7d)', color: 'cowork' },
    seven_day_omelette: { label: 'Design (7d)', color: 'design' },
    seven_day_oauth_apps: { label: 'OAuth Apps (7d)', color: 'oauth' },
    extra_usage: { label: 'Extra Usage', color: 'extra' },
};

function buildExtraRows(data) {
    // Don't clear existing rows if we don't have new data to replace them with
    // This preserves the last known state when expanding the panel
    const hasAnyExtendedData = Object.entries(EXTRA_ROW_CONFIG).some(([key, config]) => {
        const value = data[key];
        const hasUtilization = value && value.utilization !== undefined;
        const hasBalance = key === 'extra_usage' && value && value.balance_cents != null;
        return hasUtilization || hasBalance;
    });
    
    // Only rebuild if we have data, otherwise keep existing rows
    if (!hasAnyExtendedData && elements.extraRows.children.length > 0) {
        return; // Keep existing rows
    }
    
    elements.extraRows.innerHTML = '';
    let count = 0;

    for (const [key, config] of Object.entries(EXTRA_ROW_CONFIG)) {
        // --- AI Usage: multi-provider --- the pinned Fable row owns this key; skip
        // it here so it never renders in both the pinned row and the expand panel.
        if (fablePinnedVisible && key === pinnedFableKey) continue;
        const value = data[key];
        // extra_usage is valid with utilization OR balance_cents (prepaid only)
        const hasUtilization = value && value.utilization !== undefined;
        const hasBalance = key === 'extra_usage' && value && value.balance_cents != null;
        if (!hasUtilization && !hasBalance) continue;

        const utilization = value.utilization || 0;
        const resetsAt = value.resets_at;
        const colorClass = config.color;

        const row = document.createElement('div');
        row.className = 'usage-section';

        // Build row using DOM methods (no innerHTML)
        const label = document.createElement('span');
        label.className = 'usage-label';
        
        if (key === 'extra_usage') {
            // Extra usage: ON/OFF indicator goes next to label
            if (value.is_enabled === true) {
                const statusTag = document.createElement('span');
                statusTag.className = 'extra-status on';
                statusTag.textContent = 'ON';
                label.appendChild(statusTag);
            } else if (value.is_enabled === false) {
                const statusTag = document.createElement('span');
                statusTag.className = 'extra-status off';
                statusTag.textContent = 'OFF';
                label.appendChild(statusTag);
            }
            label.appendChild(document.createTextNode(' Extra Usage'));
        } else {
            label.textContent = config.label;
        }
        row.appendChild(label);

        if (key === 'extra_usage') {
            // Extra usage: bar col shows $used/$limit, elapsed col empty, timer col shows account credits
            const barGroup = document.createElement('div');
            barGroup.className = 'usage-bar-group';
            const progressBar = document.createElement('div');
            progressBar.className = 'progress-bar';
            const progressFill = document.createElement('div');
            progressFill.className = `progress-fill ${colorClass}`;
            progressFill.style.width = `${Math.min(utilization, 100)}%`;
            
            // Apply warning/danger thresholds to extra usage bar
            if (utilization >= dangerThreshold) {
                progressFill.classList.add('danger');
            } else if (utilization >= warnThreshold) {
                progressFill.classList.add('warning');
            }
            
            progressBar.appendChild(progressFill);
            barGroup.appendChild(progressBar);

            const percentage = document.createElement('span');
            if (value.used_cents != null && value.limit_cents != null) {
                percentage.className = 'usage-percentage extra-spending';
                percentage.textContent = `${formatCurrency(value.used_cents, value.currency)}/${formatCurrency(value.limit_cents, value.currency)}`;
            } else {
                percentage.className = 'usage-percentage';
                percentage.textContent = `${Math.round(utilization)}%`;
            }
            barGroup.appendChild(percentage);
            row.appendChild(barGroup);

            const elapsedGroup = document.createElement('div');
            elapsedGroup.className = 'usage-elapsed-group';
            row.appendChild(elapsedGroup);

            const timerText = document.createElement('span');
            timerText.className = 'timer-text extra-balance-label';
            timerText.textContent = 'Account Credits:';
            row.appendChild(timerText);

            const resetsText = document.createElement('span');
            resetsText.className = 'resets-at-text extra-balance-amount';
            if (value.balance_cents != null) {
                resetsText.textContent = formatCurrency(value.balance_cents, value.currency);
            }
            row.appendChild(resetsText);
        } else {
            const totalMinutes = key.includes('seven_day') ? 7 * 24 * 60 : 5 * 60;

            const barGroup = document.createElement('div');
            barGroup.className = 'usage-bar-group';
            const progressBar = document.createElement('div');
            progressBar.className = 'progress-bar';
            const progressFill = document.createElement('div');
            progressFill.className = `progress-fill ${colorClass}`;
            progressFill.style.width = `${Math.min(utilization, 100)}%`;
            progressBar.appendChild(progressFill);
            barGroup.appendChild(progressBar);

            const percentage = document.createElement('span');
            percentage.className = 'usage-percentage';
            percentage.textContent = `${Math.round(utilization)}%`;
            barGroup.appendChild(percentage);
            row.appendChild(barGroup);

            const elapsedGroup = document.createElement('div');
            elapsedGroup.className = 'usage-elapsed-group';
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('class', 'mini-timer');
            svg.setAttribute('width', '24');
            svg.setAttribute('height', '24');
            svg.setAttribute('viewBox', '0 0 24 24');
            const circleBg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circleBg.setAttribute('class', 'timer-bg');
            circleBg.setAttribute('cx', '12');
            circleBg.setAttribute('cy', '12');
            circleBg.setAttribute('r', '10');
            svg.appendChild(circleBg);
            const circleProgress = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circleProgress.setAttribute('class', `timer-progress ${colorClass}`);
            circleProgress.setAttribute('cx', '12');
            circleProgress.setAttribute('cy', '12');
            circleProgress.setAttribute('r', '10');
            circleProgress.style.strokeDasharray = '63';
            circleProgress.style.strokeDashoffset = '63';
            svg.appendChild(circleProgress);
            elapsedGroup.appendChild(svg);
            row.appendChild(elapsedGroup);

            const timerText = document.createElement('div');
            timerText.className = 'timer-text';
            timerText.dataset.resets = resetsAt || '';
            timerText.dataset.total = totalMinutes;
            timerText.textContent = '--:--';
            row.appendChild(timerText);

            const resetsText = document.createElement('span');
            resetsText.className = 'resets-at-text';
            if (resetsAt) {
                const settings = window._cachedSettings || {};
                resetsText.textContent = formatResetsAt(resetsAt, true, settings.timeFormat || '12h', settings.weeklyDateFormat || 'date');
            }
            row.appendChild(resetsText);
        }

        elements.extraRows.appendChild(row);
        count++;
    }

    // Hide toggle if no extra rows
    elements.expandToggle.style.display = count > 0 ? 'flex' : 'none';
    if (count === 0 && isExpanded) {
        isExpanded = false;
        elements.expandArrow.classList.remove('expanded');
        elements.expandSection.style.display = 'none';
    }

    return count;
}

function refreshExtraTimers() {
    // Pair each row's timer text with its own circle. Pairing the two
    // querySelectorAll lists by index breaks as soon as one row has a text
    // but no circle (the extra_usage row), leaving every later row's timer
    // stuck at --:--.
    elements.extraRows.querySelectorAll('.usage-section').forEach((row) => {
        const textEl = row.querySelector('.timer-text');
        const circleEl = row.querySelector('.timer-progress');
        if (!textEl || !circleEl) return;
        const resetsAt = textEl.dataset.resets;
        const totalMinutes = parseInt(textEl.dataset.total);
        if (resetsAt) {
            updateTimer(circleEl, textEl, resetsAt, totalMinutes);
        }
    });
}

const BANNER_HEIGHT = 28;
const EXPAND_OVERHEAD = 28; // margin-top(12) + padding-top(6) + bottom buffer(10)

function resizeWidget(bannerVisible) {
    const hasBanner = bannerVisible !== undefined
        ? bannerVisible
        : elements.updateBanner.style.display !== 'none';
    const bannerOffset = hasBanner ? BANNER_HEIGHT : 0;
    const extraCount = elements.extraRows.children.length;
    const expandedOffset = isExpanded && extraCount > 0
        ? EXPAND_OVERHEAD + (extraCount * WIDGET_ROW_HEIGHT)
        : 0;
    // --- AI Usage: multi-provider --- add chip-row wrap overflow when present
    const graphOffset = graphVisible ? GRAPH_HEIGHT + _graphChipsExtra : 0;
    // --- AI Usage: multi-provider --- base height now depends on enabled providers/rows
    const baseHeight = computeCollapsedHeight();
    const totalHeight = baseHeight + expandedOffset + graphOffset + bannerOffset;
    // Skip the IPC round-trip when the height hasn't actually changed — collapses
    // the redundant resizes that fire per fetch/settings/visibility cycle.
    if (totalHeight === _lastSentHeight) return;
    _lastSentHeight = totalHeight;
    // --- end AI Usage ---
    window.electronAPI.resizeWindow(totalHeight);
}

function normalizeUsageData(data) {
    // claude.ai now reports per-model weekly limits (e.g. Fable) as entries in
    // the `limits` array with kind "weekly_scoped"; the legacy seven_day_<model>
    // fields arrive null for those models. Map each scoped weekly limit onto a
    // synthetic seven_day_* field so it renders like any other extra row.
    for (const limit of (data.limits || [])) {
        if (limit.kind !== 'weekly_scoped' || limit.percent == null) continue;
        const scopeName = limit.scope?.model?.display_name || limit.scope?.surface || 'Scoped';
        const key = 'seven_day_scoped_' + scopeName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
        if (!EXTRA_ROW_CONFIG[key]) {
            EXTRA_ROW_CONFIG[key] = { label: `${scopeName} (7d)`, color: 'opus' };
            // Re-insert extra_usage so model rows stay grouped above it
            const extraUsage = EXTRA_ROW_CONFIG.extra_usage;
            delete EXTRA_ROW_CONFIG.extra_usage;
            EXTRA_ROW_CONFIG.extra_usage = extraUsage;
        }
        data[key] = { utilization: limit.percent, resets_at: limit.resets_at };
    }
    return data;
}

// --- AI Usage: multi-provider ---
// Find the first registered scoped weekly key (seven_day_scoped_<slug>) whose
// slug matches PINNED_SCOPED_PATTERN and that actually has utilization data.
function findPinnedFableKey(data) {
    const prefix = 'seven_day_scoped_';
    for (const key of Object.keys(EXTRA_ROW_CONFIG)) {
        if (!key.startsWith(prefix)) continue;
        const slug = key.slice(prefix.length);
        if (!PINNED_SCOPED_PATTERN.test(slug)) continue;
        if (data && data[key] && data[key].utilization !== undefined) return key;
    }
    return null;
}

// Combined gate for the pinned Fable row: Claude enabled AND its row checkbox on
// AND scoped Fable data actually arrived. Kept as a function so both the height
// arithmetic and the visibility pass read the same live condition.
function computeFablePinnedVisible() {
    const settings = window._cachedSettings || {};
    const { providers: P, visibleRows } = getProviderPrefs(settings);
    return !!(P.claude && (visibleRows.claude.fable !== false) && fableDataPresent);
}

// Populate the pinned Fable row from the scoped weekly limit using the SAME
// helpers as the Session/Weekly rows (7-day window = 7*24*60 minutes). Also sets
// the module flags that buildExtraRows / computeCollapsedHeight / applyVisibility
// read so the row never renders twice and the height stays exact.
function updatePinnedFableRow(data) {
    const settings = window._cachedSettings || {};
    const timeFormat = settings.timeFormat || '12h';
    const weeklyDateFormat = settings.weeklyDateFormat || 'date';

    const key = findPinnedFableKey(data);
    pinnedFableKey = key;
    fableDataPresent = !!key;

    if (key && elements.claudeFableProgress) {
        const value = data[key];
        const totalMinutes = 7 * 24 * 60;
        updateProgressBar(elements.claudeFableProgress, elements.claudeFablePercentage, value.utilization || 0, true);
        updateTimer(elements.claudeFableTimer, elements.claudeFableTimeText, value.resets_at, totalMinutes);
        elements.claudeFableTimeText.dataset.resets = value.resets_at || '';
        elements.claudeFableTimeText.dataset.total = totalMinutes;
        elements.claudeFableResetsAt.textContent = formatResetsAt(value.resets_at, true, timeFormat, weeklyDateFormat);
        elements.claudeFableResetsAt.style.opacity = value.resets_at ? '1' : '0.4';
    }

    fablePinnedVisible = computeFablePinnedVisible();
    if (elements.claudeFableRow) elements.claudeFableRow.style.display = fablePinnedVisible ? '' : 'none';
}

// Live-tick the pinned Fable countdown from the shared 30s interval.
function refreshFableTimer() {
    if (!fablePinnedVisible) return;
    const textEl = elements.claudeFableTimeText;
    const circleEl = elements.claudeFableTimer;
    if (!textEl || !circleEl) return;
    const resetsAt = textEl.dataset.resets;
    const totalMinutes = parseInt(textEl.dataset.total);
    if (resetsAt && totalMinutes) updateTimer(circleEl, textEl, resetsAt, totalMinutes);
}
// --- end AI Usage ---

function updateUI(data) {
    latestUsageData = normalizeUsageData(data);

    showMainContent();
    updatePinnedFableRow(data); // --- AI Usage: multi-provider --- must precede buildExtraRows/resizeWidget
    buildExtraRows(data);
    refreshTimers();
    if (isExpanded) refreshExtraTimers();
    if (!isCompactMode) resizeWidget();
    startCountdown();
    if (graphVisible) {
        loadChart();
    }

    // Update compact view in parallel if compact mode is active
    // --- AI Usage: multi-provider --- renderCompact() pulls all provider state
    if (isCompactMode) renderCompact();

    // On first load, seed alert flags so we don't fire for thresholds
    // the user can already see when the app starts
    if (isFirstDataLoad) {
        isFirstDataLoad = false;
        seedAlertFlags(data);
    }

    checkUsageAlerts(data);
}

// Fire OS desktop notifications when usage crosses warn/danger thresholds.
// Only fires once per threshold crossing per session window — not on every refresh.
function checkUsageAlerts(data) {
    const settings = window._cachedSettings || {};
    if (!settings.usageAlerts) return;

    const sessionPct = data.five_hour?.utilization || 0;
    const weeklyPct = data.seven_day?.utilization || 0;

    // Reset alert flags when a session window resets (utilization drops back low)
    if (sessionPct < warnThreshold) {
        alertFired.session_warn = false;
        alertFired.session_danger = false;
    }
    if (weeklyPct < warnThreshold) {
        alertFired.weekly_warn = false;
        alertFired.weekly_danger = false;
    }

    // Current Session — danger threshold (check first, higher priority)
    if (sessionPct >= dangerThreshold && !alertFired.session_danger) {
        alertFired.session_danger = true;
        alertFired.session_warn = true; // suppress warn if we jumped straight to danger
        window.electronAPI.showNotification(
            'BurnRate — Claude',
            `Current Session usage is at ${Math.round(sessionPct)}% — running low`
        );
    // Current Session — warn threshold
    } else if (sessionPct >= warnThreshold && !alertFired.session_warn) {
        alertFired.session_warn = true;
        window.electronAPI.showNotification(
            'BurnRate — Claude',
            `Current Session usage has reached ${Math.round(sessionPct)}%`
        );
    }

    // Weekly Limit — danger threshold
    if (weeklyPct >= dangerThreshold && !alertFired.weekly_danger) {
        alertFired.weekly_danger = true;
        alertFired.weekly_warn = true;
        window.electronAPI.showNotification(
            'BurnRate — Claude',
            `Weekly Limit usage is at ${Math.round(weeklyPct)}% — running low`
        );
    // Weekly Limit — warn threshold
    } else if (weeklyPct >= warnThreshold && !alertFired.weekly_warn) {
        alertFired.weekly_warn = true;
        window.electronAPI.showNotification(
            'BurnRate — Claude',
            `Weekly Limit usage has reached ${Math.round(weeklyPct)}%`
        );
    }

    // --- AI Usage: multi-provider --- per-model alerts for every extra/scoped row
    // (Sonnet, Opus, Fable, …). Same warn/danger thresholds and the same
    // notification cooldown, but deduped per row key so each model tracks its own
    // crossing. Gated by the shared usageAlerts setting — no separate toggle.
    for (const key of Object.keys(EXTRA_ROW_CONFIG)) {
        if (key === 'extra_usage') continue;
        const entry = data[key];
        if (!entry || entry.utilization === undefined) continue;
        const pct = entry.utilization || 0;
        const label = EXTRA_ROW_CONFIG[key].label;
        const state = extraAlertFired[key] || (extraAlertFired[key] = { warn: false, danger: false });

        // Reset this row's flags when its window resets (utilization drops low).
        if (pct < warnThreshold) {
            state.warn = false;
            state.danger = false;
        }

        if (pct >= dangerThreshold && !state.danger) {
            state.danger = true;
            state.warn = true; // suppress warn if we jumped straight to danger
            window.electronAPI.showNotification(
                `BurnRate — Claude · ${label}`,
                `${label} usage is at ${Math.round(pct)}% — running low`
            );
        } else if (pct >= warnThreshold && !state.warn) {
            state.warn = true;
            window.electronAPI.showNotification(
                `BurnRate — Claude · ${label}`,
                `${label} usage has reached ${Math.round(pct)}%`
            );
        }
    }
    // --- end AI Usage ---
}

// Apply or remove compact mode — switches view, resizes window, syncs all toggles
function applyCompactMode(compact) {
    isCompactMode = compact;
    // --- AI Usage: multi-provider --- compact toggling resizes the window out-of-band
    // (set-compact-mode); reset both memos so the follow-up sizing pass re-sends.
    _lastSentHeight = -1;
    _lastCompactHeight = -1;

    // Add/remove compact-mode class from body for CSS styling
    if (compact) {
        document.body.classList.add('compact-mode');
    } else {
        document.body.classList.remove('compact-mode');
    }

    // Show/hide the correct content view
    elements.mainContent.style.display = compact ? 'none' : 'block';
    elements.compactContent.style.display = compact ? 'flex' : 'none';

    // Collapse extra rows when entering compact — prevents stale isExpanded state
    if (compact && isExpanded) {
        isExpanded = false;
        elements.expandArrow.classList.remove('expanded');
        elements.expandSection.style.display = 'none';
    }

    if (compact && graphVisible) {
        graphWasVisible = true;
        graphVisible = false;
        elements.graphBtn.classList.remove('active');
        elements.graphSection.style.display = 'none';
    } else if (!compact && graphWasVisible) {
        graphWasVisible = false;
        graphVisible = true;
        elements.graphBtn.classList.add('active');
        elements.graphSection.style.display = 'block';
        loadChart();
    }

    // Show/hide the collapse chevron (only visible in normal mode with data)
    if (elements.compactCollapseBtn) {
        elements.compactCollapseBtn.style.display = compact ? 'none' : 'flex';
    }

    // Keep refresh button visible in compact mode so users can see when data updates
    // Hide graph button in compact mode (not applicable)
    if (elements.graphBtn) {
        elements.graphBtn.style.display = compact ? 'none' : '';
    }

    // Tell main process to resize the window. In compact mode renderCompact()
    // computes the dynamic height and issues the resize; in normal mode we just
    // restore the widget dimensions here.
    if (!compact) window.electronAPI.setCompactMode(false);

    // Sync both settings toggles
    if (elements.compactModeToggle) elements.compactModeToggle.checked = compact;
    if (elements.compactModeToggleCompact) elements.compactModeToggleCompact.checked = compact;

    // Build + size the compact view (works even with no data yet — shows "—").
    if (compact) renderCompact();
    if (!compact) resizeWidget();

    // Persist graph/expanded state changes caused by compact mode toggle
    _saveViewState();
}

// --- AI Usage: multi-provider ---
// Build one utilization bar row (label + filled bar + centred readout) into a
// provider block. `util` is a 0-100 number or null/undefined for "no data yet".
// `weekly` selects the blue weekly gradient; thresholds match the normal view.
// `variant` (optional) overrides the base color class (e.g. 'fable' teal); when
// omitted the weekly/session default is used so existing callers are unchanged.
function appendCompactBarRow(block, label, util, weekly, variant) {
    const row = document.createElement('div');
    row.className = 'compact-row';

    const lbl = document.createElement('span');
    lbl.className = 'compact-label';
    lbl.textContent = label;
    row.appendChild(lbl);

    const wrap = document.createElement('div');
    wrap.className = 'compact-bar-wrap';
    const bg = document.createElement('div');
    bg.className = 'compact-bar-bg';

    const fill = document.createElement('div');
    const baseVariant = variant || (weekly ? 'weekly' : '');
    fill.className = 'compact-bar-fill' + (baseVariant ? ' ' + baseVariant : '');
    const pct = document.createElement('span');
    pct.className = 'compact-pct';

    const hasData = util !== undefined && util !== null && !Number.isNaN(Number(util));
    if (hasData) {
        const p = Math.min(Math.max(Number(util), 0), 100);
        fill.style.width = `${p}%`;
        pct.textContent = `${Math.round(p)}%`;
        if (p >= dangerThreshold) fill.classList.add('danger');
        else if (p >= warnThreshold) fill.classList.add('warning');
    } else {
        fill.style.width = '0%';
        pct.textContent = '—';
    }

    bg.appendChild(fill);
    bg.appendChild(pct);
    wrap.appendChild(bg);
    row.appendChild(wrap);
    block.appendChild(row);
}

// Build a two-bar provider block (Claude / Codex). `session`/`weekly` are the
// { utilization, resets_at } objects (or null). Returns the block element.
function buildCompactTwoBarBlock(labelText, showLabel, session, weekly) {
    const block = document.createElement('div');
    block.className = 'compact-block';
    if (showLabel) {
        const heading = document.createElement('div');
        heading.className = 'compact-provider-label';
        heading.textContent = labelText;
        block.appendChild(heading);
    }
    appendCompactBarRow(block, 'Session', session ? session.utilization : null, false);
    appendCompactBarRow(block, 'Weekly', weekly ? weekly.utilization : null, true);
    return block;
}

// Build the single-line OpenRouter block: a subtle "credits remaining" bar
// (fill = remaining/total when total is known) with the dollar amount overlaid.
function buildCompactOpenRouterBlock(showLabel) {
    const block = document.createElement('div');
    block.className = 'compact-block';
    if (showLabel) {
        const heading = document.createElement('div');
        heading.className = 'compact-provider-label';
        heading.textContent = 'OPENROUTER';
        block.appendChild(heading);
    }

    const row = document.createElement('div');
    row.className = 'compact-row';
    const lbl = document.createElement('span');
    lbl.className = 'compact-label';
    lbl.textContent = 'Credits';
    row.appendChild(lbl);

    const wrap = document.createElement('div');
    wrap.className = 'compact-bar-wrap';
    const bg = document.createElement('div');
    bg.className = 'compact-bar-bg';
    const fill = document.createElement('div');
    fill.className = 'compact-bar-fill or';
    const pct = document.createElement('span');
    pct.className = 'compact-pct';

    const d = latestOpenRouterData;
    const credits = (d && d.ok && d.credits) ? d.credits : null;
    const remaining = credits ? credits.remaining : null;
    const total = credits ? credits.total : null;
    if (remaining !== undefined && remaining !== null && !Number.isNaN(Number(remaining))) {
        pct.textContent = fmtUSD(remaining);
        if (total && Number(total) > 0) {
            const p = Math.min(Math.max((Number(remaining) / Number(total)) * 100, 0), 100);
            fill.style.width = `${p}%`;
        } else {
            fill.style.width = '0%';
        }
    } else {
        pct.textContent = '—';
        fill.style.width = '0%';
    }

    bg.appendChild(fill);
    bg.appendChild(pct);
    wrap.appendChild(bg);
    row.appendChild(wrap);
    block.appendChild(row);
    return block;
}

// Render the compact view for every enabled provider, then resize the compact
// window to fit. Reads module state (latestUsageData / latestCodexData /
// latestOpenRouterData) so it can be called from any fetch/toggle path.
function renderCompact() {
    if (!isCompactMode || !elements.compactRows) return;

    const settings = window._cachedSettings || {};
    const { providers: P } = getProviderPrefs(settings);

    // Ordered list of enabled providers; the heading is shown only when more than
    // one is enabled (a lone provider keeps the original label-free minimal look).
    const enabled = [];
    if (P.claude) enabled.push('claude');
    if (P.codex) enabled.push('codex');
    if (P.openrouter) enabled.push('openrouter');
    const showLabels = enabled.length > 1;

    elements.compactRows.innerHTML = '';
    let height = COMPACT_BASE;
    enabled.forEach((provider, i) => {
        if (i > 0) height += COMPACT_BLOCK_GAP;
        if (provider === 'openrouter') {
            elements.compactRows.appendChild(buildCompactOpenRouterBlock(showLabels));
            height += COMPACT_OR_LINE;
        } else if (provider === 'codex') {
            const c = latestCodexData && latestCodexData.ok ? latestCodexData : null;
            elements.compactRows.appendChild(
                buildCompactTwoBarBlock('CODEX', showLabels, c && c.five_hour, c && c.seven_day)
            );
            height += COMPACT_TWO_BAR;
        } else {
            const u = latestUsageData;
            const block = buildCompactTwoBarBlock('CLAUDE', showLabels, u && u.five_hour, u && u.seven_day);
            height += COMPACT_TWO_BAR;
            // --- AI Usage: multi-provider --- pinned Fable bar (teal) under Session/Weekly,
            // gated identically to the pinned row; adds one bar row worth of height.
            if (computeFablePinnedVisible()) {
                const fableObj = (u && pinnedFableKey) ? u[pinnedFableKey] : null;
                appendCompactBarRow(block, 'Fable', fableObj ? fableObj.utilization : null, false, 'fable');
                height += COMPACT_BAR_ROW;
            }
            elements.compactRows.appendChild(block);
        }
        if (showLabels) height += COMPACT_LABEL;
    });

    // No provider enabled — nothing to show; fall back to the base chrome height.
    // (The compact chevron is hidden in this case, so this is an edge state.)
    if (enabled.length === 0) height = COMPACT_BASE;

    if (height !== _lastCompactHeight) {
        _lastCompactHeight = height;
        window.electronAPI.setCompactMode(true, height);
    }
}
// --- end AI Usage ---
// Persist compact mode setting without touching the rest of settings — debounced
let _saveCompactTimer = null;
async function _saveCompactSetting(compact) {
    if (_saveCompactTimer) clearTimeout(_saveCompactTimer);
    _saveCompactTimer = setTimeout(async () => {
        const settings = window._cachedSettings || await window.electronAPI.getSettings();
        settings.compactMode = compact;
        window._cachedSettings = settings;
        await window.electronAPI.saveSettings(settings);
    }, 300);
}

// Persist graph/expanded visibility state — debounced to avoid hammering disk on rapid toggles
let _saveViewStateTimer = null;
async function _saveViewState() {
    if (appInitializing) return;
    if (_saveViewStateTimer) clearTimeout(_saveViewStateTimer);
    _saveViewStateTimer = setTimeout(async () => {
        const settings = window._cachedSettings || await window.electronAPI.getSettings();
        settings.graphVisible = graphVisible;
        settings.expandedOpen = isExpanded;
        window._cachedSettings = settings;
        await window.electronAPI.saveSettings(settings);
    }, 300);
}

let sessionResetTriggered = false;
let weeklyResetTriggered = false;
let isFirstDataLoad = true; // used to seed alert flags on startup

// Track which usage alert thresholds have already fired this window
// Prevents repeat notifications on every refresh cycle
// Keys: 'session_warn', 'session_danger', 'weekly_warn', 'weekly_danger'
// Seeded on startup so thresholds already exceeded at launch don't fire immediately
const alertFired = {
    session_warn: false,
    session_danger: false,
    weekly_warn: false,
    weekly_danger: false
};

// --- AI Usage: multi-provider ---
// Per-model alert dedup state for the extra/scoped rows (Sonnet, Opus, Fable, …).
// Keyed by EXTRA_ROW_CONFIG key → { warn, danger }, mirroring the scalar
// session_/weekly_ flags above but scaling to an unbounded set of model rows.
const extraAlertFired = {};
// --- end AI Usage ---

// Seed alertFired flags based on current utilization at startup.
// Any threshold already exceeded when the app launches is treated as already fired,
// so the user doesn't get a notification for something they can already see.
function seedAlertFlags(data) {
    const sessionPct = data.five_hour?.utilization || 0;
    const weeklyPct = data.seven_day?.utilization || 0;

    if (sessionPct >= dangerThreshold) {
        alertFired.session_danger = true;
        alertFired.session_warn = true;
    } else if (sessionPct >= warnThreshold) {
        alertFired.session_warn = true;
    }

    if (weeklyPct >= dangerThreshold) {
        alertFired.weekly_danger = true;
        alertFired.weekly_warn = true;
    } else if (weeklyPct >= warnThreshold) {
        alertFired.weekly_warn = true;
    }

    // --- AI Usage: multi-provider --- seed per-model (extra/scoped) row flags too,
    // so a Fable/Sonnet/Opus limit already exceeded at launch doesn't fire on load.
    for (const key of Object.keys(EXTRA_ROW_CONFIG)) {
        if (key === 'extra_usage') continue;
        const entry = data[key];
        if (!entry || entry.utilization === undefined) continue;
        const pct = entry.utilization || 0;
        const state = extraAlertFired[key] || (extraAlertFired[key] = { warn: false, danger: false });
        if (pct >= dangerThreshold) {
            state.danger = true;
            state.warn = true;
        } else if (pct >= warnThreshold) {
            state.warn = true;
        }
    }
    // --- end AI Usage ---
}

function refreshTimers() {
    if (!latestUsageData) return;

    const settings = window._cachedSettings || {};
    const timeFormat = settings.timeFormat || '12h';
    const weeklyDateFormat = settings.weeklyDateFormat || 'date';

    // Session data
    const sessionUtilization = latestUsageData.five_hour?.utilization || 0;
    const sessionResetsAt = latestUsageData.five_hour?.resets_at;

    // Check if session timer has expired and we need to refresh
    if (sessionResetsAt) {
        const sessionDiff = new Date(sessionResetsAt) - new Date();
        if (sessionDiff <= 0 && !sessionResetTriggered) {
            sessionResetTriggered = true;
            debugLog('Session timer expired, triggering refresh...');
            // Wait a few seconds for the server to update, then refresh
            setTimeout(() => {
                fetchUsageData();
                checkForUpdate();
            }, 3000);
        } else if (sessionDiff > 0) {
            sessionResetTriggered = false; // Reset flag when timer is active again
        }
    }

    updateProgressBar(
        elements.sessionProgress,
        elements.sessionPercentage,
        sessionUtilization
    );

    updateTimer(
        elements.sessionTimer,
        elements.sessionTimeText,
        sessionResetsAt,
        5 * 60 // 5 hours in minutes
    );
    elements.sessionResetsAt.textContent = formatResetsAt(sessionResetsAt, false, timeFormat, weeklyDateFormat);
    elements.sessionResetsAt.style.opacity = sessionResetsAt ? '1' : '0.4';

    // Weekly data
    const weeklyUtilization = latestUsageData.seven_day?.utilization || 0;
    const weeklyResetsAt = latestUsageData.seven_day?.resets_at;

    // Check if weekly timer has expired and we need to refresh
    if (weeklyResetsAt) {
        const weeklyDiff = new Date(weeklyResetsAt) - new Date();
        if (weeklyDiff <= 0 && !weeklyResetTriggered) {
            weeklyResetTriggered = true;
            debugLog('Weekly timer expired, triggering refresh...');
            setTimeout(() => {
                fetchUsageData();
            }, 3000);
        } else if (weeklyDiff > 0) {
            weeklyResetTriggered = false;
        }
    }

    updateProgressBar(
        elements.weeklyProgress,
        elements.weeklyPercentage,
        weeklyUtilization,
        true
    );

    updateTimer(
        elements.weeklyTimer,
        elements.weeklyTimeText,
        weeklyResetsAt,
        7 * 24 * 60 // 7 days in minutes
    );
    elements.weeklyResetsAt.textContent = formatResetsAt(weeklyResetsAt, true, timeFormat, weeklyDateFormat);
    elements.weeklyResetsAt.style.opacity = weeklyResetsAt ? '1' : '0.4';
}

function startCountdown() {
    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
        refreshTimers();
        if (isExpanded) refreshExtraTimers();
        refreshCodexTimers(); // --- AI Usage: multi-provider ---
        refreshFableTimer();  // --- AI Usage: multi-provider --- tick pinned Fable countdown
    }, 30000);
}

// Update progress bar
function updateProgressBar(progressElement, percentageElement, value, isWeekly = false) {
    const percentage = Math.min(Math.max(value, 0), 100);

    progressElement.style.width = `${percentage}%`;
    percentageElement.textContent = `${Math.round(percentage)}%`;

    progressElement.classList.remove('warning', 'danger');
    if (percentage >= dangerThreshold) {
        progressElement.classList.add('danger');
    } else if (percentage >= warnThreshold) {
        progressElement.classList.add('warning');
    }
}

// Format reset date for the "Resets At" column
// Session: shows time like "3:59 PM" or "15:59"
// Weekly: shows date like "Mar 13", "Fri Mar 13", or "Fri Mar 13 3:59 PM"
function formatResetsAt(resetsAt, isWeekly, timeFormat, weeklyDateFormat) {
    if (!resetsAt) return '—';
    const date = new Date(resetsAt);
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    const formatTime = (d) => {
        if (timeFormat === '24h') {
            return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
        } else {
            let hours = d.getHours();
            const minutes = d.getMinutes().toString().padStart(2, '0');
            const ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12 || 12;
            return `${hours}:${minutes} ${ampm}`;
        }
    };

    if (isWeekly) {
        const dayStr = days[date.getDay()];
        const monthStr = months[date.getMonth()];
        const dayNum = date.getDate();
        const fmt = weeklyDateFormat || 'date';
        if (fmt === 'date-day') return `${dayStr} ${monthStr} ${dayNum}`;
        if (fmt === 'date-day-time') return `${dayStr} ${monthStr} ${dayNum} ${formatTime(date)}`;
        return `${monthStr} ${dayNum}`; // default: 'date'
    } else {
        return formatTime(date);
    }
}

// Update circular timer
function updateTimer(timerElement, textElement, resetsAt, totalMinutes) {
    if (!resetsAt) {
        textElement.textContent = 'Not started';
        textElement.style.opacity = '0.4';
        textElement.style.fontSize = '10px';
        textElement.title = 'Starts when a message is sent';
        timerElement.style.strokeDashoffset = 63;
        return;
    }

    // Clear the greyed out styling when timer is active
    textElement.style.opacity = '1';
    textElement.style.fontSize = '';
    textElement.title = '';

    const resetDate = new Date(resetsAt);
    const now = new Date();
    const diff = resetDate - now;

    if (diff <= 0) {
        textElement.textContent = 'Resetting...';
        timerElement.style.strokeDashoffset = 0;
        return;
    }

    // Calculate remaining time
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    // const seconds = Math.floor((diff % (1000 * 60)) / 1000); // Optional seconds

    // Format time display
    if (hours >= 24) {
        const days = Math.floor(hours / 24);
        const remainingHours = hours % 24;
        textElement.textContent = `${days}d ${remainingHours}h`;
    } else if (hours > 0) {
        textElement.textContent = `${hours}h ${minutes}m`;
    } else {
        textElement.textContent = `${minutes}m`;
    }

    // Calculate progress (elapsed percentage)
    const totalMs = totalMinutes * 60 * 1000;
    const elapsedMs = totalMs - diff;
    const elapsedPercentage = (elapsedMs / totalMs) * 100;

    // Update circle (63 is ~2*pi*10)
    const circumference = 63;
    const offset = circumference - (elapsedPercentage / 100) * circumference;
    timerElement.style.strokeDashoffset = offset;

    // Update color based on remaining time
    timerElement.classList.remove('warning', 'danger');
    if (elapsedPercentage >= 90) {
        timerElement.classList.add('danger');
    } else if (elapsedPercentage >= 75) {
        timerElement.classList.add('warning');
    }
}

// UI State Management
function showLoginRequired() {
    elements.loadingContainer.style.display = 'none';
    elements.loginContainer.style.display = 'flex';
    elements.noUsageContainer.style.display = 'none';
    elements.mainContent.style.display = 'none';
    // Reset to step 1
    elements.loginStep1.style.display = 'flex';
    elements.loginStep2.style.display = 'none';
    elements.sessionKeyError.textContent = '';
    elements.sessionKeyInput.value = '';
    // Close any open overlays
    elements.settingsOverlay.style.display = 'none';
    elements.compactSettingsOverlay.style.display = 'none';
    // Hide header buttons during login
    elements.settingsBtn.style.display = 'none';
    elements.refreshBtn.style.display = 'none';
    elements.graphBtn.style.display = 'none';
    stopAutoUpdate();
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
    // Reset fetch guard so it can't get permanently stuck across login/logout
    isFetching = false;
    // Reset alert state so a new session doesn't inherit suppressed alerts
    isFirstDataLoad = true;
    alertFired.session_warn = false;
    alertFired.session_danger = false;
    alertFired.weekly_warn = false;
    alertFired.weekly_danger = false;
    // --- AI Usage: multi-provider --- clear per-model dedup state so a new session
    // doesn't inherit suppressed (or stale-fired) extra-row alerts.
    for (const k of Object.keys(extraAlertFired)) delete extraAlertFired[k];
    // --- end AI Usage ---
    // Resize window to fit login content — without this the window stays at
    // the default 155px widget height and the "Log in"/"Manual" buttons are
    // clipped off-screen and unreachable on a frameless, non-resizable window.
    // --- AI Usage: multi-provider --- direct resize bypasses the memos; reset them.
    _lastSentHeight = -1;
    _lastCompactHeight = -1;
    window.electronAPI.resizeWindow(360);
}

function showMainContent() {
    elements.loadingContainer.style.display = 'none';
    elements.loginContainer.style.display = 'none';
    elements.noUsageContainer.style.display = 'none';
    // Respect compact mode — don't force mainContent visible if we're in compact
    if (!isCompactMode) {
        elements.mainContent.style.display = 'block';
    }
    elements.compactContent.style.display = isCompactMode ? 'flex' : 'none';
    // Always show collapse chevron here — applyCompactMode hides it when needed
    if (elements.compactCollapseBtn) {
        elements.compactCollapseBtn.style.display = isCompactMode ? 'none' : 'flex';
    }
    // Restore header buttons after login - but respect compact mode for graph button
    elements.settingsBtn.style.display = 'flex';
    elements.refreshBtn.style.display = 'flex';
    elements.graphBtn.style.display = isCompactMode ? 'none' : 'flex';
}

// Auto-update management
function startAutoUpdate() {
    stopAutoUpdate();
    const settings = window._cachedSettings || {};
    const intervalSecs = parseInt(settings.refreshInterval) || 300;
    updateInterval = setInterval(async () => {
        if (elements.refreshBtn) elements.refreshBtn.classList.add('spinning');
        await fetchUsageData();
        if (elements.refreshBtn) elements.refreshBtn.classList.remove('spinning');
    }, intervalSecs * 1000);
}

function stopAutoUpdate() {
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
    }
}

// --- AI Usage: multi-provider ---
// Graph series metadata. Usage-mode series render on a percent axis (0-100);
// spend-mode series on a dollar axis. `src` selects the adapter data source,
// `field` the metric key within it. Claude session/weekly are solid lines;
// Codex reuses Claude's purple/blue but DASHED to read as "the other provider".
// Per-model Claude series (`optional: true`) reuse the OLD chart's line colors
// (Sonnet rose, Opus amber, Cowork cyan, Design brown, OAuth orange) so
// returning users see familiar hues. Their chips only appear when the loaded
// Claude history actually contains non-zero data for that field, and they
// default OFF (extraUsage is excluded — it's a dollar figure, not a percent).
const GRAPH_USAGE_SERIES = [
    { provider: 'claude', key: 'session',   label: 'Session',  color: '#8b5cf6', dash: false, src: 'claude', field: 'session' },
    { provider: 'claude', key: 'weekly',    label: 'Weekly',   color: '#3b82f6', dash: false, src: 'claude', field: 'weekly' },
    { provider: 'claude', key: 'sonnet',    label: 'Sonnet',   color: '#f43f5e', dash: false, src: 'claude', field: 'sonnet',    optional: true },
    { provider: 'claude', key: 'opus',      label: 'Opus',     color: '#f59e0b', dash: false, src: 'claude', field: 'opus',      optional: true },
    { provider: 'claude', key: 'cowork',    label: 'Cowork',   color: '#06b6d4', dash: false, src: 'claude', field: 'cowork',    optional: true },
    { provider: 'claude', key: 'design',    label: 'Design',   color: '#92400e', dash: false, src: 'claude', field: 'design',    optional: true },
    { provider: 'claude', key: 'oauthApps', label: 'OAuth',    color: '#f97316', dash: false, src: 'claude', field: 'oauthApps', optional: true },
    { provider: 'codex',  key: 'window',    label: 'Codex 5h', color: '#8b5cf6', dash: true,  src: 'codex',  field: 'window' },
    { provider: 'codex',  key: 'weekly',    label: 'Codex 7d', color: '#3b82f6', dash: true,  src: 'codex',  field: 'weekly' }
];
// Spend series use OpenRouter's credits green (#10b981) plus two hue neighbours.
const GRAPH_SPEND_SERIES = [
    { provider: 'openrouter', key: 'today', label: 'Today', color: '#10b981', dash: false, src: 'or', field: 'today' },
    { provider: 'openrouter', key: 'week',  label: 'Week',  color: '#22c55e', dash: false, src: 'or', field: 'week' },
    { provider: 'openrouter', key: 'month', label: 'Month', color: '#84cc16', dash: false, src: 'or', field: 'month' }
];

// Current in-memory graph series selection (mode + per-provider toggles),
// hydrated from settings.graphSeries on each loadChart and persisted on change.
let graphSeriesState = null;

// Merge stored settings.graphSeries with defaults, applying a provider-aware
// fallback: when Claude is disabled and the user hasn't explicitly chosen Codex
// usage series, default them ON so usage mode isn't empty.
function getGraphSeries(settings) {
    const { providers } = getProviderPrefs(settings);
    const stored = (settings && settings.graphSeries) || {};
    const su = stored.usage || {};
    const gs = {
        mode: stored.mode === 'spend' ? 'spend' : 'usage',
        usage: {
            claude: Object.assign(
                { session: true, weekly: true, sonnet: false, opus: false, cowork: false, design: false, oauthApps: false },
                su.claude || {}
            ),
            codex: Object.assign({ window: false, weekly: false }, su.codex || {})
        },
        spend: {
            openrouter: Object.assign({ today: true, week: false, month: false }, (stored.spend || {}).openrouter || {})
        }
    };
    if (!providers.claude && !su.codex) {
        gs.usage.codex.window = true;
        gs.usage.codex.weekly = true;
    }
    return gs;
}

// Persist the current graph series selection through the standard settings
// round-trip (additive: main.js only writes settings.graphSeries when present).
async function persistGraphSeries() {
    const base = window._cachedSettings || await window.electronAPI.getSettings();
    base.graphSeries = graphSeriesState;
    window._cachedSettings = base;
    try { await window.electronAPI.saveSettings(base); } catch (e) { debugLog('persistGraphSeries failed', e); }
}

// True if `provider` is enabled in settings.
function graphProviderEnabled(provider) {
    const { providers } = getProviderPrefs(window._cachedSettings || {});
    return !!providers[provider];
}

// Series list for a mode, filtered to enabled providers.
function graphSeriesForMode(mode) {
    const list = mode === 'spend' ? GRAPH_SPEND_SERIES : GRAPH_USAGE_SERIES;
    return list.filter((s) => graphProviderEnabled(s.provider));
}

function graphSeriesSelected(mode, s) {
    const bucket = graphSeriesState && graphSeriesState[mode];
    return !!(bucket && bucket[s.provider] && bucket[s.provider][s.key]);
}

function setGraphSeriesSelected(mode, s, value) {
    const bucket = graphSeriesState[mode];
    if (!bucket[s.provider]) bucket[s.provider] = {};
    bucket[s.provider][s.key] = value;
}

async function loadChart() {
    const settings = window._cachedSettings || await window.electronAPI.getSettings();
    graphSeriesState = getGraphSeries(settings);
    const { providers } = getProviderPrefs(settings);

    // If the persisted mode has no enabled providers, fall back to the other one.
    if (graphSeriesForMode(graphSeriesState.mode).length === 0) {
        graphSeriesState.mode = graphSeriesState.mode === 'usage' ? 'spend' : 'usage';
    }

    // Pull each enabled source concurrently. Claude keeps its untouched endpoint.
    const [claudeHistory, codexRes, orRes] = await Promise.all([
        providers.claude ? window.electronAPI.getUsageHistory() : Promise.resolve([]),
        providers.codex ? window.electronAPI.getProviderHistory('codex') : Promise.resolve({ points: [] }),
        providers.openrouter ? window.electronAPI.getProviderHistory('openrouter') : Promise.resolve({ points: [] })
    ]);

    renderChart({
        claude: Array.isArray(claudeHistory) ? claudeHistory : [],
        codex: (codexRes && codexRes.points) || [],
        or: (orRes && orRes.points) || []
    });
}

// Adapter: Claude history record -> {x,y}. Record shape is untouched.
function claudeXY(history, field) {
    return history.map((e) => ({ x: e.timestamp, y: e[field] || 0 }));
}
// Adapter: provider envelope point -> {x,y}.
function providerXY(points, field) {
    return points.map((p) => ({
        x: p.t,
        // null (absent in a partial fetch) renders as a line gap, not a 0 spike
        y: (p.metrics && typeof p.metrics[field] === 'number') ? p.metrics[field] : null
    }));
}

// Round a dollar value up to a tidy 1/2/5 x 10^n bound so the spend axis stays
// clean and gridlines don't jitter between refreshes.
function niceCeil(v) {
    if (!(v > 0)) return 1;
    const mag = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / mag;
    const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return step * mag;
}

function renderChart(sources) {
    if (usageChart) usageChart.destroy();

    const mode = graphSeriesState.mode;
    const isSpend = mode === 'spend';
    const seriesList = graphSeriesForMode(mode);

    // Optional (per-model Claude) series only exist when the loaded history has
    // non-zero data for that field at least once — avoids a row of dead chips
    // on accounts without model breakdowns. Cheap single scan per field.
    const availability = graphSeriesAvailability(sources);

    // Chip row reflects every enabled series in BOTH modes (unit-grouped).
    buildGraphChips(sources, availability);

    // Datasets: only selected series in the active mode that actually have data.
    const datasets = [];
    const allX = [];
    for (const s of seriesList) {
        if (s.optional && !availability[s.field]) continue;
        if (!graphSeriesSelected(mode, s)) continue;
        const data = s.src === 'claude' ? claudeXY(sources.claude, s.field)
            : s.src === 'codex' ? providerXY(sources.codex, s.field)
                : providerXY(sources.or, s.field);
        if (!data.length) continue;
        for (const pt of data) allX.push(pt.x);
        datasets.push({
            label: s.label,
            data,
            borderColor: s.color,
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: s.dash ? [5, 4] : [],
            stepped: true,
            pointRadius: 0,
            pointHoverRadius: 3,
            pointHitRadius: 10
        });
    }

    // Time range across visible datasets (fallback to last 24h when empty).
    let xMin, xMax;
    if (allX.length) {
        xMin = Math.min(...allX);
        xMax = Math.max(...allX);
        if (xMin === xMax) xMin = xMax - 60 * 60 * 1000;
    } else {
        xMax = Date.now();
        xMin = xMax - 24 * 60 * 60 * 1000;
    }
    const firstDayMidnight = new Date(xMin);
    firstDayMidnight.setHours(0, 0, 0, 0);
    const spanMs = xMax - xMin;

    // Y axis: percent 0-100 for usage; autoscaled dollars for spend. BOTH use 5
    // ticks (4 intervals) so horizontal gridlines share fractions and never shift.
    const TICK_COUNT = 5;
    let yMax;
    if (isSpend) {
        const vals = datasets.flatMap((d) => d.data.map((p) => p.y));
        const rawMax = vals.length ? Math.max(0, ...vals) : 0;
        yMax = niceCeil(rawMax / 4) * 4; // clean step * 4 intervals
    } else {
        yMax = 100;
    }

    usageChart = new Chart(elements.usageChart.getContext('2d'), {
        type: 'line',
        data: { datasets },
        options: {
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'nearest' },
            scales: {
                x: {
                    type: 'linear',
                    min: firstDayMidnight.getTime(),
                    max: xMax,
                    afterBuildTicks(axis) {
                        const d = new Date(firstDayMidnight.getTime());
                        const ticks = [];
                        while (d.getTime() <= xMax) {
                            ticks.push({ value: d.getTime() });
                            d.setDate(d.getDate() + 1);
                        }
                        axis.ticks = ticks;
                    },
                    ticks: {
                        maxRotation: 0,
                        minRotation: 0,
                        font: { size: 10 },
                        callback(value) {
                            const tf = (window._cachedSettings || {}).timeFormat || '12h';
                            return formatTimestampTick(value, spanMs, tf);
                        }
                    },
                    grid: { display: false }
                },
                y: {
                    min: 0,
                    max: yMax,
                    beginAtZero: true,
                    ticks: {
                        count: TICK_COUNT,
                        font: { size: 10 },
                        callback: (value) => isSpend
                            ? `$${Number(value) % 1 === 0 ? value : Number(value).toFixed(2)}`
                            : `${value}%`
                    },
                    grid: { color: 'rgba(255, 255, 255, 0.05)' }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title(items) {
                            return new Date(items[0].parsed.x).toLocaleString([], {
                                month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
                            });
                        },
                        label(item) {
                            return isSpend
                                ? `${item.dataset.label}: ${fmtUSD(item.parsed.y)}`
                                : `${item.dataset.label}: ${Math.round(item.parsed.y)}%`;
                        }
                    }
                }
            }
        }
    });

    // The chip row may have wrapped (buildGraphChips updated _graphChipsExtra),
    // so re-run the height math; resizeWidget dedups identical heights.
    if (!isCompactMode) resizeWidget();
}

// Scan the loaded Claude history once per optional field, marking which
// per-model series have any non-zero sample in the window. Session/weekly and
// non-Claude series are always considered available (data-length gating for
// those happens at dataset build time).
function graphSeriesAvailability(sources) {
    const availability = {};
    for (const s of GRAPH_USAGE_SERIES) {
        if (!s.optional) continue;
        availability[s.field] = sources.claude.some((e) => (e[s.field] || 0) > 0);
    }
    return availability;
}

// Render the unit-grouped legend chip row. Chips exist only for ENABLED
// providers (and, for optional per-model series, only when history has data).
// Active = selected AND in the current mode (color dot + bright text).
// Chips for the other mode read dimmed and switch mode when clicked.
function buildGraphChips(sources, availability) {
    const container = elements.graphChips;
    if (!container) return;
    container.innerHTML = '';
    const mode = graphSeriesState.mode;

    const usage = graphSeriesForMode('usage')
        .filter((s) => !s.optional || (availability && availability[s.field]));
    const spend = graphSeriesForMode('spend');

    const makeChip = (chipMode, s) => {
        const chip = document.createElement('div');
        chip.className = 'graph-chip';
        const inActiveMode = chipMode === mode;
        const selected = graphSeriesSelected(chipMode, s);
        if (inActiveMode && selected) chip.classList.add('active');
        if (!inActiveMode) chip.classList.add('off-mode');

        const dot = document.createElement('span');
        dot.className = 'chip-dot';
        dot.style.color = s.color;
        chip.appendChild(dot);
        const text = document.createElement('span');
        text.textContent = s.label;
        chip.appendChild(text);

        chip.addEventListener('click', async () => {
            if (chipMode !== graphSeriesState.mode) {
                // Switch unit/mode; ensure the clicked series is on so something shows.
                graphSeriesState.mode = chipMode;
                if (!graphSeriesSelected(chipMode, s)) setGraphSeriesSelected(chipMode, s, true);
            } else {
                setGraphSeriesSelected(chipMode, s, !graphSeriesSelected(chipMode, s));
            }
            await persistGraphSeries();
            renderChart(sources);
        });
        return chip;
    };

    usage.forEach((s) => container.appendChild(makeChip('usage', s)));
    if (usage.length && spend.length) {
        const sep = document.createElement('div');
        sep.className = 'graph-chip-sep';
        container.appendChild(sep);
    }
    spend.forEach((s) => container.appendChild(makeChip('spend', s)));

    // Measure the rendered row: any height beyond the single-row baseline
    // (chips wrapped onto extra lines) must be added to the window's graph
    // offset. Reads 0 while the section is hidden, which is correct — the
    // graph contributes no height then either.
    _graphChipsExtra = Math.max(0, container.offsetHeight - GRAPH_CHIP_ROW);
}
// --- end AI Usage ---

function formatTimestampTick(timestamp, spanMs, timeFormat) {
    const date = new Date(timestamp);
    const hour12 = (timeFormat || '12h') !== '24h';

    if (spanMs < 12 * 60 * 60 * 1000) {
        return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12 });
    }
    if (spanMs < 48 * 60 * 60 * 1000) {
        return date.toLocaleString([], { weekday: 'short', hour: 'numeric', hour12 });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Add spinning animation for refresh button
const style = document.createElement('style');
style.textContent = `
    @keyframes spin-refresh {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }
    
    .refresh-btn.spinning svg {
        animation: spin-refresh 1s linear infinite;
    }
`;
document.head.appendChild(style);

// Settings management
let warnThreshold = 75;
let dangerThreshold = 90;

async function loadSettings() {
    const settings = await window.electronAPI.getSettings();
    const isLinux = window.electronAPI.platform === 'linux';
    const isPortable = window.electronAPI.isPortable;
    const autoStartUnsupported = isLinux || isPortable;

    elements.autoStartToggle.checked = autoStartUnsupported ? false : settings.autoStart;
    elements.autoStartToggle.disabled = autoStartUnsupported;
    if (elements.autoStartCol) {
        elements.autoStartCol.classList.toggle('settings-col-disabled', autoStartUnsupported);
    }
    if (elements.autoStartHint) {
        elements.autoStartHint.style.display = autoStartUnsupported ? 'inline' : 'none';
        elements.autoStartHint.textContent = isPortable
            ? 'Not supported in portable mode!'
            : 'Not supported on Linux';
    }
    elements.minimizeToTrayToggle.checked = settings.minimizeToTray;
    elements.alwaysOnTopToggle.checked = settings.alwaysOnTop;
    elements.showTrayStatsToggle.checked = settings.showTrayStats || false;
    elements.warnThreshold.value = settings.warnThreshold;
    elements.dangerThreshold.value = settings.dangerThreshold;
    elements.timeFormat.value = settings.timeFormat || '12h';
    elements.weeklyDateFormat.value = settings.weeklyDateFormat || 'date';
    if (elements.refreshInterval) elements.refreshInterval.value = settings.refreshInterval || '300';
    elements.usageAlertsToggle.checked = settings.usageAlerts !== false;
    if (elements.compactModeToggle) elements.compactModeToggle.checked = !!settings.compactMode;

    // Populate org selector if user has organizations
    if (credentials.organizations && credentials.organizations.length > 0) {
        populateOrgSelector(credentials.organizations, credentials.organizationId);
    }

    warnThreshold = settings.warnThreshold;
    dangerThreshold = settings.dangerThreshold;

    elements.themeBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === settings.theme);
    });

    // --- AI Usage: multi-provider --- populate provider toggles, row checkboxes, statuses
    const { providers: P, visibleRows } = getProviderPrefs(settings);
    const vc = visibleRows.claude;
    const vx = visibleRows.codex;
    const vo = visibleRows.openrouter;

    if (elements.providerClaudeToggle) elements.providerClaudeToggle.checked = !!P.claude;
    if (elements.providerCodexToggle) elements.providerCodexToggle.checked = !!P.codex;
    if (elements.providerOpenrouterToggle) elements.providerOpenrouterToggle.checked = !!P.openrouter;

    if (elements.claudeRowSession) elements.claudeRowSession.checked = vc.session !== false;
    if (elements.claudeRowWeekly) elements.claudeRowWeekly.checked = vc.weekly !== false;
    if (elements.claudeRowFable) elements.claudeRowFable.checked = vc.fable !== false; // --- AI Usage: multi-provider ---
    if (elements.codexRowSession) elements.codexRowSession.checked = vx.session !== false;
    if (elements.codexRowWeekly) elements.codexRowWeekly.checked = vx.weekly !== false;
    if (elements.orRowTodayChk) elements.orRowTodayChk.checked = vo.today !== false;
    if (elements.orRowWeekChk) elements.orRowWeekChk.checked = vo.week !== false;
    if (elements.orRowMonthChk) elements.orRowMonthChk.checked = vo.month !== false;
    if (elements.orRowCreditsChk) elements.orRowCreditsChk.checked = vo.credits !== false;

    updateProviderSubsVisibility();

    // Codex auth presence + status line
    try {
        const cs = await window.electronAPI.getCodexStatus();
        codexAuthPresent = !!(cs && cs.present);
    } catch (e) { /* keep prior value */ }
    updateCodexStatusLine();

    // OpenRouter key presence indicator (never echoes the key)
    await refreshOpenRouterKeyStatus();
    // --- end AI Usage ---

    applyTheme(settings.theme);
    if (window.electronAPI.platform === 'darwin') {
        document.getElementById('trayLabel').textContent = 'Hide from Dock';
    }
}

async function saveSettings() {
    const activeThemeBtn = document.querySelector('.theme-btn.active');
    const warn = parseInt(elements.warnThreshold.value) || 75;
    const danger = parseInt(elements.dangerThreshold.value) || 90;

    warnThreshold = warn;
    dangerThreshold = danger;

    // Apply compact mode change first, then include in saved settings
    const compactToggleValue = elements.compactModeToggle.checked;
    if (compactToggleValue !== isCompactMode) {
        applyCompactMode(compactToggleValue);
    }

    const settings = {
        autoStart: (window.electronAPI.platform === 'linux' || window.electronAPI.isPortable) ? false : elements.autoStartToggle.checked,
        minimizeToTray: elements.minimizeToTrayToggle.checked,
        alwaysOnTop: elements.alwaysOnTopToggle.checked,
        showTrayStats: elements.showTrayStatsToggle.checked,
        theme: activeThemeBtn ? activeThemeBtn.dataset.theme : 'dark',
        warnThreshold: warn,
        dangerThreshold: danger,
        timeFormat: elements.timeFormat.value || '12h',
        weeklyDateFormat: elements.weeklyDateFormat.value || 'date',
        refreshInterval: elements.refreshInterval ? (elements.refreshInterval.value || '300') : '300',
        usageAlerts: elements.usageAlertsToggle.checked,
        compactMode: isCompactMode,
        graphVisible: graphVisible,
        expandedOpen: isExpanded,
        // --- AI Usage: multi-provider ---
        providers: {
            claude: elements.providerClaudeToggle ? elements.providerClaudeToggle.checked : true,
            codex: elements.providerCodexToggle ? elements.providerCodexToggle.checked : false,
            openrouter: elements.providerOpenrouterToggle ? elements.providerOpenrouterToggle.checked : false
        },
        visibleRows: {
            claude: {
                session: elements.claudeRowSession ? elements.claudeRowSession.checked : true,
                weekly: elements.claudeRowWeekly ? elements.claudeRowWeekly.checked : true,
                fable: elements.claudeRowFable ? elements.claudeRowFable.checked : true // --- AI Usage: multi-provider ---
            },
            codex: {
                session: elements.codexRowSession ? elements.codexRowSession.checked : true,
                weekly: elements.codexRowWeekly ? elements.codexRowWeekly.checked : true
            },
            openrouter: {
                today: elements.orRowTodayChk ? elements.orRowTodayChk.checked : true,
                week: elements.orRowWeekChk ? elements.orRowWeekChk.checked : true,
                month: elements.orRowMonthChk ? elements.orRowMonthChk.checked : true,
                credits: elements.orRowCreditsChk ? elements.orRowCreditsChk.checked : true
            }
        }
        // --- end AI Usage ---
    };

    // --- AI Usage: multi-provider ---
    // Carry the current graph series selection through so cached settings stay
    // consistent (main.js only persists it when defined; omit when the graph
    // hasn't been opened yet so stored defaults survive).
    if (graphSeriesState) settings.graphSeries = graphSeriesState;
    // If OpenRouter was just enabled and has no data yet, clear the throttle so
    // the post-close refresh fetches it right away.
    if (settings.providers.openrouter && !openRouterFetched) {
        lastOpenRouterFetch = 0;
    }
    // --- end AI Usage ---

    await window.electronAPI.saveSettings(settings);
    window._cachedSettings = settings;
    applyTheme(settings.theme);
    if (window.electronAPI.platform === 'darwin') {
        document.getElementById('trayLabel').textContent = 'Hide from Dock';
    }

    // Re-render resets-at values immediately with new format
    if (latestUsageData) {
        // --- AI Usage: multi-provider ---
        // Recompute the pinned-Fable state from the just-saved settings BEFORE
        // buildExtraRows, or its skip condition reads the stale flag and Fable
        // either vanishes or renders twice (pinned + expand panel) until the
        // next fetch. Also re-renders the Fable resets-at text in the new format.
        updatePinnedFableRow(latestUsageData);
        refreshTimers();
        // Rebuild extra rows to apply new threshold colors
        if (isExpanded) {
            buildExtraRows(latestUsageData);
            refreshExtraTimers();
        }
    }
    // Restart auto-update with new interval if it changed
    startAutoUpdate();
}

function applyTheme(theme) {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const useDark = theme === 'dark' || (theme === 'system' && prefersDark);
    document.body.classList.toggle('theme-light', !useDark);
}

// Update check
async function checkForUpdate() {
    try {
        const result = await window.electronAPI.checkForUpdate();
        if (!result.hasUpdate) return;

        const version = result.version;

        // Show banner and expand window to compensate
        elements.updateBannerText.textContent = `▲  Version ${version} available — click to download`;
        elements.updateBanner.style.display = 'flex';
        resizeWidget(true);

        // Populate settings panel link if already visible
        if (elements.settingsUpdateLink) {
            elements.settingsUpdateLink.textContent = `→ v${version} available`;
            elements.settingsUpdateLink.style.display = 'inline';
        }

        debugLog(`Update available: v${version}`);
    } catch (e) {
        debugLog('Update check failed silently', e);
    }
}

// Start the application
init();
window.addEventListener('beforeunload', () => {
    stopAutoUpdate();
    if (countdownInterval) clearInterval(countdownInterval);
});

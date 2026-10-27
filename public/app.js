class SubsyncarrPlusClient {
  constructor() {
    this.ws = null;
    this.state = { currentRun: null, files: [], isRunning: false };
    this.runFiles = [];
    this.stateVersion = 0;
    this.history = [];
    this.historyCache = {};
    this.config = null;
    this.enabledEngines = [];
    this.reconnectInterval = 3000;
    this.selectedPaths = [];
    this.fileLogs = {};
    this.activeModalFile = null;
    this.activeModalRunId = null;
    this.fileLogRequest = 0;
    this.liveLines = [];
    this.logsPaused = false;
    this.resultsLimit = 50;
    this.clearedRunId = null;
    this.clearedFiles = new Set();
    this.modalFocus = new Map();
    this.connected = false;
    this.notices = new Map();
    this.initTheme();
    this.setupEventHandlers();
    this.render();
    this.initWebSocket();
    this.fetchInitialState();
    this.fetchConfigStatus();
    this.clockTimer = setInterval(() => this.renderClock(), 1000);
    this.scheduleUpdateTimer = setInterval(() => this.fetchConfigStatus(), 60000);
  }

  setNotice(key, message) {
    if (message) this.notices.set(key, message);
    else this.notices.delete(key);
    document.getElementById('dashboardNotice').textContent = [...this.notices.values()].join(' ');
  }

  getDisplayRun() {
    if (this.state.isRunning && !this.state.currentRun) return null;
    return this.state.currentRun || this.history[0] || null;
  }

  getDisplayFiles(includeCleared = false) {
    const run = this.getDisplayRun();
    if (!run) return [];
    const files = this.state.currentRun ? this.runFiles : this.historyCache[run.id]?.files || [];
    return !includeCleared && this.clearedRunId === run.id
      ? files.filter((file) => !this.clearedFiles.has(file.file_path))
      : files;
  }

  getEngineNames(files = this.getDisplayFiles(true)) {
    const found = files.flatMap((file) => Object.keys(SubsyncarrDashboard.engineResults(file.engines)));
    const active = files.map((file) => file.current_engine).filter(Boolean);
    return [...new Set([...this.enabledEngines, ...found, ...active])].filter((name) => name !== 'all');
  }

  updateConnection(connected) {
    this.connected = connected;
    document.getElementById('connectionStatus').classList.toggle('offline', !connected);
    document.getElementById('connectionLabel').textContent = connected ? 'Live connection' : 'Reconnecting…';
    this.setNotice('connection', connected ? '' : 'Live connection lost. Reconnecting; displayed data may be stale.');
    this.updateButtonVisibility();
  }

  applyState(data) {
    const changed = this.state.currentRun?.id !== data.currentRun?.id;
    if (changed) {
      if (this.activeModalFile) this.closeFileLogsModal();
      this.logsPaused = false;
      this.fileLogs = {};
      this.liveLines = [];
      this.clearedRunId = null;
      this.clearedFiles = new Set();
      this.resultsLimit = 50;
    }
    this.state = { currentRun: data.currentRun, files: data.files || [], isRunning: data.isRunning };
    this.runFiles = [...this.state.files];
    this.fileLogs = { ...this.fileLogs, ...data.fileLogs };
    if (data.fileLogs) {
      this.liveLines = Object.entries(data.fileLogs)
        .flatMap(([filePath, logs]) => logs.slice(-10).map((log) => ({ filePath, log })))
        .slice(-120);
    }
    this.lastStateAt = Date.now();
    this.setNotice('status', '');
    this.render();
  }

  initWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${protocol}//${location.host}/ws`);
    this.ws.onopen = () => {
      const reconnected = this.hasConnected;
      this.hasConnected = true;
      this.updateConnection(true);
      if (reconnected) {
        this.fetchHistory();
        this.fetchConfigStatus();
      }
    };
    this.ws.onmessage = (event) => {
      try {
        this.handleMessage(JSON.parse(event.data));
      } catch (error) {
        console.error('Unable to read live update:', error);
      }
    };
    this.ws.onclose = () => {
      this.updateConnection(false);
      this.reconnectTimer = setTimeout(() => this.initWebSocket(), this.reconnectInterval);
    };
    this.ws.onerror = () => this.updateConnection(false);
  }

  handleFileLog(srtPath, log) {
    if (!this.fileLogs[srtPath]) this.fileLogs[srtPath] = [];
    this.fileLogs[srtPath].push(log);
    if (this.fileLogs[srtPath].length > 300) this.fileLogs[srtPath].shift();
    this.liveLines.push({ filePath: srtPath, log, time: Date.now() });
    if (this.liveLines.length > 120) this.liveLines.shift();
    if (!this.logsPaused && !this.logRenderPending) {
      this.logRenderPending = true;
      requestAnimationFrame(() => {
        this.logRenderPending = false;
        this.renderLiveOutput();
      });
    }
    if (this.activeModalFile === srtPath && this.activeModalRunId === this.getDisplayRun()?.id) {
      const output = document.getElementById('fileLogsContent');
      output.textContent += (output.textContent ? '\n' : '') + log;
      output.scrollTop = output.scrollHeight;
    }
  }

  handleMessage(msg) {
    if (msg.type !== 'file:log') this.stateVersion++;
    switch (msg.type) {
      case 'state':
        this.applyState(msg.data);
        break;
      case 'file:log':
        this.handleFileLog(msg.data.srtPath, msg.data.log);
        break;
      case 'run:started':
        if (this.activeModalFile) this.closeFileLogsModal();
        this.logsPaused = false;
        this.state = { currentRun: msg.data, files: [], isRunning: true };
        this.runFiles = [];
        this.fileLogs = {};
        this.liveLines = [];
        this.clearedRunId = null;
        this.clearedFiles = new Set();
        this.resultsLimit = 50;
        this.lastStateAt = Date.now();
        this.render();
        this.fetchHistory();
        break;
      case 'run:completed':
      case 'run:cancelled':
        this.state.currentRun = msg.data;
        this.state.isRunning = false;
        this.lastStateAt = Date.now();
        this.render();
        this.fetchHistory();
        break;
      case 'file:updated':
        this.updateFile(msg.data.file);
        if (msg.data.run) this.state.currentRun = msg.data.run;
        this.lastStateAt = Date.now();
        this.render();
        break;
      case 'files:cleared':
        this.clearedFiles = new Set([
          ...(this.clearedFiles || []),
          ...this.getDisplayFiles()
            .filter((file) => ['completed', 'skipped', 'error'].includes(file.status))
            .map((file) => file.file_path),
        ]);
        this.clearedRunId = this.getDisplayRun()?.id;
        if (msg.data.currentRun) this.state.currentRun = msg.data.currentRun;
        this.state.files = msg.data.files || [];
        this.render();
        break;
    }
  }

  updateFile(fileData) {
    for (const files of [this.state.files, this.runFiles]) {
      const index = files.findIndex((file) => file.file_path === fileData.file_path);
      if (index >= 0) files[index] = fileData;
      else files.push(fileData);
    }
  }

  async fetchInitialState() {
    const version = this.stateVersion;
    try {
      const response = await fetch('/api/status');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (version === this.stateVersion) this.applyState(data);
      this.setNotice('status', '');
    } catch (error) {
      this.setNotice('status', 'Unable to load status. Live updates will retry the connection.');
      console.error('Failed to fetch status:', error);
    }
    this.fetchHistory();
  }

  async fetchHistory() {
    const request = (this.historyRequest || 0) + 1;
    this.historyRequest = request;
    try {
      const response = await fetch('/api/history');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const history = await response.json();
      const details = await Promise.all(
        history.map(async (run) => {
          try {
            const result = await fetch(`/api/runs/${encodeURIComponent(run.id)}`);
            if (!result.ok) throw new Error(`HTTP ${result.status}`);
            const data = await result.json();
            const files = data.files || [];
            return { ...run, files, engineStats: this.calculateEngineStats(files), detailsAvailable: true };
          } catch {
            return { ...run, files: [], detailsAvailable: false };
          }
        }),
      );
      if (request !== this.historyRequest) return;
      this.history = history;
      this.historyCache = Object.fromEntries(details.map((run) => [run.id, run]));
      const currentDetails = this.historyCache[this.state.currentRun?.id];
      if (currentDetails?.detailsAvailable) {
        // Discovery inserts pending/pre-skipped rows without individual events.
        // Merge that snapshot while retaining any newer WebSocket file updates.
        const files = new Map(this.runFiles.map((file) => [file.file_path, file]));
        for (const file of currentDetails.files) {
          const existing = files.get(file.file_path);
          if (!existing || file.updated_at > existing.updated_at) files.set(file.file_path, file);
        }
        this.runFiles = [...files.values()];
      }
      this.setNotice(
        'history',
        details.some((run) => !run.detailsAvailable)
          ? 'Some historical file details could not be loaded. Reload history to retry.'
          : '',
      );
      this.render();
    } catch (error) {
      if (request !== this.historyRequest) return;
      this.setNotice('history', 'Unable to load run history. Refresh the page to retry.');
      console.error('Failed to fetch history:', error);
      document.getElementById('historyBody').innerHTML =
        '<tr><td colspan="12" class="no-data">History unavailable. Refresh to retry.</td></tr>';
    }
  }

  async fetchConfigStatus() {
    try {
      const response = await fetch('/api/config');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.config = await response.json();
      this.enabledEngines = this.config.engines || [];
      this.setNotice('config', '');
      this.renderConfigStatus(this.config);
      this.render();
    } catch (error) {
      this.setNotice('config', 'Configuration unavailable. Folder and schedule status may be stale.');
      console.error('Failed to fetch configuration:', error);
      if (!this.config) {
        document.getElementById('watchedPaths').textContent = 'Configuration unavailable';
        document.getElementById('scheduleDate').textContent = 'Schedule unavailable';
      }
    }
  }

  renderConfigStatus(config) {
    const paths = config.paths || [];
    document.getElementById('folderCount').textContent = paths.length;
    document.getElementById('watchedPaths').innerHTML =
      paths
        .map(
          (path) =>
            `<div class="watched-path"><svg aria-hidden="true"><use href="#folder"/></svg><span class="path-label" title="${this.escapeHtml(path)}">${this.escapeHtml(path)}</span></div>`,
        )
        .join('') || '<span class="muted">No scan paths configured</span>';
    const excluded = config.excludePaths || [];
    document.getElementById('excludedPaths').textContent = excluded.length
      ? `Excluded: ${excluded.join(', ')}`
      : config.isConfigured
        ? 'Configured scan roots'
        : 'Using the default scan directory';
    this.renderScheduleStatus(config.schedule);
  }

  renderScheduleStatus(schedule) {
    const enabled = Boolean(schedule?.enabled);
    const next = enabled && schedule.nextRun ? new Date(schedule.nextRun) : null;
    const validNext = next && Number.isFinite(next.getTime());
    document.getElementById('scheduleLabel').textContent = enabled ? 'Next scheduled scan' : 'Automatic scans';
    document.getElementById('scheduleDate').textContent = validNext
      ? next.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
      : enabled
        ? 'Next run unavailable'
        : 'Manual runs only';
    document.getElementById('scheduleTime').textContent = validNext
      ? next.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      : enabled
        ? '—'
        : 'Disabled';
    document.getElementById('scheduleCountdown').textContent = validNext ? this.formatTimeUntil(next - Date.now()) : '';
    document.getElementById('scheduleDescription').textContent = enabled
      ? schedule.description || 'Scheduled scanning'
      : 'Start a full run or select a folder';
    document.getElementById('scheduleCron').textContent = enabled ? schedule.cron || '' : '';
    const status = document.getElementById('scheduleEnabled');
    status.textContent = enabled ? 'Schedule enabled' : 'Schedule disabled';
    status.className = enabled ? 'green' : 'muted';
  }

  formatTimeUntil(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `in ${days} day${days > 1 ? 's' : ''}`;
    } else if (hours > 0) {
      return `in ${hours} hour${hours > 1 ? 's' : ''}`;
    } else if (minutes > 0) {
      return `in ${minutes} minute${minutes > 1 ? 's' : ''}`;
    } else {
      return 'very soon';
    }
  }

  initTheme() {
    const savedTheme = localStorage.getItem('subsyncarr_theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const currentTheme = savedTheme || (prefersDark ? 'dark' : 'light');
    this.applyTheme(currentTheme);

    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (!localStorage.getItem('subsyncarr_theme')) {
          this.applyTheme(e.matches ? 'dark' : 'light');
        }
      });
    }
  }

  applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    document.getElementById('themeToggleIcon').innerHTML =
      `<svg aria-hidden="true"><use href="#${theme === 'dark' ? 'sun' : 'moon'}"/></svg>`;
    const button = document.getElementById('themeToggle');
    button.title = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
    button.setAttribute('aria-label', button.title);
  }

  toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('subsyncarr_theme', newTheme);
    this.applyTheme(newTheme);
  }

  setupEventHandlers() {
    document.getElementById('fileSearch').addEventListener('input', () => {
      this.resultsLimit = 50;
      this.renderFiles();
    });
    document.getElementById('statusFilter').addEventListener('change', () => {
      this.resultsLimit = 50;
      this.renderFiles();
    });
    document.getElementById('loadMoreResults').addEventListener('click', () => {
      this.resultsLimit += 50;
      this.renderFiles();
    });
    document.getElementById('logToggle').addEventListener('click', () => {
      this.logsPaused = !this.logsPaused;
      const button = document.getElementById('logToggle');
      button.textContent = this.logsPaused ? 'Resume view' : 'Pause view';
      button.setAttribute('aria-pressed', String(this.logsPaused));
      document.getElementById('liveOutputScope').textContent = this.logsPaused
        ? '/ view paused; still collecting'
        : '/ all active files';
      if (!this.logsPaused) this.renderLiveOutput();
    });
    document.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const { action, path, engine, run, category } = button.dataset;
      if (action === 'log') this.showFileLog(path);
      else if (action === 'skip') this.skipFile(path);
      else if (action === 'reset') this.resetSkipStatus(path, engine, button);
      else if (action === 'run-log') this.viewLogs(run);
      else if (action === 'file-list') this.showFileList(run, category);
    });
    document.addEventListener('keydown', (event) => {
      const modal = document.querySelector('.modal:not(.hidden)');
      if (!modal) return;
      if (event.key === 'Escape') this.closeModal(modal.id);
      if (event.key === 'Tab') {
        const controls = [
          ...modal.querySelectorAll('button:not(:disabled), [href], input, select, [tabindex="0"]'),
        ].filter((element) => element.getClientRects().length);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    });
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
      themeToggle.addEventListener('click', () => {
        this.toggleTheme();
      });
    }

    document.getElementById('startRun').addEventListener('click', () => {
      this.startRun();
    });

    document.getElementById('startCustom').addEventListener('click', () => {
      this.openPicker();
    });

    document.getElementById('stopRun').addEventListener('click', () => {
      this.stopRun();
    });

    document.getElementById('closeModal').addEventListener('click', () => {
      this.closePicker();
    });

    document.getElementById('cancelCustom').addEventListener('click', () => {
      this.closePicker();
    });

    document.getElementById('submitCustom').addEventListener('click', () => {
      if (this.selectedPaths.length === 0) {
        alert('Add at least one path before starting a scan.');
        return;
      }
      const paths = this.selectedPaths.slice();
      this.closePicker();
      this.startRun(paths);
    });

    // Close modal when clicking outside
    document.getElementById('customPathModal').addEventListener('click', (e) => {
      if (e.target.id === 'customPathModal') {
        this.closePicker();
      }
    });

    // Logs modal handlers
    document.getElementById('closeLogsModal').addEventListener('click', () => {
      this.closeModal('logsModal');
    });

    document.getElementById('closeLogsButton').addEventListener('click', () => {
      this.closeModal('logsModal');
    });

    document.getElementById('copyLogs').addEventListener('click', async () => {
      const logsContent = document.getElementById('logsContent').textContent;
      try {
        await navigator.clipboard.writeText(logsContent);
        const btn = document.getElementById('copyLogs');
        const originalText = btn.textContent;
        btn.textContent = '✓ Copied!';
        setTimeout(() => {
          btn.textContent = originalText;
        }, 2000);
      } catch (err) {
        console.error('Failed to copy logs:', err);
        // Fallback method for older browsers or permission issues
        const textArea = document.createElement('textarea');
        textArea.value = logsContent;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.select();
        try {
          document.execCommand('copy');
          const btn = document.getElementById('copyLogs');
          const originalText = btn.textContent;
          btn.textContent = '✓ Copied!';
          setTimeout(() => {
            btn.textContent = originalText;
          }, 2000);
        } catch (execErr) {
          console.error('Fallback copy also failed:', execErr);
          alert('Failed to copy logs to clipboard');
        }
        document.body.removeChild(textArea);
      }
    });

    // Close logs modal when clicking outside
    document.getElementById('logsModal').addEventListener('click', (e) => {
      if (e.target.id === 'logsModal') {
        this.closeModal('logsModal');
      }
    });

    // File logs modal handlers
    document.getElementById('closeFileLogsModal')?.addEventListener('click', () => {
      this.closeFileLogsModal();
    });

    document.getElementById('closeFileLogsButton')?.addEventListener('click', () => {
      this.closeFileLogsModal();
    });

    document.getElementById('fileLogsModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'fileLogsModal') {
        this.closeFileLogsModal();
      }
    });

    document.getElementById('copyFileLogs')?.addEventListener('click', async () => {
      const content = document.getElementById('fileLogsContent').textContent;
      try {
        await navigator.clipboard.writeText(content);
        const btn = document.getElementById('copyFileLogs');
        const originalText = btn.textContent;
        btn.textContent = '✓ Copied!';
        setTimeout(() => {
          btn.textContent = originalText;
        }, 2000);
      } catch (err) {
        console.error('Failed to copy file logs:', err);
      }
    });

    // View current run logs
    document.getElementById('viewCurrentRunLogs')?.addEventListener('click', () => {
      if (this.getDisplayRun()) {
        this.viewLogs(this.getDisplayRun().id);
      } else {
        alert('No active run currently running');
      }
    });

    // Clear completed files
    document.getElementById('clearCompleted').addEventListener('click', () => {
      this.clearCompleted();
    });

    // File list modal handlers
    document.getElementById('closeFileListModal').addEventListener('click', () => {
      this.closeModal('fileListModal');
    });

    document.getElementById('closeFileListButton').addEventListener('click', () => {
      this.closeModal('fileListModal');
    });

    // Close file list modal when clicking outside
    document.getElementById('fileListModal').addEventListener('click', (e) => {
      if (e.target.id === 'fileListModal') {
        this.closeModal('fileListModal');
      }
    });
  }

  openModal(id) {
    const modal = document.getElementById(id);
    if (modal.classList.contains('hidden')) this.modalFocus.set(id, document.activeElement);
    modal.classList.remove('hidden');
    document.body.classList.add('modal-open');
    modal.querySelector('button')?.focus();
  }

  closeModal(id) {
    document.getElementById(id).classList.add('hidden');
    if (id === 'fileLogsModal') {
      this.activeModalFile = null;
      this.activeModalRunId = null;
      this.fileLogRequest++;
      document.getElementById('fileLogsContent').textContent = '';
      document.getElementById('fileLogsMeta').textContent = '';
      document.getElementById('fileLogsEngines').textContent = '';
    }
    if (!document.querySelector('.modal:not(.hidden)')) document.body.classList.remove('modal-open');
    this.modalFocus.get(id)?.focus();
    this.modalFocus.delete(id);
  }

  async openPicker() {
    this.selectedPaths = [];
    this.renderSelectedPaths();
    const tree = document.getElementById('folderTree');
    tree.innerHTML = '<div class="tree-loading">Loading…</div>';
    this.openModal('customPathModal');
    try {
      const data = await this.fetchBrowse(null);
      tree.innerHTML = '';
      if (data.entries.length === 0) {
        tree.innerHTML = '<div class="tree-empty">No paths configured. Set SCAN_PATHS env var.</div>';
        return;
      }
      data.entries.forEach((entry) => tree.appendChild(this.makeTreeRow(entry, 0)));
    } catch (err) {
      tree.innerHTML = `<div class="tree-error">Failed to load: ${this.escapeHtml(err.message)}</div>`;
    }
  }

  closePicker() {
    this.closeModal('customPathModal');
  }

  async fetchBrowse(path) {
    const url = path ? `/api/browse?path=${encodeURIComponent(path)}` : '/api/browse';
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  makeTreeRow(entry, depth) {
    const wrapper = document.createElement('div');
    wrapper.className = 'tree-node';

    const isFile = entry.isDir === false;

    const row = document.createElement('div');
    row.className = isFile ? 'tree-row tree-row-file' : 'tree-row';
    row.style.paddingLeft = `${depth * 16}px`;

    const chevron = document.createElement('span');
    chevron.className = 'tree-chevron';
    chevron.textContent = isFile ? '' : '▶';

    const icon = document.createElement('span');
    icon.className = 'tree-icon';
    icon.innerHTML = `<svg aria-hidden="true"><use href="#${isFile ? 'file' : 'folder'}"/></svg>`;

    const name = document.createElement('span');
    name.className = 'tree-name';
    name.textContent = entry.name;
    name.title = entry.path;

    const toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.className = 'tree-toggle';
    toggleButton.setAttribute('aria-expanded', 'false');
    toggleButton.setAttribute('aria-label', `Browse ${entry.path}`);
    const content = isFile ? row : toggleButton;
    content.appendChild(chevron);
    content.appendChild(icon);
    content.appendChild(name);

    if (isFile) {
      // Files are display-only — no expand, no add.
      wrapper.appendChild(row);
      return wrapper;
    }
    row.appendChild(toggleButton);

    const addBtn = document.createElement('button');
    addBtn.className = 'tree-add';
    addBtn.type = 'button';
    addBtn.textContent = '+';
    addBtn.title = 'Add this path';
    addBtn.setAttribute('aria-label', `Add ${entry.path}`);
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.addSelectedPath(entry.path);
    });
    row.appendChild(addBtn);

    const children = document.createElement('div');
    children.className = 'tree-children hidden';
    let loaded = false;

    const toggle = async () => {
      if (!loaded) {
        loaded = true;
        children.innerHTML = '<div class="tree-loading" style="padding-left:' + (depth + 1) * 16 + 'px">Loading…</div>';
        children.classList.remove('hidden');
        toggleButton.setAttribute('aria-expanded', 'true');
        chevron.textContent = '▼';
        try {
          const data = await this.fetchBrowse(entry.path);
          children.innerHTML = '';
          if (data.entries.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'tree-empty';
            empty.style.paddingLeft = `${(depth + 1) * 16}px`;
            empty.textContent = '(empty)';
            children.appendChild(empty);
          } else {
            data.entries.forEach((child) => children.appendChild(this.makeTreeRow(child, depth + 1)));
          }
        } catch (err) {
          loaded = false;
          children.innerHTML = '';
          const errEl = document.createElement('div');
          errEl.className = 'tree-error';
          errEl.style.paddingLeft = `${(depth + 1) * 16}px`;
          errEl.textContent = `Failed to load: ${err.message}`;
          children.appendChild(errEl);
        }
        return;
      }
      const willOpen = children.classList.contains('hidden');
      children.classList.toggle('hidden');
      toggleButton.setAttribute('aria-expanded', String(willOpen));
      chevron.textContent = willOpen ? '▼' : '▶';
    };

    toggleButton.addEventListener('click', toggle);

    wrapper.appendChild(row);
    wrapper.appendChild(children);
    return wrapper;
  }

  addSelectedPath(path) {
    if (this.selectedPaths.includes(path)) return;
    this.selectedPaths.push(path);
    this.renderSelectedPaths();
  }

  removeSelectedPath(path) {
    this.selectedPaths = this.selectedPaths.filter((p) => p !== path);
    this.renderSelectedPaths();
  }

  renderSelectedPaths() {
    const list = document.getElementById('selectedPaths');
    const empty = document.getElementById('selectedPathsEmpty');
    list.innerHTML = '';
    if (this.selectedPaths.length === 0) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    this.selectedPaths.forEach((path) => {
      const li = document.createElement('li');
      li.dataset.fullpath = path;
      li.title = path;
      const span = document.createElement('span');
      span.className = 'selected-path-text';
      span.textContent = path;
      const btn = document.createElement('button');
      btn.className = 'selected-path-remove';
      btn.type = 'button';
      btn.setAttribute('aria-label', `Remove ${path}`);
      btn.textContent = '×';
      btn.title = 'Remove';
      btn.addEventListener('click', () => this.removeSelectedPath(path));
      li.appendChild(span);
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  escapeHtml(s) {
    return String(s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  }

  async startRun(paths = null) {
    try {
      const response = await fetch('/api/run/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths }),
      });

      if (!response.ok) {
        const error = await response.json();
        alert(`Failed to start run: ${error.error}`);
      }
    } catch (error) {
      alert(`Failed to start run: ${error.message}`);
    }
  }

  async stopRun() {
    if (!confirm('Are you sure you want to stop the current run? All processing will be halted.')) {
      return;
    }

    try {
      const response = await fetch('/api/run/stop', {
        method: 'POST',
      });

      if (!response.ok) {
        const error = await response.json();
        alert(`Failed to stop run: ${error.error}`);
      }
    } catch (error) {
      alert(`Failed to stop run: ${error.message}`);
    }
  }

  async skipFile(filePath) {
    try {
      await fetch('/api/file/skip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath }),
      });
    } catch (error) {
      console.error('Failed to skip file:', error);
    }
  }

  async viewLogs(runId) {
    try {
      const response = await fetch(`/api/runs/${runId}/logs`);
      const data = await response.json();

      document.getElementById('logsContent').textContent = data.logs || 'No logs available';
      document.getElementById('runLogsTitle').textContent = `Run log #${runId.slice(0, 8)}`;
      this.openModal('logsModal');
    } catch (error) {
      console.error('Failed to fetch logs:', error);
      alert('Failed to load logs');
    }
  }

  async clearCompleted() {
    if (!confirm('Are you sure you want to clear all completed and skipped files?')) {
      return;
    }

    try {
      const response = await fetch('/api/files/clear', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to clear files');
      }

      // State will be updated via WebSocket message
    } catch (error) {
      console.error('Failed to clear files:', error);
      alert('Failed to clear files');
    }
  }

  render() {
    const summary = SubsyncarrDashboard.summarizeRun(
      this.getDisplayRun(),
      this.getDisplayFiles(true),
      this.state.isRunning,
    );
    this.renderSummary(summary);
    this.renderProgress(summary);
    this.renderFiles();
    this.renderEngineStats();
    this.renderHistory(summary);
    this.renderLiveOutput();
    this.updateButtonVisibility();
    this.renderClock();
  }

  renderSummary(summary) {
    const run = this.getDisplayRun();
    const discovering = this.state.isRunning && !run;
    for (const [id, value] of Object.entries({
      metricTotal: summary.total,
      metricProcessing: summary.processing,
      metricCompleted: summary.completed,
      metricSkipped: summary.skipped,
      metricFailed: summary.failed,
    })) {
      document.getElementById(id).textContent = run ? value.toLocaleString() : '—';
    }
    document.getElementById('processingMetric').classList.toggle('active', this.state.isRunning);
    document.getElementById('metricQueued').textContent = discovering
      ? 'Scanning configured folders'
      : this.state.isRunning
        ? `${summary.queued.toLocaleString()} files queued`
        : 'No active processing';
    document.getElementById('summaryScope').textContent = discovering
      ? 'Discovering subtitle files…'
      : run
        ? `${this.state.isRunning ? 'Current run' : 'Latest run'} · ${new Date(run.start_time).toLocaleString()} · ${run.status}`
        : 'Ready to synchronize. Start a full run or choose a folder.';
    document.getElementById('engineScope').textContent = this.state.isRunning ? 'This run' : 'Latest run';
  }

  renderClock() {
    const run = this.getDisplayRun();
    const end = run?.end_time || (this.state.isRunning ? Date.now() : null);
    document.getElementById('metricElapsed').textContent =
      run && end ? SubsyncarrDashboard.formatDuration(end - run.start_time) : '—';
    document.getElementById('metricStarted').textContent = run
      ? `Started ${new Date(run.start_time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
      : 'No run yet';
    document.getElementById('lastUpdated').textContent = this.lastStateAt
      ? `Updated ${SubsyncarrDashboard.formatDuration(Date.now() - this.lastStateAt)} ago`
      : 'Waiting for server';
  }

  renderEngineStats() {
    const files = this.getDisplayFiles(true);
    const names = this.getEngineNames(files);
    const run = this.getDisplayRun();
    const available = !run || this.state.currentRun || this.historyCache[run.id]?.detailsAvailable;
    const stats = SubsyncarrDashboard.engineStats(files, names);
    document.getElementById('engineStats').innerHTML =
      names
        .map((name) =>
          available
            ? `<tr><td>${this.escapeHtml(name)}</td><td class="green">${stats[name].pass}</td><td class="red">${stats[name].fail}</td><td class="amber">${stats[name].skipped}</td></tr>`
            : `<tr><td>${this.escapeHtml(name)}</td><td colspan="3" class="muted" title="File details unavailable">—</td></tr>`,
        )
        .join('') || '<tr><td colspan="4" class="muted">No engine results yet</td></tr>';
    const short = { ffsubsync: 'F', autosubsync: 'Au', alass: 'Al', subsync: 'S' };
    document.getElementById('engineLegend').innerHTML =
      names
        .map((name) => `<span><strong>${short[name] || this.escapeHtml(name)}</strong> ${this.escapeHtml(name)}</span>`)
        .join('') + '<span>✓ passed · × failed · ↷ skipped · • active · − waiting</span>';
    document.getElementById('engineCount').textContent = this.config
      ? `${this.enabledEngines.length} engines configured now`
      : '';
  }

  renderLiveOutput() {
    const toggle = document.getElementById('logToggle');
    toggle.textContent = this.logsPaused ? 'Resume view' : 'Pause view';
    toggle.setAttribute('aria-pressed', String(this.logsPaused));
    document.getElementById('liveOutputScope').textContent = this.logsPaused
      ? '/ view paused; still collecting'
      : '/ all active files';
    if (this.logsPaused) return;
    const output = document.getElementById('liveOutput');
    output.innerHTML =
      this.liveLines
        .map(
          (entry) =>
            `<div class="log-entry"><time>${entry.time ? new Date(entry.time).toLocaleTimeString() : ''}</time><span class="log-file" title="${this.escapeHtml(entry.filePath)}">${this.escapeHtml(this.basename(entry.filePath))}</span><span class="log-message">${this.escapeHtml(entry.log)}</span></div>`,
        )
        .join('') ||
      '<span class="quiet">Waiting for engine output. Historical output is available in run and file logs.</span>';
    output.scrollTop = output.scrollHeight;
  }

  fileAction(path, action, label, extra = '') {
    return `<button class="btn small" type="button" data-action="${action}" data-path="${this.escapeHtml(path)}" ${extra}>${label}</button>`;
  }

  engineChips(file, engineNames) {
    const results = SubsyncarrDashboard.engineResults(file.engines);
    const names = [...new Set([...engineNames, ...Object.keys(results)])];
    const short = { ffsubsync: 'F', autosubsync: 'Au', alass: 'Al', subsync: 'S' };
    return (
      '<div class="engines">' +
      names
        .map((name) => {
          const result = results[name];
          const running = this.state.isRunning && file.status === 'processing' && file.current_engine === name;
          const status = result ? (result.skipped ? 'skipped' : result.success ? 'ok' : 'fail') : running ? 'busy' : '';
          const symbol = result ? (result.skipped ? '↷' : result.success ? '✓' : '×') : running ? '•' : '−';
          const title = `${name}: ${result?.message || (running ? 'processing' : 'no result recorded')}${result?.duration != null ? ` (${SubsyncarrDashboard.formatDuration(result.duration)})` : ''}`;
          const reset =
            result?.skipped && !result.success
              ? `<button type="button" class="engine-reset" data-action="reset" data-path="${this.escapeHtml(file.file_path)}" data-engine="${this.escapeHtml(name)}" aria-label="Reset ${this.escapeHtml(name)} skip for ${this.escapeHtml(this.basename(file.file_path))}">↻</button>`
              : '';
          return `<span class="engine ${status} ${reset ? 'resettable' : ''}" title="${this.escapeHtml(title)}" aria-label="${this.escapeHtml(title)}">${short[name] || this.escapeHtml(name)} ${symbol}${reset}</span>`;
        })
        .join('') +
      '</div>'
    );
  }

  fileTime(file) {
    const durations = Object.values(SubsyncarrDashboard.parseEngines(file.engines))
      .map((result) => result.duration)
      .filter(Number.isFinite);
    return durations.length
      ? SubsyncarrDashboard.formatDuration(durations.reduce((total, duration) => total + duration, 0))
      : '—';
  }

  fileNameCell(file) {
    return `<div class="file-name" title="${this.escapeHtml(this.basename(file.file_path))}">${this.escapeHtml(this.cleanFileName(file.file_path))}</div><small title="${this.escapeHtml(file.file_path)}">${this.escapeHtml(file.file_path)}</small>`;
  }

  updateButtonVisibility() {
    document.getElementById('stopRun').classList.toggle('hidden', !this.state.isRunning);
    document.getElementById('startRun').classList.toggle('hidden', this.state.isRunning);
    document.getElementById('startCustom').classList.toggle('hidden', this.state.isRunning);
    for (const id of ['startRun', 'startCustom', 'stopRun']) document.getElementById(id).disabled = !this.connected;
    document.getElementById('viewCurrentRunLogs').disabled = !this.getDisplayRun();
    document.getElementById('clearCompleted').disabled = !this.getDisplayFiles().some((file) =>
      ['completed', 'skipped', 'error'].includes(file.status),
    );
  }

  renderProgress(summary) {
    const run = this.getDisplayRun();
    const discovering = this.state.isRunning && !run;
    document.getElementById('runTitle').textContent = discovering
      ? 'Discovering files'
      : this.state.isRunning
        ? 'Active run'
        : run
          ? 'Latest run'
          : 'Ready to synchronize';
    const status = document.getElementById('runStatus');
    status.className = `status-badge ${this.state.isRunning ? 'running' : ['completed', 'cancelled'].includes(run?.status) ? run.status : 'idle'}`;
    status.textContent = discovering ? 'Discovering' : this.state.isRunning ? 'Processing' : run ? run.status : 'Idle';
    document.getElementById('runId').textContent = run ? `Run #${run.id.slice(0, 8)}` : '';
    document.getElementById('runProgress').classList.toggle('hidden', !run);
    document.getElementById('progressFill').style.width = `${summary.percent}%`;
    document.getElementById('progressBar').setAttribute('aria-valuenow', String(summary.percent));
    document.getElementById('progressPercent').textContent = `${summary.percent}%`;
    document.getElementById('progressText').textContent =
      `${summary.completedEngines.toLocaleString()} / ${summary.totalEngines.toLocaleString()} tasks`;
    document.getElementById('progressDetail').textContent =
      `${summary.completed} completed · ${summary.skipped} skipped · ${summary.failed} failed`;
  }

  renderFiles() {
    const files = this.getDisplayFiles();
    const run = this.getDisplayRun();
    const unavailable = run && !this.state.currentRun && this.historyCache[run.id]?.detailsAvailable === false;
    const engineNames = this.getEngineNames(this.getDisplayFiles(true));
    const processing = this.state.isRunning ? files.filter((file) => file.status === 'processing') : [];
    document.getElementById('filesInProgress').innerHTML =
      processing
        .map((file) => {
          const logs = this.fileLogs[file.file_path] || [];
          const latest = logs[logs.length - 1] || 'Waiting for engine output';
          return `<tr><td class="file">${this.fileNameCell(file)}</td><td><span class="tag running">${this.escapeHtml(file.current_engine || 'Starting')}</span><div class="file-stage" title="${this.escapeHtml(latest)}">${this.escapeHtml(latest)}</div></td><td>${this.engineChips(file, engineNames)}</td><td class="file-engine-time">${this.fileTime(file)}</td><td><div class="file-actions">${this.fileAction(file.file_path, 'log', 'Log')}${this.fileAction(file.file_path, 'skip', 'Skip')}</div></td></tr>`;
        })
        .join('') ||
      `<tr><td colspan="5" class="empty-state"><strong>${this.state.isRunning ? 'Preparing files for processing' : 'No active processing'}</strong>${this.state.isRunning ? 'Waiting for the next file update.' : 'Start a full run or choose a folder to synchronize.'}</td></tr>`;
    const completed = files.filter((file) => ['completed', 'skipped', 'error'].includes(file.status));
    const filtered = SubsyncarrDashboard.filterFiles(
      completed,
      document.getElementById('fileSearch').value,
      document.getElementById('statusFilter').value,
    );
    const visible = filtered.slice(0, this.resultsLimit);
    document.getElementById('completedCount').textContent = completed.length.toLocaleString();
    document.getElementById('completedList').innerHTML =
      visible
        .map((file) => {
          const engines = SubsyncarrDashboard.parseEngines(file.engines);
          const failures = Object.entries(engines).filter(([, result]) => !result.success && !result.skipped);
          const skips = Object.entries(engines).filter(([, result]) => result.skipped);
          const messages = failures.length
            ? failures.map(([name, result]) => `${name}: ${result.message || 'failed'}`).join(' · ')
            : skips.length
              ? skips.map(([name, result]) => `${name}: ${result.message || 'skipped'}`).join(' · ')
              : '';
          const detail =
            messages ||
            (file.status === 'skipped'
              ? 'Already synchronized or skipped'
              : file.status === 'error'
                ? 'See file log for details'
                : `${Object.values(engines).filter((result) => result.success && !result.skipped).length} engines passed`);
          const status = {
            completed: ['ok', '✓ Completed'],
            skipped: ['warn', '↷ Skipped'],
            error: ['fail', '× Failed'],
          }[file.status];
          return `<tr><td class="file">${this.fileNameCell(file)}</td><td><span class="tag ${status[0]}">${status[1]}</span></td><td>${this.engineChips(file, engineNames)}</td><td><div class="file-detail ${failures.length ? 'amber' : 'muted'}" title="${this.escapeHtml(detail)}">${this.escapeHtml(detail)}</div></td><td class="file-engine-time">${this.fileTime(file)}</td><td>${this.fileAction(file.file_path, 'log', 'Log')}</td></tr>`;
        })
        .join('') ||
      `<tr><td colspan="6" class="empty-state">${unavailable ? 'File results unavailable. Refresh the page to retry.' : completed.length ? 'No subtitles match these filters.' : 'No file results to display.'}</td></tr>`;
    document.getElementById('resultCount').textContent =
      `Showing ${visible.length} of ${filtered.length} matching files · ${this.state.isRunning ? 'current' : 'latest'} run`;
    document.getElementById('loadMoreResults').classList.toggle('hidden', visible.length >= filtered.length);
  }

  async showFileLog(filePath) {
    const runId = this.getDisplayRun()?.id;
    if (!runId) return;
    const request = ++this.fileLogRequest;
    this.activeModalFile = filePath;
    this.activeModalRunId = runId;
    const isCurrent = () =>
      request === this.fileLogRequest &&
      this.activeModalFile === filePath &&
      this.activeModalRunId === runId &&
      this.getDisplayRun()?.id === runId;
    const file = this.getDisplayFiles(true).find((f) => f.file_path === filePath);
    const fileName = this.basename(filePath);
    document.getElementById('fileLogsTitle').textContent = `Log: ${fileName}`;

    // Render meta
    const metaContainer = document.getElementById('fileLogsMeta');
    metaContainer.innerHTML = `
      <div class="file-logs-meta-item">
        <span class="file-logs-meta-label">Subtitle:</span>
        <span class="file-logs-meta-val">${this.escapeHtml(filePath)}</span>
      </div>
      <div class="file-logs-meta-item">
        <span class="file-logs-meta-label">Video:</span>
        <span class="file-logs-meta-val">${this.escapeHtml(file?.video_path || 'Not detected or not checked')}</span>
      </div>
      <div class="file-logs-meta-item">
        <span class="file-logs-meta-label">Status:</span>
        <span class="file-logs-meta-val"><strong>${file?.status?.toUpperCase() || 'UNKNOWN'}</strong>${file?.current_engine ? ` (Working on ${this.escapeHtml(file.current_engine)})` : ''}</span>
      </div>
    `;

    // Render engines breakdown
    const enginesContainer = document.getElementById('fileLogsEngines');
    if (file && file.engines) {
      const engines = SubsyncarrDashboard.parseEngines(file.engines);
      enginesContainer.innerHTML = this.renderEngineResults(engines, file.file_path);
    } else {
      enginesContainer.innerHTML = '';
    }

    // Load logs: from local memory, or fetch from server
    let logs = this.fileLogs[filePath] || [];
    if (logs.length === 0) {
      try {
        const res = await fetch(`/api/file-logs?path=${encodeURIComponent(filePath)}`);
        if (res.ok) {
          const data = await res.json();
          if (!isCurrent()) return;
          if (data.logs && data.logs.length > 0) {
            logs = data.logs;
            this.fileLogs[filePath] = logs;
          }
        }
      } catch (err) {
        console.error('Error fetching file logs:', err);
      }
    }

    let fullLogText = logs.join('\n');
    if (file && file.engines) {
      const engines = SubsyncarrDashboard.parseEngines(file.engines);
      const engineOutputs = Object.entries(engines)
        .map(([name, res]) => {
          let out = '';
          if (res.stdout) out += `\n--- [${name} STDOUT] ---\n${res.stdout}`;
          if (res.stderr) out += `\n--- [${name} STDERR] ---\n${res.stderr}`;
          return out;
        })
        .filter(Boolean)
        .join('\n');
      if (engineOutputs) {
        fullLogText = (fullLogText ? fullLogText + '\n\n' : '') + engineOutputs;
      }
    }

    if (!isCurrent()) return;
    const contentElem = document.getElementById('fileLogsContent');
    contentElem.textContent = fullLogText || 'No log output recorded for this file yet.';
    contentElem.scrollTop = contentElem.scrollHeight;

    this.openModal('fileLogsModal');
  }

  closeFileLogsModal() {
    this.activeModalFile = null;
    this.closeModal('fileLogsModal');
  }

  renderEngineResults(engines, filePath) {
    const aggregate = engines.all?.message;
    const results = Object.entries(SubsyncarrDashboard.engineResults(engines))
      .map(([name, result]) => {
        const status = result.skipped ? 'skipped' : result.success ? 'success' : 'error';
        const icon = result.skipped ? '↷' : result.success ? '✓' : '×';
        const reset =
          result.skipped && !result.success && filePath
            ? `<button class="btn-reset-skip" type="button" data-action="reset" data-path="${this.escapeHtml(filePath)}" data-engine="${this.escapeHtml(name)}">↻ Reset</button>`
            : '';
        return `<div class="engine-result ${status}"><div class="engine-result-row"><span>${icon} ${this.escapeHtml(name)}</span><span class="duration">${SubsyncarrDashboard.formatDuration(result.duration)}</span>${reset}</div>${result.message ? `<div class="engine-error-message">${this.escapeHtml(result.message)}</div>` : ''}</div>`;
      })
      .join('');
    return results || (aggregate ? `<p class="muted">${this.escapeHtml(aggregate)}</p>` : '');
  }

  async resetSkipStatus(filePath, engine, buttonEl) {
    try {
      const response = await fetch('/api/skip-status/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath, engine }),
      });

      if (!response.ok) {
        throw new Error('Failed to reset skip status');
      }

      if (buttonEl) {
        buttonEl.textContent = '✓ Reset';
        buttonEl.disabled = true;
      }
    } catch (error) {
      console.error('Failed to reset skip status:', error);
      alert('Failed to reset skip status');
    }
  }

  calculateEngineStats(files) {
    return SubsyncarrDashboard.engineStats(files, ['ffsubsync', 'autosubsync', 'alass', 'subsync']);
  }

  renderEngineCell(stats, available = true) {
    if (!available) return '<td class="engine-cell muted" title="File details unavailable">—</td>';
    if (!stats.pass && !stats.fail && !stats.skipped) return '<td class="engine-cell quiet">—</td>';
    return `<td class="engine-cell" title="${stats.pass} passed, ${stats.fail} failed, ${stats.skipped} skipped"><span class="engine-pass">${stats.pass}</span><span class="quiet"> / </span><span class="${stats.fail ? 'engine-fail' : 'quiet'}">${stats.fail}</span>${stats.skipped ? '<span class="amber"> ↷</span>' : ''}</td>`;
  }

  renderHistory(currentSummary) {
    const runs = [...this.history];
    const current = this.state.currentRun;
    if (current) {
      const index = runs.findIndex((run) => run.id === current.id);
      if (index >= 0) runs[index] = current;
      else runs.unshift(current);
    }
    document.getElementById('historyCount').textContent = `${runs.length} ${runs.length === 1 ? 'run' : 'runs'}`;
    document.getElementById('historyBody').innerHTML =
      runs
        .map((run) => {
          const live = current?.id === run.id;
          const cached = this.historyCache[run.id];
          const files = live ? this.runFiles : cached?.files || [];
          const stats = live ? this.calculateEngineStats(files) : cached?.engineStats || this.calculateEngineStats([]);
          const counts = live
            ? currentSummary || SubsyncarrDashboard.summarizeRun(run, files, this.state.isRunning)
            : run;
          const detailsAvailable = live || cached?.detailsAvailable;
          const statCell = (value, category, color) =>
            `<td>${value > 0 && detailsAvailable ? `<button class="stat-clickable ${color}" type="button" data-action="file-list" data-run="${this.escapeHtml(run.id)}" data-category="${category}">${value}</button>` : `<span class="${color}">${value}</span>`}</td>`;
          const duration = run.end_time
            ? SubsyncarrDashboard.formatDuration(run.end_time - run.start_time)
            : live && this.state.isRunning
              ? SubsyncarrDashboard.formatDuration(Date.now() - run.start_time)
              : '—';
          const status = ['running', 'completed', 'cancelled'].includes(run.status) ? run.status : 'idle';
          return `<tr><td title="${this.escapeHtml(new Date(run.start_time).toLocaleString())}">${this.escapeHtml(new Date(run.start_time).toLocaleString())}</td><td><span class="status-badge ${status}">${this.escapeHtml(run.status)}</span></td><td>${run.total_files}</td>${statCell(counts.completed, 'completed', 'stat-completed')}${statCell(counts.skipped, 'skipped', 'stat-skipped')}${statCell(counts.failed, 'failed', 'stat-failed')}${['ffsubsync', 'autosubsync', 'alass', 'subsync'].map((name) => this.renderEngineCell(stats[name], detailsAvailable)).join('')}<td class="mono muted">${duration}</td><td><button class="btn small" type="button" data-action="run-log" data-run="${this.escapeHtml(run.id)}">Logs</button></td></tr>`;
        })
        .join('') || '<tr><td colspan="12" class="no-data">No runs yet. Your scan history will appear here.</td></tr>';
  }

  basename(path) {
    return path.split('/').pop();
  }

  // Extract clean movie/show title from filename
  cleanFileName(filePath) {
    // Get just the filename from the path
    let name = filePath.split('/').pop();

    // Remove file extension (.srt, .eng.srt, .eng.sdh.srt, etc.)
    name = name.replace(/\.(?:[a-z]{2,3}\.)?(?:(?:forced|sdh|cc)\.)?(?:srt|sub|ass|ssa|vtt)$/i, '');
    name = name.replace(/\.(srt|sub|ass|ssa|vtt)$/i, '');

    // Try to extract just the title with year
    // Pattern: "Movie Title (Year)" followed by metadata in brackets
    const titleMatch = name.match(/^(.+?\s*\(\d{4}\))/);
    if (titleMatch) {
      return titleMatch[1].trim();
    }

    // Fallback: remove common metadata patterns
    // Remove [imdbid-...], [Bluray-...], [AAC ...], [x265], etc.
    name = name.replace(/\s*\[.*?\]/g, '');
    // Remove release group tags at the end like -DDR, -YTS.MX
    name = name.replace(/\s*-[A-Za-z0-9.]+$/, '');
    // Clean up extra whitespace
    name = name.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();

    return name || filePath.split('/').pop();
  }

  // Show files in a category for a specific run
  showFileList(runId, category) {
    const run =
      this.state.currentRun?.id === runId
        ? { ...this.state.currentRun, files: this.runFiles }
        : this.historyCache[runId];
    if (!run || !run.files) {
      alert('File data not available for this run');
      return;
    }

    let files = [];
    let title = '';

    switch (category) {
      case 'completed':
        files = run.files.filter((f) => f.status === 'completed');
        title = `Completed Files (${files.length})`;
        break;
      case 'skipped':
        files = run.files.filter((f) => f.status === 'skipped');
        title = `Skipped Files (${files.length > 0 ? files.length : run.skipped || 0})`;
        break;
      case 'failed':
        files = run.files.filter((f) => f.status === 'error');
        title = `Failed Files (${files.length})`;
        break;
      default:
        return;
    }

    document.getElementById('fileListTitle').textContent = title;

    if (files.length === 0) {
      if (category === 'skipped' && run.skipped > 0) {
        document.getElementById('fileListContent').innerHTML =
          `<div class="file-list-empty">All ${run.skipped} file(s) were already synchronized prior to this run (subtitles already exist on disk).</div>`;
      } else {
        document.getElementById('fileListContent').innerHTML =
          '<div class="file-list-empty">No files in this category</div>';
      }
    } else {
      const html = files
        .map((file) => {
          const name = this.cleanFileName(file.file_path);
          const errors = category === 'failed' ? this.renderFileErrors(file) : '';
          const skipReason = category === 'skipped' ? this.renderFileSkipReason(file) : '';
          return `<div class="file-list-item">
            <div class="file-list-item-name">${this.escapeHtml(name)}</div>
            ${skipReason}
            ${errors}
          </div>`;
        })
        .join('');
      document.getElementById('fileListContent').innerHTML = html;
    }

    this.openModal('fileListModal');
  }

  renderFileSkipReason(file) {
    let engines = {};
    try {
      engines = SubsyncarrDashboard.parseEngines(file.engines);
    } catch {
      // ignore
    }
    const reasons = Object.entries(engines)
      .filter(([, res]) => res && res.skipped)
      .map(([name, res]) => `${name}: ${res.message || 'skipped'}`);

    if (reasons.length > 0) {
      return `<div class="file-list-skip-detail">${this.escapeHtml(reasons.join(' • '))}</div>`;
    }
    return `<div class="file-list-skip-detail">Already synchronized on disk</div>`;
  }

  // Render the error messages for each engine that failed on a file
  renderFileErrors(file) {
    let engines;
    try {
      engines = SubsyncarrDashboard.parseEngines(file.engines);
    } catch {
      return '';
    }

    const failures = Object.entries(engines).filter(([, result]) => result && result.success === false);

    if (failures.length === 0) {
      return '';
    }

    return `<div class="file-list-errors">${failures
      .map(([name, result]) => {
        const message = result.message || 'Unknown error';
        const stderr = result.stderr ? `<pre class="file-error-detail">${this.escapeHtml(result.stderr)}</pre>` : '';
        return `<div class="file-error">
          <span class="file-error-engine">${this.escapeHtml(name)}</span>
          <span class="file-error-message">${this.escapeHtml(message)}</span>
          ${stderr}
        </div>`;
      })
      .join('')}</div>`;
  }
}

// Initialize client when DOM is ready
let client;
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    client = new SubsyncarrPlusClient();
  });
} else {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  client = new SubsyncarrPlusClient();
}

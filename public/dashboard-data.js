/* Shared by the browser and the dashboard regression tests. */
(function (root) {
  function parseEngines(value) {
    try {
      const engines = typeof value === 'string' ? JSON.parse(value) : value;
      if (!engines || typeof engines !== 'object' || Array.isArray(engines)) return {};
      return Object.fromEntries(Object.entries(engines).filter(([, result]) => result && typeof result === 'object'));
    } catch {
      return {};
    }
  }

  function engineResults(value) {
    // Pre-synced rows use "all" as a file-level marker, not an engine attempt.
    return Object.fromEntries(Object.entries(parseEngines(value)).filter(([name]) => name !== 'all'));
  }

  function summarizeRun(run, files, isRunning) {
    const count = (status) => files.filter((file) => file.status === status).length;
    const totalEngines = Math.max(0, run?.total_engines || 0);
    const reported = files.reduce((sum, file) => sum + Object.keys(engineResults(file.engines)).length, 0);
    const completedEngines = Math.min(totalEngines, Math.max(run?.completed_engines || 0, reported));
    return {
      total: run?.total_files || 0,
      processing: isRunning ? count('processing') : 0,
      queued: isRunning ? count('pending') : 0,
      completed: Math.max(run?.completed || 0, count('completed')),
      skipped: Math.max(run?.skipped || 0, count('skipped')),
      failed: Math.max(run?.failed || 0, count('error')),
      totalEngines,
      completedEngines,
      percent: totalEngines > 0 ? Math.round((completedEngines / totalEngines) * 100) : 0,
    };
  }

  function engineStats(files, names) {
    const stats = Object.fromEntries(
      names.filter((name) => name !== 'all').map((name) => [name, { pass: 0, fail: 0, skipped: 0 }]),
    );
    files.forEach((file) => {
      Object.entries(engineResults(file.engines)).forEach(([name, result]) => {
        if (!Object.hasOwn(stats, name)) stats[name] = { pass: 0, fail: 0, skipped: 0 };
        if (result.skipped) stats[name].skipped++;
        else if (result.success === true) stats[name].pass++;
        else if (result.success === false) stats[name].fail++;
      });
    });
    return stats;
  }

  function filterFiles(files, query, status) {
    const search = query.trim().toLowerCase();
    return files
      .filter((file) => (status === 'all' || file.status === status) && file.file_path.toLowerCase().includes(search))
      .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
  }

  function formatDuration(milliseconds) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return '—';
    const seconds = Math.floor(milliseconds / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  }

  const helpers = { parseEngines, engineResults, summarizeRun, engineStats, filterFiles, formatDuration };
  if (typeof module !== 'undefined' && module.exports) module.exports = helpers;
  else root.SubsyncarrDashboard = helpers;
})(globalThis);

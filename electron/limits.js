'use strict';

// Daily time limit and allowed-hours schedule.

function parseHM(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function localDay(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function evaluate({ settings, usedSeconds, now = new Date() }) {
  if (settings.schedule_enabled === '1') {
    const start = parseHM(settings.schedule_start);
    const end = parseHM(settings.schedule_end);
    if (start !== null && end !== null && start !== end) {
      const cur = now.getHours() * 60 + now.getMinutes();
      const inside = start < end ? cur >= start && cur < end : cur >= start || cur < end;
      if (!inside) {
        return {
          allowed: false,
          reason: 'schedule',
          message: `The library is open from ${settings.schedule_start} to ${settings.schedule_end}. See you then!`,
          remainingMinutes: null,
        };
      }
    }
  }

  const limit = parseInt(settings.daily_limit_minutes, 10);
  if (limit > 0) {
    const remaining = limit * 60 - usedSeconds;
    if (remaining <= 0) {
      return {
        allowed: false,
        reason: 'limit',
        message: "You've used all your library time for today. Great job learning!",
        remainingMinutes: 0,
      };
    }
    return { allowed: true, reason: '', message: '', remainingMinutes: Math.ceil(remaining / 60) };
  }
  return { allowed: true, reason: '', message: '', remainingMinutes: null };
}

module.exports = { evaluate, parseHM, localDay };

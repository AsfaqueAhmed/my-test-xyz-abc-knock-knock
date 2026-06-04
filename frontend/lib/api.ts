import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

export const api = axios.create({
  baseURL: API_URL,
  timeout: 10000,
});

// Helpers
export async function fetchDashboard() {
  const { data } = await api.get('/dashboard');
  return data;
}

export async function fetchPositions(status?: string) {
  const { data } = await api.get('/positions', { params: { status } });
  return data;
}

export async function closePosition(id: string) {
  const { data } = await api.post('/positions/close', { id });
  return data;
}

export async function fetchSignals(live = false) {
  const { data } = await api.get('/signals', { params: { live } });
  return data;
}

export async function fetchTrades(period: string = 'week') {
  const { data } = await api.get('/trades', { params: { period } });
  return data;
}

export async function fetchAnalytics(days = 30) {
  const { data } = await api.get('/analytics', { params: { days } });
  return data;
}

export async function fetchRisk() {
  const { data } = await api.get('/risk');
  return data;
}

export async function fetchConfig() {
  const { data } = await api.get('/config');
  return data;
}

export async function updateConfig(config: any) {
  const { data } = await api.put('/config', config);
  return data;
}

export async function fetchHealth() {
  const { data } = await api.get('/health');
  return data;
}

export async function fetchTickers() {
  const { data } = await api.get('/market/tickers');
  return data;
}

export async function fetchNotifications() {
  const { data } = await api.get('/notifications');
  return data;
}

export async function botStart() { return api.post('/bot/start'); }
export async function botStop() { return api.post('/bot/stop'); }
export async function botPause() { return api.post('/bot/pause'); }
export async function botResume() { return api.post('/bot/resume'); }
export async function botCloseAll() { return api.post('/bot/close-all'); }
export async function botEmergencyStop() { return api.post('/bot/emergency-stop'); }

export function formatCurrency(n: number, decimals = 2): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

export function formatPct(n: number, decimals = 2): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(decimals)}%`;
}

export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ');
}

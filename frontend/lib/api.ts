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

export async function fetchMarketTokens() {
  const { data } = await api.get('/market/tokens');
  return data as MarketToken[];
}

export interface MarketToken {
  symbol: string;
  name: string;
  price: number;
  change30s: number;
  change1m: number;
  change5m: number;
  change10m: number;
  change15m: number;
  change30m: number;
  change24h: number;
  volume24h: number;
  updatedAt: string | null;
}

export async function fetchNotifications() {
  const { data } = await api.get('/notifications');
  return data;
}

export async function fetchLogs(params?: {
  limit?: number;
  category?: string;
  level?: string;
  symbol?: string;
  event?: string;
}) {
  const { data } = await api.get('/logs', { params });
  return data as BotLog[];
}

export interface BotLog {
  id: string;
  createdAt: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  category: 'BOT' | 'POSITION' | 'RISK' | 'SYSTEM';
  event: string;
  symbol: string | null;
  message: string;
  metadata: Record<string, unknown> | null;
}

export interface ManualTradeCheck {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  price: number;
  maxSafePositionSize: number;
  effectiveMax: number;
  reasons: string[];
}

export interface ManualTradeResult {
  success: boolean;
  symbol: string;
  side: string;
  price: number;
  capital: number;
  maxSafePositionSize: number;
  quantity: number;
}

export async function checkManualTrade(symbol: string, direction: 'LONG' | 'SHORT'): Promise<ManualTradeCheck> {
  const { data } = await api.get(`/trades/manual/check/${symbol}`, { params: { direction } });
  return data;
}

export async function manualTrade(symbol: string, direction: 'LONG' | 'SHORT', amount?: number): Promise<ManualTradeResult> {
  const { data } = await api.post('/trades/manual', { symbol, direction, amount });
  return data;
}

export interface BalanceStats {
  currentBalance: number;
  totalDeposited: number;
  totalWithdrawn: number;
  totalPnl: number;
  totalFees: number;
  tradeCount: number;
}

export interface LedgerEntry {
  id: string;
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'TRADE_OPEN' | 'TRADE_CLOSE';
  amount: number;
  balanceAfter: number;
  symbol: string | null;
  positionId: string | null;
  description: string;
  createdAt: string;
}

export interface LedgerPage {
  entries: LedgerEntry[];
  total: number;
  balance: number;
}

export async function fetchBalanceStats(): Promise<BalanceStats> {
  const { data } = await api.get('/balance');
  return data;
}

export async function fetchLedger(limit = 50, offset = 0): Promise<LedgerPage> {
  const { data } = await api.get('/balance/ledger', { params: { limit, offset } });
  return data;
}

export async function depositBalance(amount: number, description?: string): Promise<LedgerEntry> {
  const { data } = await api.post('/balance/deposit', { amount, description });
  return data;
}

export async function withdrawBalance(amount: number, description?: string): Promise<LedgerEntry> {
  const { data } = await api.post('/balance/withdraw', { amount, description });
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

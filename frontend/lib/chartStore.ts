import { create } from 'zustand';

interface ChartStore {
  symbol: string | null;
  open: (symbol: string) => void;
  close: () => void;
}

export const useChartStore = create<ChartStore>(set => ({
  symbol: null,
  open: (symbol) => set({ symbol }),
  close: () => set({ symbol: null }),
}));

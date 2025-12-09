
export interface UserRecord {
  username: string;
  agent: string; // 代理
  prize: number;
  date: string; // YYYY-MM-DD
  timestamp: number; // Unix timestamp for 8-hour expiry check
  isScratched: boolean;
  isClaimed: boolean; // 是否已領獎
  ip?: string; // IP Address
}

export interface AdminUser {
  username: string;
  password: string;
  role: 'SUPER' | 'VIEWER';
  lastLogin?: string; // ISO String
}

export interface SiteMessage {
  id: string;
  fromUser: string;
  content: string;
  timestamp: number;
  isRead: boolean;
}

export interface AdminConfig {
  googleSheetUrl: string; // URL for Game Records
  adminSheetUrl: string; // URL for Admin Accounts & Logs (Can be same as above)
  isEnabled: boolean;
}

export enum AppView {
  LOGIN = 'LOGIN',
  GAME = 'GAME',
  ADMIN = 'ADMIN',
}

// Helper to get today's date string in YYYY-MM-DD (local time)
export const getTodayString = (): string => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

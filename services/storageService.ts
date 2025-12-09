
import { UserRecord, getTodayString, AdminUser, AdminConfig } from '../types';

const STORAGE_KEY = 'cny_horse_data_v1';
const ADMIN_CONFIG_KEY = 'cny_admin_config_v17'; // Updated version for New URL
const ADMIN_USERS_KEY = 'cny_admin_users_cache';
const PRIZE_CONFIG_KEY = 'cny_prize_config';
const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;

// Default URLs (Game Record Sheet)
const DEFAULT_SHEET_URL = 'https://script.google.com/macros/s/AKfycbza7xmY4eFHvdDIW9bNVw3grfrp0j89epTMdUwiDbj6CrQhxi0YTqGLhQ0A0u1oCVOZug/exec';
// Default URLs (Admin DB Sheet) - Set to same as Game Sheet for single integration
const DEFAULT_ADMIN_SHEET_URL = DEFAULT_SHEET_URL;

// --- Game Records ---

export const saveRecord = (record: UserRecord): void => {
  const data = loadAllRecords();
  // Filter out records that match BOTH username and date (Case Insensitive)
  const filtered = data.filter(r => !(
      r.username.toLowerCase() === record.username.toLowerCase() && 
      r.date === record.date
  ));
  filtered.push(record);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
};

export const getRecord = (username: string): UserRecord | null => {
  const data = loadAllRecords();
  const today = getTodayString();
  const lowerUser = username.toLowerCase();
  
  // 1. Prioritize looking for TODAY's record (Case Insensitive)
  const todayRecord = data.find(r => r.username.toLowerCase() === lowerUser && r.date === today);
  if (todayRecord) return todayRecord;

  // 2. If no record for today, check for any recent valid record (8 hour rule)
  const anyRecord = data.find(r => r.username.toLowerCase() === lowerUser);
  if (!anyRecord) return null;

  const now = Date.now();
  if (now - anyRecord.timestamp > EIGHT_HOURS_MS) {
    // Expired
    return null; 
  }
  
  // Daily reset check
  if (anyRecord.date !== today) {
      return null;
  }

  return anyRecord;
};

export const getAllRecords = (): UserRecord[] => {
  return loadAllRecords();
};

const loadAllRecords = (): UserRecord[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: UserRecord[] = JSON.parse(raw);
    return parsed;
  } catch (e) {
    console.error("Storage Error", e);
    return [];
  }
};

// --- Admin Config ---

// Unified config saving: One URL for both fields
export const saveAdminConfig = (url: string, isEnabled: boolean) => {
  const config: AdminConfig = {
    googleSheetUrl: url,
    adminSheetUrl: url, // Mirror the URL
    isEnabled
  };
  localStorage.setItem(ADMIN_CONFIG_KEY, JSON.stringify(config));
};

export const getAdminConfig = (): AdminConfig => {
  const raw = localStorage.getItem(ADMIN_CONFIG_KEY);
  if (!raw) {
    return {
      googleSheetUrl: DEFAULT_SHEET_URL,
      adminSheetUrl: DEFAULT_ADMIN_SHEET_URL,
      isEnabled: true
    };
  }
  const parsed = JSON.parse(raw);
  if (!parsed.adminSheetUrl) {
      parsed.adminSheetUrl = parsed.googleSheetUrl || DEFAULT_ADMIN_SHEET_URL;
  }
  return parsed;
};

// --- Admin Users Cache ---

export const saveAdminUsersCache = (users: AdminUser[]) => {
  localStorage.setItem(ADMIN_USERS_KEY, JSON.stringify(users));
};

export const getAdminUsersCache = (): AdminUser[] => {
  const raw = localStorage.getItem(ADMIN_USERS_KEY);
  if (!raw) return [];
  return JSON.parse(raw);
};

// --- Prize Config ---

export const getPrizeConfig = (): number[] => {
  const raw = localStorage.getItem(PRIZE_CONFIG_KEY);
  if (!raw) return [38, 58, 88];
  
  try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
          // Filter valid numbers
          return parsed.map(Number).filter(n => !isNaN(n));
      }
      return [38, 58, 88];
  } catch (e) {
      return [38, 58, 88];
  }
};

export const savePrizeConfig = (prizes: number[]) => {
  localStorage.setItem(PRIZE_CONFIG_KEY, JSON.stringify(prizes));
};

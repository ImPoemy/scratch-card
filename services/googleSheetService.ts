
import { UserRecord, AdminUser, SiteMessage } from '../types';
import { getAdminConfig, savePrizeConfig } from './storageService';

// --- Helper ---
export const getClientIp = async (): Promise<string> => {
    try {
        const response = await fetch('https://api.ipify.org?format=json');
        if (response.ok) {
            const data = await response.json();
            return data.ip || '';
        }
    } catch (e) {
        console.warn("Failed to get IP", e);
    }
    return '';
};

// --- Game Records ---

export const syncToGoogleSheet = async (record: UserRecord): Promise<boolean> => {
  const config = getAdminConfig();
  if (!config || !config.isEnabled || !config.googleSheetUrl) return false;

  try {
    const formData = new FormData();
    formData.append('action', 'save_record'); // Action tag
    formData.append('username', record.username || '');
    formData.append('agent', record.agent || ''); 
    // Use String() constructor and nullish coalescing to prevent "Cannot read properties of null (reading 'toString')"
    formData.append('prize', String(record.prize ?? 0));
    formData.append('date', record.date || '');
    formData.append('timestamp', record.timestamp ? new Date(record.timestamp).toISOString() : new Date().toISOString());
    formData.append('isScratched', String(record.isScratched ?? false));
    formData.append('isClaimed', String(record.isClaimed ?? false));
    formData.append('ip', record.ip || '');

    await fetch(config.googleSheetUrl, { method: 'POST', body: formData, mode: 'no-cors' });
    return true;
  } catch (error) {
    console.error("Failed to sync record", error);
    return false;
  }
};

export const fetchRecordsFromSheet = async (): Promise<UserRecord[]> => {
  const config = getAdminConfig();
  if (!config || !config.isEnabled || !config.googleSheetUrl) return [];

  try {
    const urlStr = config.googleSheetUrl.trim();
    if (!urlStr) return [];
    
    const url = new URL(urlStr);

    url.searchParams.append('type', 'records');
    // Anti-Caching: Add timestamp AND random number to be absolutely sure
    url.searchParams.append('_t', Date.now().toString() + Math.random().toString().substring(2));

    const response = await fetch(url.toString(), { 
        method: 'GET',
        cache: 'no-store' // Critical: Force browser to ignore cache.
    });
    if (!response.ok) throw new Error('Network response was not ok');
    
    const data = await response.json();
    return Array.isArray(data) ? data as UserRecord[] : [];
  } catch (error) {
    // CRITICAL FIX: Throw error instead of returning [] to prevent false negatives.
    // Returning [] would imply "no records found", allowing duplicate play on connection errors.
    // Throwing allows App.tsx to handle the failure scenario properly.
    console.warn("Strict Cloud Verify: Failed to fetch records, rethrowing...", error);
    throw error;
  }
};

// --- Admin Management ---

export const fetchAdminsFromSheet = async (): Promise<AdminUser[]> => {
  const config = getAdminConfig();
  // Fallback to game URL if admin URL is missing, assuming same script handles both
  const targetUrl = config.adminSheetUrl ? config.adminSheetUrl.trim() : config.googleSheetUrl ? config.googleSheetUrl.trim() : '';
  
  if (!config.isEnabled || !targetUrl) return [];

  try {
    const url = new URL(targetUrl);
    url.searchParams.append('type', 'admins');
    url.searchParams.append('_t', Date.now().toString());

    const response = await fetch(url.toString(), { 
        method: 'GET',
        cache: 'no-store'
    });
    if (!response.ok) throw new Error('Network err');
    
    const data = await response.json();
    return Array.isArray(data) ? data as AdminUser[] : [];
  } catch (error) {
    console.warn("Failed to fetch admins", error);
    return [];
  }
};

export const syncAdminData = async (admin: AdminUser, operation: 'add' | 'update' | 'delete'): Promise<boolean> => {
  const config = getAdminConfig();
  const targetUrl = config.adminSheetUrl ? config.adminSheetUrl.trim() : config.googleSheetUrl ? config.googleSheetUrl.trim() : '';

  if (!config.isEnabled || !targetUrl) return false;

  try {
    const formData = new FormData();
    formData.append('action', 'manage_admin');
    formData.append('operation', operation);
    formData.append('username', admin.username);
    formData.append('password', admin.password);
    formData.append('role', admin.role);

    await fetch(targetUrl, { method: 'POST', body: formData, mode: 'no-cors' });
    return true;
  } catch (error) {
    console.error("Failed to sync admin data", error);
    return false;
  }
};

export const logAdminLogin = async (username: string): Promise<boolean> => {
  const config = getAdminConfig();
  const targetUrl = config.adminSheetUrl ? config.adminSheetUrl.trim() : config.googleSheetUrl ? config.googleSheetUrl.trim() : '';
  
  if (!config.isEnabled || !targetUrl) return false;

  try {
    const formData = new FormData();
    formData.append('action', 'log_login');
    formData.append('username', username);
    formData.append('timestamp', new Date().toISOString());

    await fetch(targetUrl, { method: 'POST', body: formData, mode: 'no-cors' });
    return true;
  } catch (e) {
    console.error("Log login failed", e);
    return false;
  }
};

// --- Site Messages ---

export const sendSiteMessage = async (fromUser: string, content: string): Promise<boolean> => {
  const config = getAdminConfig();
  const targetUrl = config.adminSheetUrl ? config.adminSheetUrl.trim() : config.googleSheetUrl ? config.googleSheetUrl.trim() : '';
  
  if (!config.isEnabled || !targetUrl) return false;

  try {
    const formData = new FormData();
    formData.append('action', 'send_message');
    formData.append('fromUser', fromUser);
    formData.append('content', content);
    formData.append('timestamp', Date.now().toString());

    await fetch(targetUrl, { method: 'POST', body: formData, mode: 'no-cors' });
    return true;
  } catch (e) {
    console.error("Send message failed", e);
    return false;
  }
};

export const fetchSiteMessages = async (): Promise<SiteMessage[]> => {
  const config = getAdminConfig();
  const targetUrl = config.adminSheetUrl ? config.adminSheetUrl.trim() : config.googleSheetUrl ? config.googleSheetUrl.trim() : '';
  
  if (!config.isEnabled || !targetUrl) return [];

  try {
    const url = new URL(targetUrl);
    url.searchParams.append('type', 'messages');
    url.searchParams.append('_t', Date.now().toString());

    const response = await fetch(url.toString(), { 
        method: 'GET',
        cache: 'no-store'
    });
    if (!response.ok) throw new Error('Network err');
    
    const data = await response.json();
    return Array.isArray(data) ? data as SiteMessage[] : [];
  } catch (error) {
    console.warn("Failed to fetch messages", error);
    return [];
  }
};

export const markMessageRead = async (messageId: string): Promise<boolean> => {
  const config = getAdminConfig();
  const targetUrl = config.adminSheetUrl ? config.adminSheetUrl.trim() : config.googleSheetUrl ? config.googleSheetUrl.trim() : '';
  
  if (!config.isEnabled || !targetUrl) return false;

  try {
    const formData = new FormData();
    formData.append('action', 'mark_read');
    formData.append('id', messageId);

    await fetch(targetUrl, { method: 'POST', body: formData, mode: 'no-cors' });
    return true;
  } catch (e) {
    console.error("Mark read failed", e);
    return false;
  }
};

// --- Prize Config ---

export const fetchPrizeConfig = async (): Promise<number[]> => {
    const config = getAdminConfig();
    const targetUrl = config.adminSheetUrl ? config.adminSheetUrl.trim() : config.googleSheetUrl ? config.googleSheetUrl.trim() : '';
    if (!config.isEnabled || !targetUrl) return [];

    try {
        const url = new URL(targetUrl);
        url.searchParams.append('type', 'prizes');
        url.searchParams.append('_t', Date.now().toString());

        const response = await fetch(url.toString(), { method: 'GET', cache: 'no-store' });
        if (!response.ok) return [];
        const data = await response.json();
        // Filter out NaN and 0 values
        return Array.isArray(data) ? data.map(Number).filter(n => !isNaN(n)) : [];
    } catch (e) {
        console.warn("Failed to fetch prizes", e);
        return [];
    }
};

export const syncPrizeConfig = async (prizes: number[]): Promise<boolean> => {
    const config = getAdminConfig();
    const targetUrl = config.adminSheetUrl ? config.adminSheetUrl.trim() : config.googleSheetUrl ? config.googleSheetUrl.trim() : '';
    if (!config.isEnabled || !targetUrl) return false;

    try {
        const formData = new FormData();
        formData.append('action', 'save_prizes');
        formData.append('prizes', JSON.stringify(prizes));
        
        await fetch(targetUrl, { method: 'POST', body: formData, mode: 'no-cors' });
        savePrizeConfig(prizes); // Save local copy
        return true;
    } catch (e) {
        console.error("Sync prizes failed", e);
        return false;
    }
};

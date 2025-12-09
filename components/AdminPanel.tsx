
import React, { useState, useEffect } from 'react';
import { saveAdminConfig, getAdminConfig, saveRecord, saveAdminUsersCache, getPrizeConfig, savePrizeConfig } from '../services/storageService';
import { syncToGoogleSheet, fetchRecordsFromSheet, fetchAdminsFromSheet, syncAdminData, logAdminLogin, sendSiteMessage, fetchSiteMessages, markMessageRead, fetchPrizeConfig, syncPrizeConfig } from '../services/googleSheetService';
import { UserRecord, AdminUser, SiteMessage } from '../types';

interface AdminPanelProps {
  onBack: () => void;
}

type AdminRole = 'SUPER' | 'VIEWER' | null;
type Tab = 'RECORDS' | 'ADMINS' | 'MESSAGES' | 'PRIZES' | 'SETTINGS';

const AdminPanel: React.FC<AdminPanelProps> = ({ onBack }) => {
  // Login State
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [adminRole, setAdminRole] = useState<AdminRole>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  
  // Dashboard Data
  const [records, setRecords] = useState<UserRecord[]>([]);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('RECORDS');

  // Messages (Inbox)
  const [messages, setMessages] = useState<SiteMessage[]>([]);

  // Config State
  const [sheetUrl, setSheetUrl] = useState('');
  const [isEnabled, setIsEnabled] = useState(true);
  
  // Prize Config State
  const [prizes, setPrizes] = useState<number[]>([]);
  const [localPrizes, setLocalPrizes] = useState<number[]>([]); // For editing
  const [newPrizeAmount, setNewPrizeAmount] = useState('');
  
  // UI State
  const [message, setMessage] = useState('');
  const [showScript, setShowScript] = useState(false);
  
  // Security / Password Change
  const [showSecurityPrompt, setShowSecurityPrompt] = useState(false);
  const [securityPassword, setSecurityPassword] = useState('');
  const [securityAction, setSecurityAction] = useState<'SAVE_CONFIG' | 'CHANGE_PASSWORD' | 'SAVE_PRIZES' | null>(null);
  const [isPasswordChanging, setIsPasswordChanging] = useState(false);
  
  // Password Change State
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);

  // Admin Management State
  const [newAdminUser, setNewAdminUser] = useState('');
  const [newAdminPass, setNewAdminPass] = useState('');
  const [newAdminRole, setNewAdminRole] = useState<'SUPER' | 'VIEWER'>('VIEWER');
  
  // Batch Add State
  const [addMode, setAddMode] = useState<'SINGLE' | 'BATCH'>('SINGLE');
  const [batchInput, setBatchInput] = useState('');

  useEffect(() => {
    // Load config
    const config = getAdminConfig();
    if (config) {
      setSheetUrl(config.googleSheetUrl || '');
      setIsEnabled(config.isEnabled !== false);
    }
  }, []);

  // Poll for messages if Super Admin
  useEffect(() => {
    let interval: any;
    if (isAuthenticated && adminRole === 'SUPER') {
        refreshMessages();
        loadPrizes();
        interval = setInterval(refreshMessages, 30000); // Check every 30s
    }
    return () => clearInterval(interval);
  }, [isAuthenticated, adminRole]);

  const refreshRecords = async () => {
    setIsLoading(true);
    try {
        const cloudRecords = await fetchRecordsFromSheet();
        setRecords(cloudRecords.sort((a, b) => b.timestamp - a.timestamp));
    } catch (e) {
        console.warn("Load records error", e);
    } finally {
        setIsLoading(false);
    }
  };

  const refreshAdmins = async () => {
      setIsLoading(true);
      try {
          const admins = await fetchAdminsFromSheet();
          setAdminUsers(admins);
          saveAdminUsersCache(admins); // Update local cache
          
          // Auto-sync default admins if list is empty (first run on new sheet)
          if (admins.length === 0) {
              await syncDefaultAdmins();
          }
      } catch (e) {
          console.warn(e);
      } finally {
          setIsLoading(false);
      }
  };

  const refreshMessages = async () => {
      if (adminRole !== 'SUPER') return;
      try {
          const msgs = await fetchSiteMessages();
          setMessages(msgs.sort((a, b) => b.timestamp - a.timestamp));
      } catch (e) {
          console.warn("Load messages error", e);
      }
  };
  
  const loadPrizes = async () => {
      // Try local first for instant UI
      const local = getPrizeConfig().filter(n => !isNaN(n)); // Double check
      setPrizes(local);
      setLocalPrizes(local); // Initialize edit state
      
      // Then sync from cloud
      try {
          const cloudPrizes = await fetchPrizeConfig();
          if (cloudPrizes.length > 0) {
              const cleanPrizes = cloudPrizes.filter(n => !isNaN(n));
              setPrizes(cleanPrizes);
              setLocalPrizes(cleanPrizes); // Update edit state
              savePrizeConfig(cleanPrizes);
          }
      } catch (e) {
          console.warn("Failed to load prizes", e);
      }
  };

  const syncDefaultAdmins = async () => {
      // Define all required admins
      const defaultAdmins: AdminUser[] = [
          { username: 'Poemy', password: '032002', role: 'SUPER' },
          { username: 'HG', password: '2358', role: 'SUPER' },
          { username: 'HG588', password: 'HG588', role: 'VIEWER' },
          { username: 'HG865', password: 'HG865', role: 'VIEWER' },
          { username: 'HG863', password: 'HG863', role: 'VIEWER' }
      ];

      console.log("Initializing default admins to cloud DB...");
      for (const admin of defaultAdmins) {
          await syncAdminData(admin, 'add');
      }
      // Reload after sync
      const updated = await fetchAdminsFromSheet();
      setAdminUsers(updated);
      saveAdminUsersCache(updated);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');
    setIsLoggingIn(true);

    try {
        // 1. Fetch latest admins from sheet
        let currentAdmins = await fetchAdminsFromSheet();
        
        // 2. If empty (new sheet), try cache or use defaults locally first for initial login
        if (currentAdmins.length === 0) {
             const defaults: AdminUser[] = [
                { username: 'Poemy', password: '032002', role: 'SUPER' },
                { username: 'HG', password: '2358', role: 'SUPER' },
                { username: 'HG588', password: 'HG588', role: 'VIEWER' },
                { username: 'HG865', password: 'HG865', role: 'VIEWER' },
                { username: 'HG863', password: 'HG863', role: 'VIEWER' }
             ];
             currentAdmins = defaults;
        }

        // FAILSAFE: Always allow Poemy/032002 (Restoration mechanism)
        if (usernameInput === 'Poemy' && passwordInput === '032002') {
             setAdminRole('SUPER');
             setIsAuthenticated(true);
             setAdminUsers(currentAdmins);
             logAdminLogin(usernameInput);
             refreshRecords();
             refreshAdmins();

             // Auto-repair: If sheet data is incorrect/missing for Poemy, fix it now.
             const sheetPoemy = currentAdmins.find(u => u.username === 'Poemy');
             if (!sheetPoemy || sheetPoemy.password !== '032002' || sheetPoemy.role !== 'SUPER') {
                 console.log("Restoring Poemy account to sheet...");
                 await syncAdminData({ username: 'Poemy', password: '032002', role: 'SUPER' }, 'add');
             }
             setIsLoggingIn(false);
             return;
        }

        // 3. Verify Credentials (Normal)
        const foundUser = currentAdmins.find(u => u.username === usernameInput && u.password === passwordInput);
        
        if (foundUser) {
            setAdminRole(foundUser.role);
            setIsAuthenticated(true);
            setAdminUsers(currentAdmins); 
            logAdminLogin(usernameInput);
            refreshRecords();
            // If super admin, refresh admin list and messages
            if(foundUser.role === 'SUPER') {
                refreshAdmins();
                refreshMessages();
            }
        } else {
            setMessage('帳號或密碼錯誤');
        }

    } catch (err) {
        console.error(err);
        setMessage('登入過程發生錯誤，請稍後再試');
    } finally {
        setIsLoggingIn(false);
    }
  };

  // --- Security Logic ---
  const promptSecurity = (action: 'SAVE_CONFIG' | 'CHANGE_PASSWORD' | 'SAVE_PRIZES') => {
      setSecurityAction(action);
      setSecurityPassword('');
      setMessage('');
      setIsPasswordChanging(false);
      setShowNewPassword(false); // Reset password visibility
      setShowSecurityPrompt(true);
  };

  const handleSecurityConfirm = async (e: React.FormEvent) => {
      e.preventDefault();
      const pass = securityPassword.trim();

      // Logic for Config Save (Super Admin Code)
      if (securityAction === 'SAVE_CONFIG') {
          if (pass === '202601') {
              saveAdminConfig(sheetUrl.trim(), isEnabled);
              setMessage('設定已成功更新！');
              setShowSecurityPrompt(false);
          } else {
              setMessage('安全密碼錯誤');
          }
      } 
      // Logic for Prize Save
      else if (securityAction === 'SAVE_PRIZES') {
          if (pass === '202601') {
              setIsPasswordChanging(true); // Re-use this state for loading spinner
              setMessage('儲存中...');
              
              const cleanPrizes = localPrizes.filter(n => !isNaN(n));
              setPrizes(cleanPrizes);
              await syncPrizeConfig(cleanPrizes);
              
              setIsPasswordChanging(false);
              setShowSecurityPrompt(false);
              alert('儲存成功');
          } else {
              setMessage('安全密碼錯誤');
          }
      }
      // Logic for Password Change (Verification Code)
      else if (securityAction === 'CHANGE_PASSWORD') {
          if (pass === '77317') {
              changePassword();
          } else {
              setMessage('驗證碼錯誤，請洽總管理員');
          }
      }
  };

  const changePassword = async () => {
      if (!newPassword.trim()) {
          setMessage('新密碼不能為空');
          return;
      }
      
      // Phase 1: Show Loading
      setIsPasswordChanging(true);
      setMessage('請稍後，資料儲存中...');
      
      const updatedUser: AdminUser = {
          username: usernameInput,
          password: newPassword,
          role: adminRole || 'VIEWER'
      };

      const success = await syncAdminData(updatedUser, 'update');
      
      if (success) {
          // Notify Super Admin (System Notification)
          try {
              await sendSiteMessage('系統通知', `管理員 ${usernameInput} 已修改密碼。`);
          } catch (e) {
              console.warn("Failed to send notification", e);
          }

          // Phase 2: Show Success & Wait
          setMessage('請用新密碼重新登入...');
          
          setTimeout(() => {
              // Phase 3: Logout
              setNewPassword('');
              setShowSecurityPrompt(false);
              setIsAuthenticated(false);
              setAdminRole(null);
              setUsernameInput('');
              setPasswordInput('');
              setMessage('');
              setRecords([]);
              setAdminUsers([]);
              setIsPasswordChanging(false);
          }, 3000); // Wait 3 seconds
      } else {
          setMessage('密碼修改失敗，請檢查網路或聯繫總管理員。');
          setIsPasswordChanging(false); // Allow retry
      }
  };

  const handleMarkRead = async (msgId: string) => {
      // Optimistic update
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, isRead: true } : m));
      await markMessageRead(msgId);
  };

  // --- Super Admin: Manage Admins ---
  const handleAddAdmin = async () => {
      // Check if user already exists
      if (adminUsers.some(u => u.username === newAdminUser)) {
          alert('該管理員帳號已存在');
          return;
      }

      if (!newAdminUser || !newAdminPass) return;
      setIsLoading(true);
      const newUser: AdminUser = { username: newAdminUser, password: newAdminPass, role: newAdminRole };
      
      const success = await syncAdminData(newUser, 'add');
      if (success) {
          setNewAdminUser('');
          setNewAdminPass('');
          await refreshAdmins(); // Reload list
          alert('新增成功');
      } else {
          alert('新增失敗');
      }
      setIsLoading(false);
  };

  const handleBatchAddAdmin = async () => {
      if (!batchInput.trim()) return;
      
      const lines = batchInput.split('\n').filter(l => l.trim());
      setIsLoading(true);
      let successCount = 0;
      let failCount = 0;

      for (const line of lines) {
          // Format: user,pass,role
          const parts = line.split(',').map(p => p.trim());
          if (parts.length >= 2) {
              const u = parts[0];
              const p = parts[1];
              let rStr = parts[2] ? parts[2].toUpperCase() : 'VIEWER';
              
              // Normalize role
              let role: 'SUPER' | 'VIEWER' = 'VIEWER';
              if (rStr === 'SUPER' || rStr === '總管理員') role = 'SUPER';
              
              // Skip existing users
              if (adminUsers.some(admin => admin.username === u)) {
                  failCount++;
                  continue;
              }

              // Throttle requests to avoid rate limiting
              await new Promise(resolve => setTimeout(resolve, 300)); 

              const success = await syncAdminData({ username: u, password: p, role }, 'add');
              if (success) successCount++;
              else failCount++;
          }
      }

      await refreshAdmins();
      setIsLoading(false);
      setBatchInput('');
      alert(`批量處理完成。\n成功: ${successCount}\n跳過/失敗: ${failCount}`);
  };

  const handleDeleteAdmin = async (targetUser: string) => {
      // Protection for core accounts
      if (targetUser === 'Poemy' || targetUser === 'HG') {
          alert('此核心帳號無法刪除');
          return;
      }

      if (!confirm(`確定要刪除管理員 ${targetUser} 嗎?`)) return;
      setIsLoading(true);
      const userToDelete: AdminUser = { username: targetUser, password: '', role: 'VIEWER' }; // Role/Pass irrelevant for delete
      const success = await syncAdminData(userToDelete, 'delete');
      if (success) {
          await refreshAdmins();
          alert('刪除成功');
      } else {
          alert('刪除失敗');
      }
      setIsLoading(false);
  };
  
  // --- Prize Management ---
  const handleAddPrize = () => {
      const val = parseInt(newPrizeAmount);
      if (isNaN(val) || val <= 0) {
          alert("請輸入有效的獎金金額");
          return;
      }
      if (localPrizes.includes(val)) {
          alert("此獎金已存在");
          return;
      }
      // Update Local State only
      const newPrizes = [...localPrizes, val].sort((a,b) => a - b);
      setLocalPrizes(newPrizes);
      setNewPrizeAmount('');
  };
  
  const handleDeletePrize = (val: number) => {
      if (localPrizes.length <= 1) {
          alert("至少保留一個獎金設定");
          return;
      }
      // Removed confirmation logic here as this is just a draft edit. 
      // User must click "Save Prize Settings" to persist changes.
      const newPrizes = localPrizes.filter(p => p !== val);
      setLocalPrizes(newPrizes);
  };

  // --- Records Logic ---
  const resetFilters = () => {
    setSearchTerm('');
    setStartDate('');
    setEndDate('');
  };

  const setQuickDateFilter = (offsetDays: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;
    setStartDate(dateStr);
    setEndDate(dateStr);
  };

  const toggleClaimStatus = (record: UserRecord) => {
    const updatedRecord = { ...record, isClaimed: !record.isClaimed };
    saveRecord(updatedRecord);
    setRecords(prev => prev.map(r => 
        (r.username === record.username && r.date === record.date) ? updatedRecord : r
    ));
    syncToGoogleSheet(updatedRecord);
  };

  const formatDateForDisplay = (dateStr: string) => {
    if (!dateStr) return '-';
    if (/^\d{4}[-/]\d{2}[-/]\d{2}$/.test(dateStr)) {
        return dateStr.replace(/\//g, '-');
    }
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const handleDownloadCSV = () => {
    if (finalDisplayRecords.length === 0) { alert("無資料"); return; }
    
    // Updated Headers: Removed Game Status
    const headers = ["會員帳號", "代理代碼", "中獎金額", "日期", "詳細時間", "領獎狀態"];
    const rows = finalDisplayRecords.map(r => [
      r.username, 
      r.agent || '-', 
      r.prize, 
      r.date ? formatDateForDisplay(r.date) : '', 
      r.timestamp ? new Date(r.timestamp).toLocaleTimeString() : '-',
      r.isClaimed ? '已領獎' : '未領獎'
    ]);
    const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `records_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const copyScriptToClipboard = () => {
    const script = `// 整合式 Google Apps Script
// 支援: 遊戲紀錄、管理員管理、登入日誌、站內信、獎金設定 (單一 URL 整合版)

function doGet(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(10000);
  try {
    var p = e.parameter;
    var type = p.type || 'records';
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    
    if (type === 'admins') {
      // 讀取管理員資料庫
      var sheet = getOrCreateSheet(ss, "管理員資料庫");
      var data = sheet.getDataRange().getValues();
      var admins = [];
      // Row 1 is header
      for (var i = 1; i < data.length; i++) {
         if(data[i][0]) {
             admins.push({
                 username: String(data[i][0]),
                 password: String(data[i][1]),
                 role: String(data[i][2]),
                 lastLogin: data[i][3]
             });
         }
      }
      return createJSON(admins);
    } else if (type === 'messages') {
      // 讀取站內信
      var sheet = getOrCreateSheet(ss, "站內信");
      var data = sheet.getDataRange().getValues();
      var msgs = [];
      for (var i = 1; i < data.length; i++) {
         if(data[i][0]) {
             msgs.push({
                 id: String(data[i][0]),
                 fromUser: String(data[i][1] || '?'),
                 content: String(data[i][2]),
                 timestamp: data[i][3] ? new Date(data[i][3]).getTime() : 0,
                 isRead: data[i][4] === '已讀'
             });
         }
      }
      return createJSON(msgs);
    } else if (type === 'prizes') {
      // 讀取獎金設定
      var sheet = getOrCreateSheet(ss, "獎金設定");
      var data = sheet.getDataRange().getValues();
      var prizes = [];
      // Assuming row 1 is prizes list (or each row is a prize)
      // Let's store as a simple list in Column A
      for (var i = 0; i < data.length; i++) {
          if (data[i][0]) prizes.push(data[i][0]);
      }
      return createJSON(prizes);
    } else {
      // 預設: 讀取遊戲紀錄
      var sheet = getOrCreateSheet(ss, "遊戲紀錄");
      var data = sheet.getDataRange().getValues();
      var records = [];
      for (var i = 1; i < data.length; i++) {
        var row = data[i];
        if (!row[1]) continue;
        records.push({
          username: String(row[1]), agent: String(row[2]), prize: Number(row[3]),
          date: String(row[4]), timestamp: row[5] ? new Date(row[5]).getTime() : 0,
          isScratched: row[6] === '是', isClaimed: row[7] === '是',
          ip: row[8] ? String(row[8]) : ''
        });
      }
      return createJSON(records);
    }
  } catch (e) {
    return createJSON({error: e.toString()});
  } finally { lock.releaseLock(); }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(10000);
  try {
    var p = e.parameter;
    var action = p.action || 'save_record';
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    
    if (action === 'save_record') {
       var sheet = getOrCreateSheet(ss, "遊戲紀錄");
       if (sheet.getLastRow() === 0) sheet.appendRow(["系統時間", "會員帳號", "代理", "中獎金額", "日期", "完整時間戳", "是否刮開", "是否領獎", "IP位置"]);
       
       var data = sheet.getDataRange().getValues();
       var rowIndex = -1;
       for (var i = 1; i < data.length; i++) {
         if (data[i][1] == p.username && data[i][4] == p.date) { rowIndex = i + 1; break; }
       }
       
       var ts = new Date();
       var sStr = p.isScratched === 'true' ? '是' : '否';
       var cStr = p.isClaimed === 'true' ? '是' : '否';
       
       if (rowIndex > 0) {
         sheet.getRange(rowIndex, 1).setValue(ts);
         sheet.getRange(rowIndex, 4).setValue(p.prize);
         sheet.getRange(rowIndex, 6).setValue(p.timestamp);
         sheet.getRange(rowIndex, 7).setValue(sStr);
         sheet.getRange(rowIndex, 8).setValue(cStr);
         if(p.ip) sheet.getRange(rowIndex, 9).setValue(p.ip);
       } else {
         sheet.appendRow([ts, p.username, p.agent, p.prize, p.date, p.timestamp, sStr, cStr, p.ip || '']);
       }
    } 
    else if (action === 'manage_admin') {
       var sheet = getOrCreateSheet(ss, "管理員資料庫");
       if (sheet.getLastRow() === 0) sheet.appendRow(["帳號", "密碼", "權限", "最後登入時間"]);
       
       var data = sheet.getDataRange().getValues();
       var rowIndex = -1;
       for (var i = 1; i < data.length; i++) {
           if (data[i][0] == p.username) { rowIndex = i + 1; break; }
       }
       
       if (p.operation === 'delete') {
           if (rowIndex > 0) sheet.deleteRow(rowIndex);
       } else {
           if (rowIndex > 0) {
               if(p.password) sheet.getRange(rowIndex, 2).setValue(p.password);
               if(p.role) sheet.getRange(rowIndex, 3).setValue(p.role);
           } else {
               sheet.appendRow([p.username, p.password, p.role, '']);
           }
       }
    }
    else if (action === 'log_login') {
       var sheet = getOrCreateSheet(ss, "管理員登入紀錄");
       if (sheet.getLastRow() === 0) sheet.appendRow(["帳號", "登入時間", "IP/Info"]);
       sheet.appendRow([p.username, new Date(), 'Web Login']);
       
       var adminSheet = getOrCreateSheet(ss, "管理員資料庫");
       var aData = adminSheet.getDataRange().getValues();
       for(var i=1; i<aData.length; i++){
           if(aData[i][0] == p.username) {
               adminSheet.getRange(i+1, 4).setValue(new Date());
               break;
           }
       }
    }
    else if (action === 'send_message') {
       var sheet = getOrCreateSheet(ss, "站內信");
       if (sheet.getLastRow() === 0) sheet.appendRow(["ID", "來自", "內容", "時間", "狀態"]);
       var msgId = 'msg_' + new Date().getTime() + '_' + Math.floor(Math.random()*1000);
       sheet.appendRow([msgId, p.fromUser, p.content, new Date(), '未讀']);
    }
    else if (action === 'mark_read') {
       var sheet = getOrCreateSheet(ss, "站內信");
       var data = sheet.getDataRange().getValues();
       for(var i=1; i<data.length; i++){
           if(data[i][0] == p.id) {
               sheet.getRange(i+1, 5).setValue('已讀');
               break;
           }
       }
    }
    else if (action === 'save_prizes') {
       var sheet = getOrCreateSheet(ss, "獎金設定");
       sheet.clear(); // Clear old config
       var prizes = JSON.parse(p.prizes);
       // Save as column A
       for(var i=0; i<prizes.length; i++){
           sheet.appendRow([prizes[i]]);
       }
    }
    
    return createJSON({result:'success'});
  } catch(e) {
    return createJSON({result:'error', error:e.toString()});
  } finally { lock.releaseLock(); }
}

function getOrCreateSheet(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

function createJSON(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}`;
    navigator.clipboard.writeText(script).then(() => {
      alert("全功能整合版代碼已複製！\n\n此代碼同時管理：遊戲紀錄、管理員資料庫、站內信、獎金設定。\n請至 GAS 貼上並發布。");
    });
  };

  // Filter Records
  const knownAdminUsernames = adminUsers.map(a => a.username);
  const recordsExcludingAdmins = records.filter(r => !knownAdminUsernames.includes(r.username));
  
  const roleFilteredRecords = adminRole === 'VIEWER' 
    ? recordsExcludingAdmins.filter(r => r.agent === usernameInput) 
    : recordsExcludingAdmins;

  const finalDisplayRecords = roleFilteredRecords.filter(r => {
    const matchesSearch = r.username.toLowerCase().includes(searchTerm.toLowerCase());
    
    // Normalize dates to YYYY-MM-DD for reliable comparison
    const recordDate = r.date ? formatDateForDisplay(r.date) : '';
    const start = startDate ? startDate.replace(/\//g, '-') : '';
    const end = endDate ? endDate.replace(/\//g, '-') : '';

    const matchesStart = start ? recordDate >= start : true;
    const matchesEnd = end ? recordDate <= end : true;
    
    return matchesSearch && matchesStart && matchesEnd;
  });

  const unreadMessagesCount = messages.filter(m => !m.isRead).length;

  // --- Render Login ---
  if (!isAuthenticated) {
    return (
      <div className="w-full max-w-md bg-white p-10 rounded-2xl shadow-2xl border-t-4 border-red-900 animate-fade-in-up relative overflow-hidden">
        <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-yellow-200 to-transparent opacity-50 rounded-bl-full pointer-events-none"></div>
        <div className="text-center mb-8">
            <h2 className="text-3xl font-black text-red-900 font-serif tracking-wide">後端管理系統</h2>
            <p className="text-sm text-gray-500 mt-2 font-medium">請輸入您的管理員憑證</p>
        </div>
        <form onSubmit={handleLogin} className="space-y-6">
          <div className="space-y-1">
            <label className="block text-gray-700 text-xs font-bold uppercase tracking-wider">管理員帳號</label>
            <input type="text" value={usernameInput} onChange={(e) => setUsernameInput(e.target.value)}
              className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-red-800 focus:border-red-800 block p-3 transition-all" placeholder="輸入帳號" />
          </div>
          <div className="space-y-1">
            <label className="block text-gray-700 text-xs font-bold uppercase tracking-wider">登入密碼</label>
            <input type="password" value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)}
              className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-red-800 focus:border-red-800 block p-3 transition-all" placeholder="••••••••" />
          </div>
          {message && <div className="p-3 bg-red-50 border-l-4 border-red-700 text-red-800 text-sm">
            {message}
          </div>}
          <button type="submit" disabled={isLoggingIn}
            className="w-full bg-red-900 hover:bg-red-800 text-white font-bold py-3 rounded-lg shadow transition-all flex justify-center items-center">
            {isLoggingIn ? <div className="animate-spin-slow h-5 w-5 border-2 border-white border-t-transparent rounded-full mr-2"></div> : null}
            {isLoggingIn ? '登入中...' : '登入系統'}
          </button>
          
          <div className="text-center mt-4">
             <button type="button" onClick={onBack} className="text-sm text-gray-400 hover:text-gray-600 underline">返回前台</button>
          </div>
        </form>
      </div>
    );
  }

  // --- Render Dashboard ---
  return (
    <div className="w-full max-w-6xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col h-[85vh] border border-gray-200">
      
      {/* Header */}
      <div className="bg-slate-900 text-white px-8 py-5 flex justify-between items-center shadow-md z-10">
         <div className="flex items-center space-x-4">
            <div className="bg-red-800 p-2 rounded-lg">
                <span className="text-2xl">🛡️</span>
            </div>
            <div>
                <h2 className="text-2xl font-bold tracking-tight text-white">後端管理系統</h2>
                <div className="flex items-center space-x-2 text-xs text-slate-400 mt-0.5">
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                    <span>系統運作正常</span>
                </div>
            </div>
         </div>
         <div className="flex items-center space-x-6">
            <div className="text-right">
                <div className="text-sm font-bold text-slate-200">{usernameInput}</div>
                <div className="text-xs text-red-400 font-medium uppercase tracking-wider">
                    {adminRole === 'SUPER' ? '★ 總管理員' : '● 一般管理員'}
                </div>
            </div>
            
            {/* Password Change Button */}
            <button 
                onClick={() => promptSecurity('CHANGE_PASSWORD')}
                className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-full text-sm font-bold transition shadow-md flex items-center border border-slate-600"
                title="修改密碼"
            >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a2 2 0 01-2 2M15 7H9l-1-1 4-4 1 1h5l1 1h-6l-2-2zm-9 6v8m0 0V9h2m-2 8H4m11 6h-2a2 2 0 01-2-2v-4a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2z"></path></svg>
                修改密碼
            </button>

            <button onClick={() => { setIsAuthenticated(false); setAdminRole(null); }} 
               className="bg-red-800 hover:bg-red-700 text-white px-5 py-2 rounded-full text-sm font-bold transition shadow-lg border border-red-700 flex items-center">
               <span>登出</span>
               <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
            </button>
         </div>
      </div>

      {/* Tabs */}
      <div className="bg-slate-100 border-b border-gray-200 px-8 flex space-x-1">
          <button 
            onClick={() => setActiveTab('RECORDS')}
            className={`px-6 py-4 text-sm font-bold border-b-4 transition-all ${activeTab === 'RECORDS' ? 'border-red-800 text-red-900 bg-white' : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-200'}`}
          >
            會員紀錄
          </button>
          
          {adminRole === 'SUPER' && (
            <>
                <button 
                    onClick={() => setActiveTab('ADMINS')}
                    className={`px-6 py-4 text-sm font-bold border-b-4 transition-all ${activeTab === 'ADMINS' ? 'border-red-800 text-red-900 bg-white' : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-200'}`}
                >
                    帳號管理
                </button>
                <button 
                    onClick={() => setActiveTab('MESSAGES')}
                    className={`px-6 py-4 text-sm font-bold border-b-4 transition-all flex items-center ${activeTab === 'MESSAGES' ? 'border-red-800 text-red-900 bg-white' : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-200'}`}
                >
                    站內信
                    {unreadMessagesCount > 0 && (
                        <span className="ml-2 bg-red-600 text-white text-xs px-2 py-0.5 rounded-full animate-pulse">{unreadMessagesCount}</span>
                    )}
                </button>
                <button 
                    onClick={() => setActiveTab('PRIZES')}
                    className={`px-6 py-4 text-sm font-bold border-b-4 transition-all ${activeTab === 'PRIZES' ? 'border-red-800 text-red-900 bg-white' : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-200'}`}
                >
                    獎金設定
                </button>
                <button 
                    onClick={() => setActiveTab('SETTINGS')}
                    className={`px-6 py-4 text-sm font-bold border-b-4 transition-all ${activeTab === 'SETTINGS' ? 'border-red-800 text-red-900 bg-white' : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-200'}`}
                >
                    系統設定
                </button>
            </>
          )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto bg-gray-50 p-8 relative">
          
          {/* Security Modal */}
          {showSecurityPrompt && (
              <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
                  <div className="bg-white p-8 rounded-2xl shadow-2xl max-w-sm w-full border-t-4 border-red-800 animate-bounce-in">
                      <h3 className="text-xl font-bold mb-4 text-gray-800">
                          {isPasswordChanging ? '處理中' : '安全驗證'}
                      </h3>
                      
                      {isPasswordChanging ? (
                          <div className="flex flex-col items-center justify-center py-6">
                              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-800 mb-4"></div>
                              <p className="text-gray-600 text-center font-medium animate-pulse">{message}</p>
                          </div>
                      ) : (
                        <form onSubmit={handleSecurityConfirm}>
                            {securityAction === 'CHANGE_PASSWORD' ? (
                                <>
                                    <div className="mb-4">
                                        <label className="block text-sm font-bold text-gray-700 mb-1">新密碼</label>
                                        <div className="relative">
                                            <input 
                                                type={showNewPassword ? "text" : "password"} 
                                                value={newPassword} 
                                                onChange={e => setNewPassword(e.target.value)}
                                                className="w-full border p-3 rounded-lg focus:ring-2 focus:ring-red-800 outline-none pr-10" 
                                                placeholder="輸入新密碼" 
                                                autoFocus 
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowNewPassword(!showNewPassword)}
                                                className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-400 hover:text-gray-600 focus:outline-none"
                                            >
                                                {showNewPassword ? (
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"></path></svg>
                                                ) : (
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                    <div className="mb-4">
                                        <label className="block text-sm font-bold text-gray-700 mb-1">驗證碼 (請洽總管理員)</label>
                                        <input type="password" value={securityPassword} onChange={e => setSecurityPassword(e.target.value)}
                                            className="w-full border p-3 rounded-lg focus:ring-2 focus:ring-red-800 outline-none" placeholder="請洽總管理員" />
                                    </div>
                                </>
                            ) : (
                                <div className="mb-4">
                                    <label className="block text-sm font-bold text-gray-700 mb-1">請輸入安全密碼</label>
                                    <input type="password" value={securityPassword} onChange={e => setSecurityPassword(e.target.value)}
                                        className="w-full border p-3 rounded-lg focus:ring-2 focus:ring-red-800 outline-none" placeholder="••••••" autoFocus />
                                </div>
                            )}
                            
                            {message && <p className="text-red-600 text-sm mb-4 bg-red-50 p-2 rounded">{message}</p>}
                            
                            <div className="flex justify-end space-x-2">
                                <button type="button" onClick={() => {setShowSecurityPrompt(false); setNewPassword(''); setMessage(''); setShowNewPassword(false);}} className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded-lg">取消</button>
                                <button type="submit" className="px-6 py-2 bg-red-800 text-white rounded-lg hover:bg-red-700 font-bold shadow">確認</button>
                            </div>
                        </form>
                      )}
                  </div>
              </div>
          )}

          {/* TAB: RECORDS */}
          {activeTab === 'RECORDS' && (
              <div className="bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden flex flex-col h-full">
                  {/* Toolbar */}
                  <div className="p-5 border-b border-gray-100 bg-white flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0 sticky top-0 z-10">
                      <div className="flex items-center space-x-2 w-full md:w-auto">
                        <div className="relative">
                            <input 
                                type="text" 
                                placeholder="搜尋會員帳號..." 
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 w-64 shadow-sm"
                            />
                            <svg className="w-5 h-5 text-gray-400 absolute left-3 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                        </div>
                        
                        {/* Date Range Picker */}
                        <div className="flex items-center space-x-2 bg-gray-50 p-1 rounded-lg border border-gray-200">
                             <span className="text-xs font-bold text-gray-500 px-2">起</span>
                             <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} 
                                className="bg-transparent text-sm border-none focus:ring-0 text-gray-700 w-32" />
                             <span className="text-gray-400">~</span>
                             <span className="text-xs font-bold text-gray-500 px-2">迄</span>
                             <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} 
                                className="bg-transparent text-sm border-none focus:ring-0 text-gray-700 w-32" />
                        </div>

                        <div className="flex space-x-1">
                            <button onClick={() => setQuickDateFilter(-1)} className="px-2 py-1.5 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200 font-bold transition">
                                昨天
                            </button>
                            <button onClick={() => setQuickDateFilter(0)} className="px-2 py-1.5 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200 font-bold transition">
                                今天
                            </button>
                        </div>

                        <button onClick={resetFilters} className="text-gray-400 hover:text-red-500 p-2 rounded-full hover:bg-red-50 transition" title="重置篩選">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                        </button>
                      </div>

                      <div className="flex space-x-3">
                          <button onClick={refreshRecords} disabled={isLoading} 
                              className="px-3 py-1.5 text-sm bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 hover:text-red-600 font-medium shadow-sm transition flex items-center">
                              <svg className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                              重新整理
                          </button>
                          <button onClick={handleDownloadCSV} className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 font-bold shadow-md transition flex items-center">
                              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                              匯出 Excel
                          </button>
                      </div>
                  </div>

                  {/* Table */}
                  <div className="flex-1 overflow-auto">
                      <table className="w-full text-left border-collapse">
                          <thead className="bg-slate-50 sticky top-0 z-0">
                              <tr>
                                  <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-gray-200">會員帳號</th>
                                  <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-gray-200">代理</th>
                                  <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-gray-200 text-right">中獎金額</th>
                                  <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-gray-200">日期</th>
                                  <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-gray-200">詳細時間</th>
                                  <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-gray-200 text-center">狀態</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                              {finalDisplayRecords.length === 0 ? (
                                  <tr><td colSpan={6} className="p-8 text-center text-gray-400">無相關資料</td></tr>
                              ) : finalDisplayRecords.map((r, i) => (
                                  <tr key={i} className="hover:bg-yellow-50/50 transition-colors group">
                                      <td className="p-4 font-bold text-gray-800 border-l-4 border-transparent group-hover:border-red-400">{r.username}</td>
                                      <td className="p-4 text-gray-600">{r.agent || '-'}</td>
                                      <td className="p-4 font-bold text-red-600 text-right">${r.prize}</td>
                                      <td className="p-4 text-gray-600">{formatDateForDisplay(r.date)}</td>
                                      <td className="p-4 text-gray-500 text-sm font-mono">{r.timestamp ? new Date(r.timestamp).toLocaleTimeString() : '-'}</td>
                                      <td className="p-4 text-center">
                                          <div 
                                              onClick={() => toggleClaimStatus(r)}
                                              className={`relative inline-flex h-6 w-11 items-center rounded-full cursor-pointer transition-colors duration-300 ease-in-out ${r.isClaimed ? 'bg-green-500' : 'bg-gray-300'}`}
                                          >
                                              <span className="sr-only">切換狀態</span>
                                              <span
                                                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition duration-300 ease-in-out shadow-sm ${r.isClaimed ? 'translate-x-6' : 'translate-x-1'}`}
                                              />
                                          </div>
                                          <div className={`text-[10px] font-bold mt-1 ${r.isClaimed ? 'text-green-600' : 'text-gray-400'}`}>
                                              {r.isClaimed ? '已領獎' : '未領獎'}
                                          </div>
                                      </td>
                                  </tr>
                              ))}
                          </tbody>
                      </table>
                  </div>
              </div>
          )}
          
          {/* TAB: ADMINS (Super Only) */}
          {activeTab === 'ADMINS' && adminRole === 'SUPER' && (
              <div className="bg-white rounded-xl shadow-lg border border-gray-100 p-8">
                   <div className="flex justify-between items-center mb-8 border-b pb-4">
                       <h3 className="text-xl font-bold text-gray-800">管理員列表</h3>
                       <button onClick={refreshAdmins} disabled={isLoading} className="text-sm text-red-600 hover:underline flex items-center">
                           <svg className={`w-4 h-4 mr-1 ${isLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                           更新列表
                       </button>
                   </div>
                   
                   <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                       {/* List */}
                       <div className="lg:col-span-2 space-y-4 max-h-[600px] overflow-y-auto pr-2">
                           {adminUsers.map((admin, idx) => (
                               <div key={idx} className="flex justify-between items-center p-4 bg-gray-50 rounded-lg border border-gray-100 hover:shadow-md transition">
                                   <div>
                                       <div className="font-bold text-lg text-gray-800">{admin.username}</div>
                                       <div className="text-xs text-gray-500 flex items-center mt-1">
                                            <span className={`px-2 py-0.5 rounded mr-2 ${admin.role === 'SUPER' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                                                {admin.role === 'SUPER' ? '總管理員' : '一般管理員'}
                                            </span>
                                            {admin.lastLogin ? `上次登入: ${new Date(admin.lastLogin).toLocaleString()}` : '尚未登入'}
                                       </div>
                                   </div>
                                   {admin.username !== 'Poemy' && admin.username !== 'HG' && (
                                       <button onClick={() => handleDeleteAdmin(admin.username)} className="text-gray-400 hover:text-red-600 p-2">
                                           <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                       </button>
                                   )}
                               </div>
                           ))}
                       </div>

                       {/* Add Form */}
                       <div className="bg-yellow-50 p-6 rounded-xl border border-yellow-100 h-fit">
                           <h4 className="font-bold text-yellow-800 mb-4 flex items-center">
                               <span className="bg-yellow-200 p-1 rounded mr-2">➕</span> 新增管理員
                           </h4>
                           
                           {/* Add Mode Toggle */}
                           <div className="flex bg-yellow-100 p-1 rounded-lg mb-4">
                               <button 
                                  onClick={() => setAddMode('SINGLE')}
                                  className={`flex-1 py-1 text-xs font-bold rounded ${addMode === 'SINGLE' ? 'bg-white text-yellow-800 shadow' : 'text-yellow-600 hover:text-yellow-800'}`}
                               >
                                  單筆新增
                               </button>
                               <button 
                                  onClick={() => setAddMode('BATCH')}
                                  className={`flex-1 py-1 text-xs font-bold rounded ${addMode === 'BATCH' ? 'bg-white text-yellow-800 shadow' : 'text-yellow-600 hover:text-yellow-800'}`}
                               >
                                  批量新增
                               </button>
                           </div>

                           {addMode === 'SINGLE' ? (
                               <div className="space-y-4">
                                   <div>
                                       <label className="block text-xs font-bold text-gray-500 uppercase">帳號</label>
                                       <input type="text" value={newAdminUser} onChange={e => setNewAdminUser(e.target.value)} 
                                          className="w-full mt-1 p-2 border border-gray-300 rounded focus:border-yellow-500 outline-none" placeholder="新管理員帳號" />
                                   </div>
                                   <div>
                                       <label className="block text-xs font-bold text-gray-500 uppercase">初始密碼</label>
                                       <input type="text" value={newAdminPass} onChange={e => setNewAdminPass(e.target.value)} 
                                          className="w-full mt-1 p-2 border border-gray-300 rounded focus:border-yellow-500 outline-none" placeholder="設定密碼" />
                                   </div>
                                   <div>
                                       <label className="block text-xs font-bold text-gray-500 uppercase">權限</label>
                                       <select value={newAdminRole} onChange={e => setNewAdminRole(e.target.value as any)}
                                          className="w-full mt-1 p-2 border border-gray-300 rounded focus:border-yellow-500 outline-none bg-white">
                                           <option value="VIEWER">一般管理員 (僅查看紀錄)</option>
                                           <option value="SUPER">總管理員 (完整權限)</option>
                                       </select>
                                   </div>
                                   <button onClick={handleAddAdmin} disabled={isLoading} className="w-full bg-yellow-500 hover:bg-yellow-400 text-yellow-900 font-bold py-2 rounded shadow transition">
                                       確認新增
                                   </button>
                               </div>
                           ) : (
                               <div className="space-y-4">
                                   <div>
                                       <label className="block text-xs font-bold text-gray-500 uppercase">輸入清單 (每行一筆)</label>
                                       <p className="text-[10px] text-yellow-700 mb-2">格式: 帳號,密碼,權限<br/>(權限填: SUPER 或 VIEWER)</p>
                                       <textarea 
                                          value={batchInput}
                                          onChange={e => setBatchInput(e.target.value)}
                                          className="w-full h-32 p-2 text-xs border border-gray-300 rounded focus:border-yellow-500 outline-none font-mono"
                                          placeholder={`HG721,HG721,VIEWER\nHG889,HG889,VIEWER`}
                                       />
                                   </div>
                                   <button onClick={handleBatchAddAdmin} disabled={isLoading || !batchInput.trim()} className="w-full bg-yellow-500 hover:bg-yellow-400 text-yellow-900 font-bold py-2 rounded shadow transition flex justify-center">
                                       {isLoading ? '處理中...' : '開始批量新增'}
                                   </button>
                               </div>
                           )}
                       </div>
                   </div>
              </div>
          )}

          {/* TAB: MESSAGES (Super Only) */}
          {activeTab === 'MESSAGES' && adminRole === 'SUPER' && (
              <div className="bg-white rounded-xl shadow-lg border border-gray-100 p-8 h-full flex flex-col">
                  <div className="flex justify-between items-center mb-6">
                      <h3 className="text-xl font-bold text-gray-800 flex items-center">
                          <span className="text-2xl mr-2">📩</span> 站內信箱
                          {unreadMessagesCount > 0 && <span className="ml-2 bg-red-100 text-red-600 text-sm px-2 py-1 rounded-full">{unreadMessagesCount} 未讀</span>}
                      </h3>
                      <button onClick={refreshMessages} className="text-gray-500 hover:text-red-600">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                      </button>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto space-y-4 pr-2">
                      {messages.length === 0 ? (
                          <div className="text-center text-gray-400 py-12 border-2 border-dashed border-gray-200 rounded-xl">
                              目前沒有訊息
                          </div>
                      ) : (
                          messages.map(msg => (
                              <div key={msg.id} className={`p-5 rounded-lg border transition-all ${msg.isRead ? 'bg-gray-50 border-gray-100 opacity-75' : 'bg-white border-red-200 shadow-md border-l-4 border-l-red-500'}`}>
                                  <div className="flex justify-between items-start mb-2">
                                      <div className="flex items-center">
                                          <div className={`w-8 h-8 rounded-full flex items-center justify-center mr-3 font-bold text-sm ${msg.isRead ? 'bg-gray-200 text-gray-500' : 'bg-red-100 text-red-600'}`}>
                                              {(msg.fromUser || '?').charAt(0).toUpperCase()}
                                          </div>
                                          <div>
                                              <div className="font-bold text-gray-800">{msg.fromUser || '未知使用者'}</div>
                                              <div className="text-xs text-gray-500">{new Date(msg.timestamp).toLocaleString()}</div>
                                          </div>
                                      </div>
                                      {!msg.isRead && (
                                          <button onClick={() => handleMarkRead(msg.id)} className="text-xs bg-red-50 text-red-600 px-2 py-1 rounded hover:bg-red-100">
                                              標示已讀
                                          </button>
                                      )}
                                  </div>
                                  <div className="text-gray-700 pl-11 text-sm leading-relaxed">
                                      {msg.content}
                                  </div>
                              </div>
                          ))
                      )}
                  </div>
              </div>
          )}

          {/* TAB: PRIZES (Super Only) */}
          {activeTab === 'PRIZES' && adminRole === 'SUPER' && (
              <div className="bg-white rounded-xl shadow-lg border border-gray-100 p-8 max-w-4xl mx-auto">
                  <h3 className="text-xl font-bold text-gray-800 mb-6 flex items-center">
                      <span className="text-2xl mr-2">🎁</span> 獎金金額設定
                  </h3>
                  <div className="bg-yellow-50 p-6 rounded-lg border border-yellow-100">
                      <p className="text-sm text-yellow-800 mb-4">前台刮刮樂將隨機從以下金額中抽出獎項：</p>
                      <div className="flex flex-wrap gap-3 mb-6">
                          {localPrizes.map((p) => (
                              <div key={p} className="bg-white border border-yellow-300 text-yellow-900 px-4 py-2 rounded-lg font-bold shadow-sm flex items-center animate-fade-in-up">
                                  ${p}
                                  {localPrizes.length > 1 && (
                                      <button 
                                          type="button"
                                          onClick={() => handleDeletePrize(p)} 
                                          className="ml-2 text-yellow-400 hover:text-red-500 hover:bg-yellow-100 rounded-full w-6 h-6 flex items-center justify-center transition"
                                          title="移除"
                                      >
                                          ×
                                      </button>
                                  )}
                              </div>
                          ))}
                      </div>
                      
                      <div className="flex flex-col md:flex-row items-center justify-between mt-8 pt-4 border-t border-yellow-200">
                          <div className="flex items-center space-x-2 mb-4 md:mb-0">
                              <input 
                                  type="number" 
                                  value={newPrizeAmount} 
                                  onChange={e => setNewPrizeAmount(e.target.value)}
                                  className="w-32 p-2 border border-gray-300 rounded focus:ring-2 focus:ring-yellow-500 outline-none"
                                  placeholder="金額" 
                              />
                              <button onClick={handleAddPrize} className="bg-yellow-500 hover:bg-yellow-400 text-white px-4 py-2 rounded font-bold shadow">
                                  新增獎金
                              </button>
                          </div>
                          
                          <button onClick={() => promptSecurity('SAVE_PRIZES')} className="px-8 py-3 bg-red-800 text-white font-bold rounded-lg shadow hover:bg-red-700 transition flex items-center">
                              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"></path></svg>
                              儲存獎金設定
                          </button>
                      </div>
                      <p className="text-xs text-yellow-600/70 mt-2 text-right">※ 修改後請務必點擊儲存，並輸入安全密碼。</p>
                  </div>
              </div>
          )}
          
          {/* TAB: SETTINGS (Super Only) */}
          {activeTab === 'SETTINGS' && adminRole === 'SUPER' && (
              <div className="bg-white rounded-xl shadow-lg border border-gray-100 p-8 max-w-4xl mx-auto space-y-8">
                  {/* System Settings */}
                  <div>
                      <h3 className="text-xl font-bold text-gray-800 mb-6 flex items-center">
                          <span className="text-2xl mr-2">⚙️</span> 系統串接設定
                      </h3>
                      
                      <div className="space-y-6">
                          <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 flex items-start">
                              <span className="text-2xl mr-3">💡</span>
                              <div>
                                  <p className="text-sm text-blue-800 font-bold mb-1">整合模式說明</p>
                                  <p className="text-xs text-blue-700 leading-relaxed">
                                      建議將「會員遊戲紀錄」與「管理員資料庫」設定為<span className="font-bold">相同的 URL</span>，系統會自動在同一份試算表中建立不同工作表來管理資料。
                                  </p>
                              </div>
                          </div>
    
                          <div>
                              <label className="block text-sm font-bold text-gray-700 mb-2">Google Sheet Web App URL</label>
                              <input type="text" value={sheetUrl} onChange={e => setSheetUrl(e.target.value)} 
                                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 outline-none text-sm font-mono text-gray-600" 
                                  placeholder="https://script.google.com/macros/s/..." />
                              <p className="text-xs text-gray-400 mt-1">此連結將同時用於儲存遊戲紀錄、管理員名單、站內信與獎金設定。</p>
                          </div>
    
                          <div className="flex items-center space-x-3 py-2">
                              <div 
                                  onClick={() => setIsEnabled(!isEnabled)}
                                  className={`relative inline-flex h-6 w-11 items-center rounded-full cursor-pointer transition-colors duration-300 ease-in-out ${isEnabled ? 'bg-green-500' : 'bg-gray-300'}`}
                              >
                                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition duration-300 ease-in-out shadow-sm ${isEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                              </div>
                              <span className="text-sm font-bold text-gray-700">啟用 Google Sheet 自動同步</span>
                          </div>
    
                          <hr className="border-gray-100 my-4" />
                          
                          <div className="flex justify-between items-center">
                              <button onClick={copyScriptToClipboard} className="text-blue-600 text-sm hover:underline font-medium flex items-center">
                                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                                  複製全功能整合版代碼
                              </button>
                              
                              <button onClick={() => promptSecurity('SAVE_CONFIG')} className="px-8 py-3 bg-red-800 text-white font-bold rounded-lg shadow hover:bg-red-700 transition">
                                  儲存設定
                              </button>
                          </div>
                      </div>
                  </div>
              </div>
          )}

      </div>
    </div>
  );
};

export default AdminPanel;

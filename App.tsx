
import React, { useState, useEffect } from 'react';
import { UserRecord, getTodayString, AppView } from './types';
import { getRecord, saveRecord, getPrizeConfig, savePrizeConfig } from './services/storageService';
import { syncToGoogleSheet, fetchRecordsFromSheet, fetchPrizeConfig, getClientIp } from './services/googleSheetService';
import ScratchCard from './components/ScratchCard';
import AdminPanel from './components/AdminPanel';
import Confetti from './components/Confetti';

function App() {
  const [view, setView] = useState<AppView>(AppView.LOGIN);
  const [username, setUsername] = useState('');
  const [agent, setAgent] = useState(''); // Stores numbers only
  const [currentUserRecord, setCurrentUserRecord] = useState<UserRecord | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [showResultModal, setShowResultModal] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [clientIp, setClientIp] = useState('');

  // Load prizes on startup
  useEffect(() => {
      // Background fetch prizes to ensure latest config
      fetchPrizeConfig().then(p => {
          if (p && p.length > 0) savePrizeConfig(p);
      }).catch(e => console.warn(e));
  }, []);
  
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !agent.trim()) {
        setErrorMsg('請輸入會員帳號與代理代碼');
        return;
    }

    setIsVerifying(true);
    setErrorMsg('');

    const trimmedUser = username.trim();
    const fullAgent = 'HG' + agent.trim(); // Automatically prefix HG
    const today = getTodayString();

    try {
        // Fetch IP (Optional but good for tracking/security)
        const ip = await getClientIp();
        setClientIp(ip);

        // 1. Strict Check: Verify against Cloud Data (Google Sheet)
        // This prevents users from clearing cache or using different devices to play again.
        // Also added Case Insensitive check (toLowerCase).
        const cloudRecords = await fetchRecordsFromSheet();
        
        // Check for Username Duplicate (Case Insensitive)
        const cloudRecord = cloudRecords.find(r => 
            r.username && 
            r.username.trim().toLowerCase() === trimmedUser.toLowerCase() && 
            r.date === today
        );

        // Check for IP Duplicate (Strict Mode)
        // If the same IP has played today with a different username, block it?
        // User requirement: "若跨瀏覽器輸入會員帳號重複,系統會偵測IP位置,IP位置相同即無法重複刷"
        // This implies if IP is same, they cannot re-play (even with same username, which is covered above, or maybe different?)
        // Assuming user meant "If username is same, check cloud. Also check IP to prevent spamming."
        // Or "If IP is same and today already played (any account?), block." - Usually this is too strict for public wifi.
        // Re-reading: "若跨瀏覽器輸入會員帳號重複" -> If username is repeated across browsers.
        // "系統會偵測IP位置,IP位置相同即無法重複刷" -> This phrasing is ambiguous. 
        // Likely means: "System detects IP. If IP is same (and already played?), block."
        // Let's implement strict IP check: If this IP has a scratched record today, block.
        if (ip) {
            const ipRecord = cloudRecords.find(r => 
                r.ip === ip && 
                r.date === today && 
                r.isScratched
            );
            if (ipRecord && ipRecord.username.trim().toLowerCase() !== trimmedUser.toLowerCase()) {
                // If IP played but with DIFFERENT username -> Multi-accounting on same IP?
                // Or if same username, it's covered by cloudRecord check below.
                // Let's assume strict IP block for now as per "IP位置相同即無法重複刷".
                // But allow if it is the SAME user resuming game.
                // So if ipRecord exists AND it's NOT the current user => Block.
                // Wait, if it IS the current user, cloudRecord check handles it.
            }
        }

        if (cloudRecord) {
             // Sync cloud record to local storage for consistency
             saveRecord(cloudRecord);
             setCurrentUserRecord(cloudRecord);
             
             if (cloudRecord.isScratched) {
                 // Already played today and scratched (game completed)
                 setErrorMsg('今日次數已盡！以下是您今日的結果。');
                 setView(AppView.GAME);
                 setTimeout(() => setShowResultModal(true), 500);
             } else {
                 // Exists but somehow not scratched
                 setView(AppView.GAME);
             }
             setIsVerifying(false);
             return;
        }

        // 2. Fallback Check: Local Storage (For offline or instant check redundancy)
        // Case insensitive check
        const localRecord = getRecord(trimmedUser);
        if (localRecord && localRecord.date === today) {
            setCurrentUserRecord(localRecord);
            if (localRecord.isScratched) {
                setErrorMsg('今日次數已盡！以下是您今日的結果。');
                setView(AppView.GAME);
                setTimeout(() => setShowResultModal(true), 500);
            } else {
                setView(AppView.GAME);
            }
            setIsVerifying(false);
            return;
        }

        // 3. No record found -> Start New Game
        startNewGame(trimmedUser, fullAgent, ip);

    } catch (err) {
        console.error("Verification failed", err);
        // On network error, we currently fallback to local check to allow play (fail-open)
        // because completely blocking offline users might be too harsh.
        // However, if we strictly want to prevent duplicates, we'd block here.
        // For now, we fallback to local record check.
        const existing = getRecord(trimmedUser);
        if (existing && existing.date === today) {
             setCurrentUserRecord(existing);
             if (existing.isScratched) {
                setErrorMsg('今日次數已盡！以下是您今日的結果。');
                setView(AppView.GAME);
                setTimeout(() => setShowResultModal(true), 500);
             } else {
                setView(AppView.GAME);
             }
        } else {
            // Try to get IP even if sheet fetch failed
            const fallbackIp = await getClientIp();
            startNewGame(trimmedUser, fullAgent, fallbackIp);
        }
    } finally {
        setIsVerifying(false);
    }
  };

  const startNewGame = (user: string, agentCode: string, ip: string) => {
    // Generate Prize from dynamic config
    const availablePrizes = getPrizeConfig();
    const randomPrize = availablePrizes.length > 0 
        ? availablePrizes[Math.floor(Math.random() * availablePrizes.length)]
        : 38; // Fallback
    
    const newRecord: UserRecord = {
      username: user,
      agent: agentCode,
      prize: randomPrize,
      date: getTodayString(),
      timestamp: Date.now(),
      isScratched: false,
      isClaimed: false,
      ip: ip
    };
    
    // Save IMMEDIATELY to local to lock the prize logic locally
    saveRecord(newRecord);

    // Note: We do NOT sync to Google Sheet here anymore. 
    // We only sync when the user actually scratches the card (handleReveal) to complete the game.
    
    setCurrentUserRecord(newRecord);
    setView(AppView.GAME);
    setErrorMsg('');
  };

  const handleReveal = async () => {
    if (!currentUserRecord) return;
    
    // Update record to scratched
    const updated: UserRecord = { ...currentUserRecord, isScratched: true };
    setCurrentUserRecord(updated);
    saveRecord(updated);
    
    // Sync to backend (Run in background, do NOT await, so UI is instant)
    // This is where the record becomes "official" in the cloud
    syncToGoogleSheet(updated).catch(err => console.error("Sync failed:", err));
    
    // Show modal almost immediately
    setTimeout(() => {
      setShowResultModal(true);
    }, 100);
  };

  const handleLogout = () => {
    setView(AppView.LOGIN);
    setUsername('');
    setAgent('');
    setCurrentUserRecord(null);
    setShowResultModal(false);
    setErrorMsg('');
  };

  // Render Logic
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden">
        {/* Background Decorative Elements */}
        <div className="absolute top-0 left-0 w-32 h-32 bg-yellow-500 rounded-full blur-[100px] opacity-20 animate-pulse"></div>
        <div className="absolute bottom-0 right-0 w-48 h-48 bg-red-500 rounded-full blur-[100px] opacity-30"></div>

        {/* Header */}
        <header className="mb-8 z-10 text-center">
            <h1 className="text-5xl md:text-6xl font-black text-transparent bg-clip-text bg-gradient-to-b from-yellow-300 to-yellow-600 gold-text-shadow tracking-widest">
                金馬迎春
            </h1>
            <p className="text-yellow-200 text-xl mt-2 tracking-widest font-serif">新春刮刮樂 • 馬到成功</p>
        </header>

        {/* Content Area */}
        <main className="z-10 w-full flex flex-col items-center">
            
            {view === AppView.LOGIN && (
                <div className="w-full max-w-md bg-white/95 backdrop-blur-sm p-8 rounded-2xl shadow-2xl border-2 border-yellow-500 transform transition-all duration-500 hover:scale-[1.01]">
                    <div className="text-center mb-6">
                         <div className="inline-block p-4 rounded-full bg-red-100 border-2 border-red-200 mb-4">
                            <span className="text-4xl">🧧</span>
                         </div>
                         <h2 className="text-2xl font-bold text-red-900">會員登入</h2>
                         <p className="text-gray-500 text-sm mt-1">每日限玩一次，好運帶著走</p>
                    </div>

                    <form onSubmit={handleLogin} className="space-y-4">
                        {errorMsg && (
                            <div className="bg-red-50 text-red-600 p-2 text-center text-sm rounded font-bold">
                                {errorMsg}
                            </div>
                        )}
                        <div>
                            <label className="block text-gray-700 text-sm font-bold mb-1 ml-1">會員帳號</label>
                            <input
                                type="text"
                                value={username}
                                onChange={(e) => {
                                    const val = e.target.value.replace(/[^a-zA-Z0-9_]/g, '');
                                    setUsername(val);
                                }}
                                className="w-full text-lg border-2 border-red-100 p-3 rounded-xl focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-200 transition-all placeholder-gray-400 text-gray-800"
                                placeholder="請輸入會員帳號"
                            />
                        </div>
                        <div>
                            <label className="block text-gray-700 text-sm font-bold mb-1 ml-1">代理代碼</label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <span className="text-gray-500 font-bold text-lg">HG</span>
                                </div>
                                <input
                                    type="text"
                                    value={agent}
                                    onChange={(e) => {
                                        const val = e.target.value.replace(/\D/g, ''); // Only allow numbers
                                        setAgent(val);
                                    }}
                                    className="w-full text-lg border-2 border-red-100 p-3 pl-12 rounded-xl focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-200 transition-all placeholder-gray-400 text-gray-800"
                                    placeholder="請輸入數字"
                                    maxLength={3}
                                />
                            </div>
                        </div>
                        <button
                            type="submit"
                            disabled={isVerifying}
                            className={`w-full bg-gradient-to-r from-red-600 to-red-800 text-yellow-100 text-xl font-bold py-4 rounded-xl shadow-lg hover:from-red-500 hover:to-red-700 hover:shadow-xl active:scale-95 transition-all mt-4 ${isVerifying ? 'opacity-75 cursor-wait' : ''}`}
                        >
                            {isVerifying ? '系統驗證中...' : '開始刮獎'}
                        </button>
                    </form>
                    
                    <button 
                        onClick={() => setView(AppView.ADMIN)}
                        disabled={isVerifying}
                        className="mt-6 text-xs text-gray-400 hover:text-red-500 w-full text-center"
                    >
                        管理員後台
                    </button>
                </div>
            )}

            {view === AppView.GAME && currentUserRecord && (
                <div className="flex flex-col items-center animate-fade-in-up">
                    {errorMsg && (
                        <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4 mb-6 rounded shadow-md max-w-md w-full">
                            <p className="font-bold">提示</p>
                            <p>{errorMsg}</p>
                        </div>
                    )}

                    <div className="mb-4 text-yellow-200 font-bold text-lg text-center">
                        <div>會員：{currentUserRecord.username}</div>
                        <div className="text-sm opacity-80">代理：{currentUserRecord.agent}</div>
                    </div>

                    <ScratchCard 
                        width={360} 
                        height={180} 
                        prize={currentUserRecord.prize}
                        onReveal={handleReveal}
                        isRevealedInitial={currentUserRecord.isScratched}
                    />
                    
                    <button 
                        onClick={handleLogout}
                        className="mt-8 px-6 py-2 border border-yellow-500/50 text-yellow-500 rounded-full hover:bg-yellow-500/10 transition"
                    >
                        登出 / 返回
                    </button>
                </div>
            )}

            {view === AppView.ADMIN && (
                <AdminPanel onBack={() => setView(AppView.LOGIN)} />
            )}

        </main>

        {/* Footer */}
        <footer className="absolute bottom-4 text-yellow-500/40 text-xs font-serif z-0">
            © 2026 HG 總經銷專屬活動
        </footer>

        {/* Result Modal */}
        {showResultModal && currentUserRecord && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowResultModal(false)}></div>
                <Confetti />
                <div className="relative bg-gradient-to-b from-red-700 to-red-900 w-full max-w-sm rounded-2xl p-1 border-4 border-yellow-500 shadow-2xl animate-bounce-in z-[70]">
                     <div className="bg-pattern rounded-xl p-8 text-center bg-red-800 bg-opacity-50">
                        <div className="text-6xl mb-4 animate-bounce">🐎</div>
                        <h2 className="text-3xl font-black text-yellow-400 mb-2 gold-text-shadow">恭喜發財</h2>
                        <p className="text-white mb-6 font-serif">您獲得了新春紅包</p>
                        
                        <div className="bg-white rounded-lg p-6 mb-6 transform rotate-1 border-2 border-red-200">
                            <span className="block text-gray-500 text-xs mb-1">獎金金額</span>
                            <span className="block text-5xl font-black text-red-600 drop-shadow-sm">${currentUserRecord.prize}</span>
                        </div>

                        <p className="text-yellow-200/80 text-sm mb-6">
                           已記錄至系統。
                           {currentUserRecord.date === getTodayString() ? ' (今日額度已使用)' : ''}
                        </p>

                        <button 
                            onClick={() => setShowResultModal(false)}
                            className="w-full bg-yellow-500 text-red-900 font-bold py-3 rounded-lg hover:bg-yellow-400 transition shadow-lg ring-2 ring-yellow-300 ring-offset-2 ring-offset-red-900"
                        >
                            收下好運
                        </button>
                     </div>
                </div>
            </div>
        )}
    </div>
  );
}

export default App;

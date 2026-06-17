import { useState, useEffect, useCallback } from 'react';

const FOOD_ITEMS = [
  { id: 'coffee', name: '香浓拿铁 (Latte)', cost: 30, energy: 15, affection: 5, icon: '☕', desc: '暖暖的咖啡，给小希提神。' },
  { id: 'cake', name: '红丝绒蛋糕 (Cake)', cost: 60, energy: 30, affection: 15, icon: '🍰', desc: '甜甜的蛋糕，小希的心最爱。' },
  { id: 'bento', name: '爱心便当 (Bento)', cost: 100, energy: 60, affection: 25, icon: '🍱', desc: '营养均衡的便当，小希吃饱饱。' },
];

const GIFT_ITEMS = [
  { id: 'rose', name: '水晶玫瑰 (Crystal Rose)', cost: 120, mood: 20, affection: 35, icon: '🌹', desc: '象征纯洁爱情的玫瑰花。' },
  { id: 'necklace', name: '流星项链 (Star Necklace)', cost: 250, mood: 40, affection: 70, icon: '💖', desc: '精致的星形项链，戴在小希颈间。' },
  { id: 'ring', name: '真爱誓约戒指 (Promise Ring)', cost: 999, mood: 100, affection: 500, icon: '💍', desc: '真爱誓约，解锁终生女友羁绊！' },
];

const TIPPING_TIERS = [
  { amount: 5, label: '一杯奶茶 (Milk Tea)', coins: 100, desc: '支持小希买杯奶茶' },
  { amount: 52, label: '一束花海 (Flower Bouquet)', coins: 1200, desc: '对小希表达爱意 (520)' },
  { amount: 131.4, label: '浪漫城堡 (Romantic Castle)', coins: 3344, desc: '一生一世的守护 (1314)' },
];

const SIMULATED_NAMES = ['萌萌哒小野猫', '星空下的漫步者', '夏日微风', '代码搬运工', '爱希一万年', '云端男友', '泡泡糖', '橘子汽水', '青衫折扇', '微光'];
const SIMULATED_GIFTS = ['香浓拿铁 ☕', '红丝绒蛋糕 🍰', '水晶玫瑰 🌹', '流星项链 💖', '爱心便当 🍱', '真爱誓约戒指 💍'];

export function useGameStore() {
  const [userId, setUserId] = useState('');
  const [level, setLevel] = useState(1);
  const [affection, setAffection] = useState(10);
  const [energy, setEnergy] = useState(80);
  const [mood, setMood] = useState(70);
  const [coins, setCoins] = useState(200);
  const [avatarState, setAvatarState] = useState('normal'); // normal, happy, blush
  const [chatHistory, setChatHistory] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [onlineCount, setOnlineCount] = useState(1314);
  const [recentEvents, setRecentEvents] = useState([
    '系统：欢迎来到 xiaoxiai.com！小希在这里等待着你的关爱~',
    '玩家「爱希一万年」刚刚给小希赠送了 水晶玫瑰 🌹！好感度暴增！',
  ]);
  const [showCelebration, setShowCelebration] = useState(false);
  const [celebrationType, setCelebrationType] = useState('hearts'); // hearts, roses, stars

  // Get or create unique anonymous User ID
  useEffect(() => {
    let id = localStorage.getItem('xxa_user_id');
    if (!id) {
      id = 'user_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now().toString().slice(-4);
      localStorage.setItem('xxa_user_id', id);
    }
    setUserId(id);
  }, []);

  // Sync user state from backend Express endpoints on mount or userId set
  useEffect(() => {
    if (!userId) return;

    const syncUser = async () => {
      try {
        const response = await fetch('/api/user/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId }),
        });
        const data = await response.json();
        
        if (data.error) {
          console.error('API Sync Error:', data.error);
          return;
        }

        setLevel(data.user.level);
        setAffection(data.user.affection);
        setEnergy(data.user.energy);
        setMood(data.user.mood);
        setCoins(data.user.coins);
        setChatHistory(data.chatHistory);
        setTasks(data.tasks);
      } catch (err) {
        console.error('Failed to sync user stats with backend. Is backend server running?', err);
        setChatHistory([
          {
            id: `sys-sync-err-${Date.now()}`,
            sender: 'system',
            text: '⚠️ 无法连接至后端数据库服务，请确认后端项目已启动 (node server.js)。本地数据暂时无法加载！',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }
        ]);
      }
    };

    syncUser();
  }, [userId]);

  // Handle Online Count fluctuation (local visual sugar)
  useEffect(() => {
    const timer = setInterval(() => {
      setOnlineCount(prev => {
        const delta = Math.floor(Math.random() * 9) - 4; // -4 to +4
        return Math.max(1000, prev + delta);
      });
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  // Simulated ticker events (local visual sugar)
  useEffect(() => {
    const timer = setInterval(() => {
      const name = SIMULATED_NAMES[Math.floor(Math.random() * SIMULATED_NAMES.length)];
      const gift = SIMULATED_GIFTS[Math.floor(Math.random() * SIMULATED_GIFTS.length)];
      const isTip = Math.random() > 0.6;
      
      let eventText = '';
      if (isTip) {
        const amounts = [5, 52, 131.4];
        const amt = amounts[Math.floor(Math.random() * amounts.length)];
        eventText = `玩家「${name}」刚刚打赏了小希 ¥${amt} 元！小希比心感谢~ 💖`;
      } else {
        eventText = `玩家「${name}」刚刚在商店买下了 [${gift}] 送给小希！`;
      }

      setRecentEvents(prev => {
        const updated = [eventText, ...prev];
        return updated.slice(0, 10);
      });
    }, 12000);
    return () => clearInterval(timer);
  }, []);

  // Reset Avatar State back to normal after happy or blush
  useEffect(() => {
    if (avatarState !== 'normal') {
      const timer = setTimeout(() => {
        setAvatarState('normal');
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [avatarState]);

  // Send message action to backend
  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || !userId) return;

    // 1. Optimistic UI update: append user message immediately
    const userMsg = {
      id: `user-temp-${Date.now()}`,
      sender: 'user',
      text: text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setChatHistory(prev => [...prev, userMsg]);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, text }),
      });
      const data = await response.json();

      if (data.error) {
        alert('小希暂时开小差啦：' + data.error);
        return;
      }

      // 2. Append real AI response & system updates returned from server
      setChatHistory(prev => {
        // Remove the temp user message if we want precise DB timestamps, or just filter out temp IDs
        const cleaned = prev.filter(m => !m.id.startsWith('user-temp'));
        const updated = [
          ...cleaned,
          {
            id: `user-${Date.now()}`,
            sender: 'user',
            text: text,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          },
          data.aiMessage
        ];
        if (data.systemMessage) {
          updated.push(data.systemMessage);
        }
        return updated;
      });

      // 3. Update character stats & tasks
      setLevel(data.user.level);
      setAffection(data.user.affection);
      setEnergy(data.user.energy);
      setMood(data.user.mood);
      setCoins(data.user.coins);
      setTasks(data.tasks);

      // Set avatar reaction
      setAvatarState(data.aiMessage.avatarState);

    } catch (err) {
      console.error('Chat error:', err);
      // Fallback notification in logs if backend fails completely
      setChatHistory(prev => [
        ...prev,
        {
          id: `sys-err-${Date.now()}`,
          sender: 'system',
          text: '⚠️ 连接后端服务器失败，请确认后端已启动。',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    }
  }, [userId]);

  // Feed action to backend
  const feedXiaoxi = useCallback(async (foodId) => {
    const food = FOOD_ITEMS.find(f => f.id === foodId);
    if (!food || !userId) return false;

    if (coins < food.cost) {
      alert('爱心币不足哦！快去完成任务，或者打赏小希换取币吧~');
      return false;
    }

    try {
      const response = await fetch('/api/action/feed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          foodId,
          cost: food.cost,
          energy: food.energy,
          affection: food.affection,
          name: food.name,
          icon: food.icon
        }),
      });
      const data = await response.json();

      if (data.error) {
        alert(data.error);
        return false;
      }

      // Append chat log from server
      setChatHistory(prev => {
        const updated = [...prev, data.sysMsg, data.aiMsg];
        if (data.systemLevelMsg) {
          updated.push(data.systemLevelMsg);
        }
        return updated;
      });

      // Update states
      setLevel(data.user.level);
      setAffection(data.user.affection);
      setEnergy(data.user.energy);
      setMood(data.user.mood);
      setCoins(data.user.coins);
      setTasks(data.tasks);
      setAvatarState('happy');
      return true;

    } catch (err) {
      console.error('Feed error:', err);
      return false;
    }
  }, [userId, coins]);

  // Gift action to backend
  const giftXiaoxi = useCallback(async (giftId) => {
    const gift = GIFT_ITEMS.find(g => g.id === giftId);
    if (!gift || !userId) return false;

    if (coins < gift.cost) {
      alert('爱心币不足哦！');
      return false;
    }

    try {
      const response = await fetch('/api/action/gift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          giftId,
          cost: gift.cost,
          mood: gift.mood,
          affection: gift.affection,
          name: gift.name,
          icon: gift.icon
        }),
      });
      const data = await response.json();

      if (data.error) {
        alert(data.error);
        return false;
      }

      // Append chat logs
      setChatHistory(prev => {
        const updated = [...prev, data.sysMsg, data.aiMsg];
        if (data.systemLevelMsg) {
          updated.push(data.systemLevelMsg);
        }
        return updated;
      });

      // Trigger animation celebration
      setCelebrationType(giftId === 'ring' ? 'roses' : 'stars');
      setShowCelebration(true);
      setTimeout(() => setShowCelebration(false), 3000);

      // Update stats
      setLevel(data.user.level);
      setAffection(data.user.affection);
      setEnergy(data.user.energy);
      setMood(data.user.mood);
      setCoins(data.user.coins);
      setTasks(data.tasks);
      setAvatarState(giftId === 'ring' ? 'blush' : 'happy');
      return true;

    } catch (err) {
      console.error('Gift error:', err);
      return false;
    }
  }, [userId, coins]);

  // Daily task claim reward to backend
  const claimTaskReward = useCallback(async (taskId) => {
    if (!userId || !taskId) return;

    try {
      const response = await fetch('/api/task/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, taskId }),
      });
      const data = await response.json();

      if (data.error) {
        alert(data.error);
        return;
      }

      setChatHistory(prev => [...prev, data.sysMsg]);
      setCoins(data.user.coins);
      setTasks(data.tasks);

    } catch (err) {
      console.error('Claim task error:', err);
    }
  }, [userId]);

  // Daily check-in action to backend
  const dailyCheckIn = useCallback(async () => {
    if (!userId) return;

    try {
      const response = await fetch('/api/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const data = await response.json();

      if (data.error) {
        alert('今天已经签过到啦！每天记得来见我哦~');
        return;
      }

      setChatHistory(prev => [...prev, data.aiMsg]);
      setTasks(data.tasks);
      setAvatarState('happy');

    } catch (err) {
      console.error('Checkin error:', err);
    }
  }, [userId]);

  // Tip real money (simulated) to backend
  const tipXiaoxi = useCallback(async (amount, paymentMethod) => {
    if (!userId) return;

    const tier = TIPPING_TIERS.find(t => t.amount === amount) || { coins: amount * 25, label: `打赏红包` };

    try {
      const response = await fetch('/api/action/tip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          amount,
          paymentMethod,
          coinsGranted: tier.coins,
          label: tier.label
        }),
      });
      const data = await response.json();

      if (data.error) {
        alert(data.error);
        return;
      }

      // Add chat message
      setChatHistory(prev => {
        const updated = [...prev, data.sysMsg, data.aiMsg];
        if (data.systemLevelMsg) {
          updated.push(data.systemLevelMsg);
        }
        return updated;
      });

      // Trigger full screen rose petal shower
      setCelebrationType('roses');
      setShowCelebration(true);
      setTimeout(() => setShowCelebration(false), 4000);

      // Broadcast marquee bulletin (local sync)
      const newBulletin = `公告：感谢亲爱的打赏 ¥${amount} 元！小希感动得要哭了，赠送了小希大量的爱心币！✨`;
      setRecentEvents(prev => [newBulletin, ...prev]);

      // Update states
      setLevel(data.user.level);
      setAffection(data.user.affection);
      setEnergy(data.user.energy);
      setMood(data.user.mood);
      setCoins(data.user.coins);
      setTasks(data.tasks);
      setAvatarState('blush');

    } catch (err) {
      console.error('Tipping error:', err);
    }
  }, [userId]);

  return {
    level,
    affection,
    energy,
    mood,
    coins,
    avatarState,
    chatHistory,
    tasks,
    onlineCount,
    recentEvents,
    showCelebration,
    celebrationType,
    FOOD_ITEMS,
    GIFT_ITEMS,
    TIPPING_TIERS,
    sendMessage,
    feedXiaoxi,
    giftXiaoxi,
    claimTaskReward,
    dailyCheckIn,
    tipXiaoxi
  };
}

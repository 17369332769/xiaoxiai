import { useState } from 'react';
import { useGameStore } from './hooks/useGameStore';
import Header from './components/Header';
import MainScreen from './components/MainScreen';
import ChatBox from './components/ChatBox';
import ActionMenu from './components/ActionMenu';
import ShopModal from './components/ShopModal';
import CelebrateEffect from './components/CelebrateEffect';
import NotificationCenter from './components/NotificationCenter';
import SyncStatusBanner from './components/SyncStatusBanner';

function App() {
  const store = useGameStore();
  
  // Modal control states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('shop'); // 'shop' or 'tipping'
  const [shopType, setShopType] = useState('food'); // 'food' or 'gift'
  const [relationshipCardFocusToken, setRelationshipCardFocusToken] = useState(0);

  // Open shop with active tab
  const openShop = (type) => {
    setModalMode('shop');
    setShopType(type);
    setIsModalOpen(true);
  };

  // Open tipping modal
  const openTipping = () => {
    setModalMode('tipping');
    setIsModalOpen(true);
  };

  const focusRelationshipCard = () => {
    setRelationshipCardFocusToken((token) => token + 1);
  };

  // Check if daily check-in task is completed
  const checkinTask = store.tasks.find(t => t.id === 'checkin');
  const isCheckInCompleted = checkinTask ? (checkinTask.completed || store.hasCheckedInToday) : store.hasCheckedInToday;

  return (
    <div className="app-container">
      {/* Fullscreen Celebration Canvas (Roses/Hearts/Stars Shower) */}
      <CelebrateEffect active={store.showCelebration} type={store.celebrationType} />
      <NotificationCenter
        notifications={store.notifications}
        dismissNotification={store.dismissNotification}
      />

      {/* Top Header Section */}
      <Header
        onlineCount={store.onlineCount}
        coins={store.coins}
        dailyCheckIn={store.dailyCheckIn}
        isCheckInCompleted={isCheckInCompleted}
        isCheckInPending={store.isCheckingIn || store.isSyncing}
        lastFailedAction={store.lastFailedAction}
        retryLastFailedAction={store.retryLastFailedAction}
        notify={store.notify}
      />

      <SyncStatusBanner
        syncError={store.syncError}
        isSyncing={store.isSyncing}
        retrySync={store.retrySync}
      />

      {/* Real-time Ticker Bulletin Board */}
      <div className="bulletin-bar">
        <span className="bulletin-label">最新广播</span>
        <div className="bulletin-marquee">
          <div className="bulletin-content">
            {store.recentEvents.map((evt, idx) => (
              <span key={idx} className="bulletin-item">{evt}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Main Gameplay Screen Grid */}
      <main className="main-dashboard">
        {/* Left Side: Girlfriend Display Panel */}
        <MainScreen
          level={store.level}
          affection={store.affection}
          energy={store.energy}
          mood={store.mood}
          avatarState={store.avatarState}
          relationshipSummary={store.relationshipSummary}
          relationshipHighlights={store.relationshipHighlights}
          relationshipRecentUpdates={store.relationshipRecentUpdates}
          hasFreshRelationshipUpdate={store.hasFreshRelationshipUpdate}
          relationshipCardFocusToken={relationshipCardFocusToken}
        />

        {/* Right Side: Conversation and Action Controls */}
        <div className="interaction-panel">
          {/* Chat Window */}
          <ChatBox
            chatHistory={store.chatHistory}
            sendMessage={store.sendMessage}
            lastFailedMessage={store.lastFailedMessage}
            retryLastFailedMessage={store.retryLastFailedMessage}
            isSendingMessage={store.isSendingMessage}
            isInteractionLocked={store.isSyncing}
            onRelationshipUpdateClick={focusRelationshipCard}
          />

          {/* Action Menu (Shop items & Tasks) */}
          <ActionMenu
            tasks={store.tasks}
            claimTaskReward={store.claimTaskReward}
            openShop={openShop}
            openTipping={openTipping}
            isInteractionLocked={store.isSyncing}
            claimingTaskIds={store.claimingTaskIds}
            lastFailedAction={store.lastFailedAction}
            retryLastFailedAction={store.retryLastFailedAction}
            isRetryingFailedAction={store.isCheckingIn || store.claimingTaskIds.length > 0}
          />
        </div>
      </main>

      {/* Shop / Tipping Shared Popup Dialog */}
      <ShopModal
        key={`${modalMode}-${shopType}-${isModalOpen ? 'open' : 'closed'}`}
        isOpen={isModalOpen}
        mode={modalMode}
        shopType={shopType}
        onClose={() => setIsModalOpen(false)}
        coins={store.coins}
        FOOD_ITEMS={store.FOOD_ITEMS}
        GIFT_ITEMS={store.GIFT_ITEMS}
        TIPPING_TIERS={store.TIPPING_TIERS}
        feedXiaoxi={store.feedXiaoxi}
        giftXiaoxi={store.giftXiaoxi}
        tipXiaoxi={store.tipXiaoxi}
        activePurchaseKey={store.activePurchaseKey}
        isTipping={store.isTipping}
        lastFailedAction={store.lastFailedAction}
        retryLastFailedAction={store.retryLastFailedAction}
        notify={store.notify}
      />

      {/* Footer Branding */}
      <footer className="site-footer">
        <div>© 2026 xiaoxiai.com · 小希 AI 温柔女友版 · 带给您全天候的暖心陪伴</div>
      </footer>
    </div>
  );
}

export default App;

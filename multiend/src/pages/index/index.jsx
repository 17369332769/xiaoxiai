import { useState } from 'react';
import { View, Text } from '@tarojs/components';
import { useGameStore } from '../../hooks/useGameStore';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useT } from '../../i18n/index.js';
import { getItem, setItem } from '../../adapters/storage';
import Header from '../../components/Header';
import MainScreen from '../../components/MainScreen';
import ChatBox from '../../components/ChatBox';
import ActionMenu from '../../components/ActionMenu';
import ShopModal from '../../components/ShopModal';
import WalletModal from '../../components/WalletModal';
import AuthModal from '../../components/AuthModal';
import MemoryModal from '../../components/MemoryModal';
import ThemeModal from '../../components/ThemeModal';
import StoryModal from '../../components/StoryModal';
import CelebrateEffect from '../../components/CelebrateEffect';
import NotificationCenter from '../../components/NotificationCenter';
import SyncStatusBanner from '../../components/SyncStatusBanner';

// Multi-end home page — the former web App.jsx, ported to Taro. Same composition
// (Header + bulletin + MainScreen + Chat/Action + modal stack + footer); the only
// changes vs web are div/main/footer/span/a → View/Text and localStorage → the
// cross-end storage adapter for the cosmetic character skin.
export default function Index() {
  const store = useGameStore();
  const isOnline = useOnlineStatus();
  const t = useT();

  // Modal control states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('shop'); // 'shop' or 'tipping'
  const [shopType, setShopType] = useState('food'); // 'food' or 'gift'
  const [relationshipCardFocusToken, setRelationshipCardFocusToken] = useState(0);
  const [isWalletOpen, setIsWalletOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isMemoryOpen, setIsMemoryOpen] = useState(false);
  const [isThemeOpen, setIsThemeOpen] = useState(false);
  const [isStoryOpen, setIsStoryOpen] = useState(false);

  // Character skin selection — pure visual, AI persona stays as 小希
  const [characterSkin, setCharacterSkin] = useState(() => getItem('xxa_character_skin') || 'xiaoxi');
  const switchCharacter = () => {
    setCharacterSkin((prev) => {
      const next = prev === 'xiaoxi' ? 'xiaoya' : 'xiaoxi';
      setItem('xxa_character_skin', next);
      return next;
    });
  };

  // Open wallet / transaction history and refresh the ledger
  const openWallet = () => {
    setIsWalletOpen(true);
    store.loadTransactions();
    store.loadOrders();
    store.track('open_wallet');
  };

  // Open memory center and refresh the memory list
  const openMemory = () => {
    setIsMemoryOpen(true);
    store.loadMemories();
  };

  // Open the theme / wardrobe picker and refresh the owned/equipped state
  const openTheme = () => {
    setIsThemeOpen(true);
    store.loadThemes();
    store.track('open_theme');
  };

  // Open the story / 剧情 picker and refresh the read state
  const openStory = () => {
    setIsStoryOpen(true);
    store.loadStories();
    store.track('open_story');
  };

  const openAuth = () => {
    setIsAuthOpen(true);
    store.track('open_auth');
  };

  // Open shop with active tab
  const openShop = (type) => {
    setModalMode('shop');
    setShopType(type);
    setIsModalOpen(true);
    store.track('open_shop', { shopType: type });
  };

  // Open tipping modal
  const openTipping = () => {
    setModalMode('tipping');
    setIsModalOpen(true);
    store.track('open_tipping');
  };

  const focusRelationshipCard = () => {
    setRelationshipCardFocusToken((token) => token + 1);
  };

  // Check if daily check-in task is completed
  const checkinTask = store.tasks.find((task) => task.id === 'checkin');
  const isCheckInCompleted = checkinTask ? (checkinTask.completed || store.hasCheckedInToday) : store.hasCheckedInToday;

  return (
    <View className="app-container">
      {!isOnline && (
        <View
          className="offline-banner"
          style={{
            background: '#b00020',
            color: '#fff',
            textAlign: 'center',
            padding: '8px 12px',
            fontSize: '14px',
            fontWeight: 600,
          }}
        >
          {t('app.offline')}
        </View>
      )}

      {/* Fullscreen Celebration overlay (roses/hearts/stars shower) */}
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
      <View className="bulletin-bar">
        <Text className="bulletin-label">最新广播</Text>
        <View className="bulletin-marquee">
          <View className="bulletin-content">
            {store.recentEvents.map((evt, idx) => (
              <Text key={idx} className="bulletin-item">{evt}</Text>
            ))}
          </View>
        </View>
      </View>

      {/* Main Gameplay Screen Grid */}
      <View className="main-dashboard">
        {/* Left Side: Girlfriend Display Panel */}
        <MainScreen
          level={store.level}
          affection={store.affection}
          energy={store.energy}
          mood={store.mood}
          avatarState={store.avatarState}
          characterSkin={characterSkin}
          relationshipSummary={store.relationshipSummary}
          relationshipHighlights={store.relationshipHighlights}
          relationshipRecentUpdates={store.relationshipRecentUpdates}
          hasFreshRelationshipUpdate={store.hasFreshRelationshipUpdate}
          relationshipCardFocusToken={relationshipCardFocusToken}
        />

        {/* Right Side: Conversation and Action Controls */}
        <View className="interaction-panel">
          {/* Chat Window */}
          <ChatBox
            chatHistory={store.chatHistory}
            sendMessage={store.sendMessage}
            lastFailedMessage={store.lastFailedMessage}
            retryLastFailedMessage={store.retryLastFailedMessage}
            isSendingMessage={store.isSendingMessage}
            isInteractionLocked={store.isSyncing}
            onRelationshipUpdateClick={focusRelationshipCard}
            onPlayVoice={store.playVoice}
            speakingMessageId={store.speakingMessageId}
            characterSkin={characterSkin}
          />

          {/* Action Menu (Shop items & Tasks) */}
          <ActionMenu
            tasks={store.tasks}
            claimTaskReward={store.claimTaskReward}
            openShop={openShop}
            openTipping={openTipping}
            openWallet={openWallet}
            openMemory={openMemory}
            openTheme={openTheme}
            openStory={openStory}
            openAuth={openAuth}
            characterSkin={characterSkin}
            onSwitchCharacter={switchCharacter}
            checkinStreak={store.checkinStreak}
            accountBound={store.account?.bound}
            isInteractionLocked={store.isSyncing}
            claimingTaskIds={store.claimingTaskIds}
            lastFailedAction={store.lastFailedAction}
            retryLastFailedAction={store.retryLastFailedAction}
            isRetryingFailedAction={store.isCheckingIn || store.claimingTaskIds.length > 0}
          />
        </View>
      </View>

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
        createOrder={store.createOrder}
        queryOrder={store.queryOrder}
        confirmPayment={store.confirmPayment}
        allowSimulatedPayment={store.allowSimulatedPayment}
        activePurchaseKey={store.activePurchaseKey}
        isTipping={store.isTipping}
        lastFailedAction={store.lastFailedAction}
        retryLastFailedAction={store.retryLastFailedAction}
        notify={store.notify}
      />

      {/* Wallet / Transaction History Dialog */}
      <WalletModal
        isOpen={isWalletOpen}
        onClose={() => setIsWalletOpen(false)}
        coins={store.coins}
        transactions={store.transactions}
        isLoadingTransactions={store.isLoadingTransactions}
        loadTransactions={store.loadTransactions}
        orders={store.orders}
        isLoadingOrders={store.isLoadingOrders}
        loadOrders={store.loadOrders}
      />

      {/* Account Center Dialog */}
      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        account={store.account}
        authPending={store.authPending}
        hasGuestProgress={store.hasGuestProgress}
        registerAccount={store.registerAccount}
        loginAccount={store.loginAccount}
        logoutAccount={store.logoutAccount}
        requireRegistrationOtp={store.requireRegistrationOtp}
        requestAuthCode={store.requestAuthCode}
        resetPassword={store.resetPassword}
        exportUserData={store.exportUserData}
        deleteAccount={store.deleteAccount}
        notify={store.notify}
      />

      {/* Long-term Memory Dialog */}
      <MemoryModal
        isOpen={isMemoryOpen}
        onClose={() => setIsMemoryOpen(false)}
        memories={store.memories}
        memorySummary={store.memorySummary}
        isLoadingMemories={store.isLoadingMemories}
        loadMemories={store.loadMemories}
        deleteMemory={store.deleteMemory}
        clearMemories={store.clearMemories}
      />

      <ThemeModal
        isOpen={isThemeOpen}
        onClose={() => setIsThemeOpen(false)}
        themes={store.THEMES}
        ownedThemes={store.ownedThemes}
        equippedTheme={store.equippedTheme}
        coins={store.coins}
        unlockTheme={store.unlockTheme}
        equipTheme={store.equipTheme}
        notify={store.notify}
      />

      <StoryModal
        isOpen={isStoryOpen}
        onClose={() => setIsStoryOpen(false)}
        stories={store.STORIES}
        readStories={store.readStories}
        level={store.level}
        claimStory={store.claimStory}
        notify={store.notify}
      />

      {/* Footer Branding */}
      <View className="site-footer">
        <View>© 2026 xiaoxiai.com · 小希 AI 温柔女友版 · 带给您全天候的暖心陪伴</View>
        <View style={{ marginTop: '6px', fontSize: '12px' }}>
          <Text style={{ color: 'var(--text-pink, #ffa3b8)' }}>隐私政策</Text>
          <Text>{' · '}</Text>
          <Text style={{ color: 'var(--text-pink, #ffa3b8)' }}>服务条款</Text>
        </View>
      </View>
    </View>
  );
}

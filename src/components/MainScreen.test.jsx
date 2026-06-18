import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import MainScreen from './MainScreen';

void React;

describe('MainScreen', () => {
  test('renders the relationship memory summary and tags when available', () => {
    render(
      <MainScreen
        level={3}
        affection={45}
        energy={88}
        mood={82}
        avatarState="happy"
        relationshipSummary="小希记住你喜欢拿铁，也知道你最近在准备面试。"
        relationshipHighlights={[
          { key: 'favorite_drink', label: '常喝饮品', value: '拿铁' },
          { key: 'study_goal', label: '近期目标', value: '准备面试' },
        ]}
        relationshipRecentUpdates={[
          { id: 'recent-1', category: 'preference', categoryLabel: '偏好', sourceType: 'local_memory', sourceLabel: '规则提取', confidence: 'high', confidenceLabel: '高可信', text: '小希刚记住了你的常喝饮品：拿铁', timestamp: '10:11' },
        ]}
        hasFreshRelationshipUpdate
      />
    );

    expect(screen.getByText('小希的关系速记')).not.toBeNull();
    expect(screen.getByText(/喜欢拿铁/)).not.toBeNull();
    expect(screen.getByText('常喝饮品')).not.toBeNull();
    expect(screen.getByText('准备面试')).not.toBeNull();
    expect(screen.getByText('刚刚记住你了')).not.toBeNull();
    expect(screen.getByText('最近记住了什么')).not.toBeNull();
    expect(screen.getByText('小希刚记住了你的常喝饮品：拿铁')).not.toBeNull();
    expect(screen.getAllByText('偏好').length).toBeGreaterThan(0);
    expect(screen.getByText('共 1 条')).not.toBeNull();
    expect(screen.getAllByText('规则提取')).toHaveLength(2);
    expect(screen.getByText('高可信')).not.toBeNull();
  });

  test('renders the fallback helper copy when no relationship summary exists yet', () => {
    render(
      <MainScreen
        level={1}
        affection={10}
        energy={80}
        mood={70}
        avatarState="normal"
        relationshipSummary=""
        relationshipHighlights={[]}
      />
    );

    expect(screen.getByText(/再多聊几句吧/)).not.toBeNull();
  });

  test('filters and expands recent relationship updates', () => {
    render(
      <MainScreen
        level={5}
        affection={130}
        energy={91}
        mood={87}
        avatarState="blush"
        relationshipSummary="小希最近记住了你喜欢的东西，也知道你正在努力准备面试。"
        relationshipHighlights={[
          { key: 'favorite_drink', label: '常喝饮品', value: '拿铁' },
          { key: 'study_goal', label: '近期目标', value: '前端面试' },
        ]}
        relationshipRecentUpdates={[
          { id: 'recent-1', category: 'preference', categoryLabel: '偏好', sourceType: 'local_memory', sourceLabel: '规则提取', confidence: 'high', confidenceLabel: '高可信', text: '小希刚记住了你的常喝饮品：拿铁', timestamp: '10:11' },
          { id: 'recent-2', category: 'goal', categoryLabel: '目标', sourceType: 'llm_memory', sourceLabel: '模型总结', confidence: 'medium', confidenceLabel: '中可信', text: '小希记下了你最近在准备前端面试', timestamp: '10:12' },
          { id: 'recent-3', category: 'status', categoryLabel: '近况', sourceType: 'local_memory', sourceLabel: '规则提取', confidence: 'high', confidenceLabel: '高可信', text: '小希知道你最近有点累，想被温柔安慰', timestamp: '10:13' },
          { id: 'recent-4', category: 'bond', categoryLabel: '关系', sourceType: 'summary_shift', sourceLabel: '关系总结', confidence: 'medium', confidenceLabel: '中可信', text: '小希把你们最近的相处点滴悄悄记下来了。', timestamp: '10:14' },
        ]}
      />
    );

    expect(screen.getByText('展开查看更多（+1）')).not.toBeNull();
    expect(screen.queryByText('小希把你们最近的相处点滴悄悄记下来了。')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '展开查看更多（+1）' }));
    expect(screen.getByText('收起')).not.toBeNull();
    expect(screen.getByText('小希把你们最近的相处点滴悄悄记下来了。')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '目标' }));
    expect(screen.getByText('共 1 条')).not.toBeNull();
    expect(screen.getByText('小希记下了你最近在准备前端面试')).not.toBeNull();
    expect(screen.queryByText('小希刚记住了你的常喝饮品：拿铁')).toBeNull();
    expect(screen.getByText('当前查看：目标 · 全部来源')).not.toBeNull();
    expect(screen.queryByText('展开查看更多（+1）')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '模型总结' }));
    expect(screen.getByText('共 1 条')).not.toBeNull();
    expect(screen.getByText('小希记下了你最近在准备前端面试')).not.toBeNull();
    expect(screen.queryByText('小希刚记住了你的常喝饮品：拿铁')).toBeNull();
    expect(screen.getByText('当前查看：目标 · 模型总结')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '全部' }));
    fireEvent.click(screen.getByRole('button', { name: '全部来源' }));
    expect(screen.getByText('展开查看更多（+1）')).not.toBeNull();
    expect(screen.queryByText('小希把你们最近的相处点滴悄悄记下来了。')).toBeNull();
    expect(screen.queryByText(/当前查看：/)).toBeNull();
  });

  test('filters relationship updates by source type', () => {
    render(
      <MainScreen
        level={4}
        affection={70}
        energy={85}
        mood={81}
        avatarState="happy"
        relationshipSummary="小希正在用不同方式慢慢认识你。"
        relationshipHighlights={[{ key: 'favorite_drink', label: '常喝饮品', value: '拿铁' }]}
        relationshipRecentUpdates={[
          { id: 'recent-1', category: 'preference', categoryLabel: '偏好', sourceType: 'local_memory', sourceLabel: '规则提取', confidence: 'high', confidenceLabel: '高可信', text: '小希刚记住了你的常喝饮品：拿铁', timestamp: '10:11' },
          { id: 'recent-2', category: 'goal', categoryLabel: '目标', sourceType: 'llm_memory', sourceLabel: '模型总结', confidence: 'medium', confidenceLabel: '中可信', text: '小希记下了你最近在准备前端面试', timestamp: '10:12' },
          { id: 'recent-3', category: 'bond', categoryLabel: '关系', sourceType: 'summary_shift', sourceLabel: '关系总结', confidence: 'medium', confidenceLabel: '中可信', text: '小希把你们最近的相处点滴悄悄记下来了。', timestamp: '10:13' },
        ]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '关系总结' }));
    expect(screen.getByText('共 1 条')).not.toBeNull();
    expect(screen.getByText('小希把你们最近的相处点滴悄悄记下来了。')).not.toBeNull();
    expect(screen.queryByText('小希刚记住了你的常喝饮品：拿铁')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '规则提取' }));
    expect(screen.getByText('共 1 条')).not.toBeNull();
    expect(screen.getByText('小希刚记住了你的常喝饮品：拿铁')).not.toBeNull();
    expect(screen.queryByText('小希把你们最近的相处点滴悄悄记下来了。')).toBeNull();
  });

  test('shows an empty hint when the selected relationship category has no updates yet', () => {
    render(
      <MainScreen
        level={2}
        affection={20}
        energy={76}
        mood={74}
        avatarState="normal"
        relationshipSummary="小希已经开始慢慢记住你的偏好了。"
        relationshipHighlights={[{ key: 'favorite_food', label: '偏爱食物', value: '火锅' }]}
        relationshipRecentUpdates={[
          { id: 'recent-1', category: 'preference', categoryLabel: '偏好', sourceType: 'local_memory', sourceLabel: '规则提取', confidence: 'high', confidenceLabel: '高可信', text: '小希刚记住了你的偏爱食物：火锅', timestamp: '11:01' },
        ]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '近况' }));
    expect(screen.getByText('这一类记忆还没有更新，再和小希多聊聊吧。')).not.toBeNull();
  });

  test('shows helper copy for low-confidence relationship updates', () => {
    render(
      <MainScreen
        level={2}
        affection={24}
        energy={78}
        mood={76}
        avatarState="normal"
        relationshipSummary="小希对你的近况已经有一点模糊印象了。"
        relationshipHighlights={[]}
        relationshipRecentUpdates={[
          { id: 'recent-low-1', category: 'status', categoryLabel: '近况', sourceType: 'local_memory', sourceLabel: '规则提取', confidence: 'low', confidenceLabel: '低可信', text: '小希刚记住了你的最近状态：最近有点累，想被温柔安慰', timestamp: '11:08' },
        ]}
      />
    );

    expect(screen.getByText('低可信')).not.toBeNull();
    expect(screen.getByText('可能是小希的推测，会随着更多聊天继续修正。')).not.toBeNull();
  });

  test('focuses the relationship memory card when a focus token update is received', async () => {
    vi.useFakeTimers();
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;

    const { container, rerender } = render(
      <MainScreen
        level={1}
        affection={10}
        energy={80}
        mood={70}
        avatarState="normal"
        relationshipSummary="小希记住你喜欢拿铁。"
        relationshipHighlights={[{ key: 'favorite_drink', label: '常喝饮品', value: '拿铁' }]}
        relationshipCardFocusToken={0}
      />
    );

    rerender(
      <MainScreen
        level={1}
        affection={10}
        energy={80}
        mood={70}
        avatarState="normal"
        relationshipSummary="小希记住你喜欢拿铁。"
        relationshipHighlights={[{ key: 'favorite_drink', label: '常喝饮品', value: '拿铁' }]}
        relationshipCardFocusToken={1}
      />
    );

    const memoryCard = container.querySelector('.relationship-memory-card');
    expect(scrollIntoView).toHaveBeenCalled();
    expect(memoryCard.className.includes('is-focused')).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(2200);
    });

    expect(memoryCard.className.includes('is-focused')).toBe(false);
    vi.useRealTimers();
  });
});

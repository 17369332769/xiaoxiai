import { useCallback, useEffect, useRef, useState } from 'react';
import {
  appendRecentRelationshipUpdate,
  buildRelationshipFingerprint,
  buildRelationshipUpdateSystemMessage,
  describeRelationshipUpdate,
  normalizeRelationshipProfile,
} from '../utils/gameStoreHelpers.js';

export function useRelationshipMemory({ notify, setStateIfMounted, appendChatMessage }) {
  const [relationshipSummary, setRelationshipSummary] = useState('');
  const [relationshipHighlights, setRelationshipHighlights] = useState([]);
  const [relationshipRecentUpdates, setRelationshipRecentUpdates] = useState([]);
  const [hasFreshRelationshipUpdate, setHasFreshRelationshipUpdate] = useState(false);
  const relationshipHighlightTimeoutRef = useRef(null);
  const relationshipFingerprintRef = useRef('');
  const relationshipProfileRef = useRef({ summary: '', highlights: [] });

  const clearRelationshipUpdateHighlight = useCallback(() => {
    if (relationshipHighlightTimeoutRef.current) {
      clearTimeout(relationshipHighlightTimeoutRef.current);
      relationshipHighlightTimeoutRef.current = null;
    }
  }, []);

  const applyRelationshipProfile = useCallback((profile, { announce = false } = {}) => {
    const normalized = normalizeRelationshipProfile(profile);
    const nextFingerprint = buildRelationshipFingerprint(normalized);
    const previousProfile = relationshipProfileRef.current;
    const previousFingerprint = relationshipFingerprintRef.current;

    setRelationshipSummary(normalized.summary);
    setRelationshipHighlights(normalized.highlights);
    setRelationshipRecentUpdates(normalized.recentUpdates);
    relationshipProfileRef.current = normalized;
    relationshipFingerprintRef.current = nextFingerprint;

    if (!announce || !nextFingerprint || nextFingerprint === previousFingerprint) {
      return;
    }

    const updateMessage = describeRelationshipUpdate(previousProfile, normalized);
    if (!updateMessage) {
      return;
    }

    setHasFreshRelationshipUpdate(true);
    clearRelationshipUpdateHighlight();
    appendChatMessage(buildRelationshipUpdateSystemMessage(updateMessage));
    setRelationshipRecentUpdates((prev) => {
      if (normalized.recentUpdates.length > 0) {
        return normalized.recentUpdates;
      }

      return appendRecentRelationshipUpdate(prev, updateMessage);
    });
    relationshipHighlightTimeoutRef.current = setTimeout(() => {
      relationshipHighlightTimeoutRef.current = null;
      setStateIfMounted(setHasFreshRelationshipUpdate, false);
    }, 4200);
    notify(updateMessage, 'info', '记忆更新');
  }, [appendChatMessage, clearRelationshipUpdateHighlight, notify, setStateIfMounted]);

  useEffect(() => {
    return () => {
      if (relationshipHighlightTimeoutRef.current) {
        clearTimeout(relationshipHighlightTimeoutRef.current);
        relationshipHighlightTimeoutRef.current = null;
      }
    };
  }, []);

  return {
    relationshipSummary,
    relationshipHighlights,
    relationshipRecentUpdates,
    hasFreshRelationshipUpdate,
    applyRelationshipProfile,
  };
}

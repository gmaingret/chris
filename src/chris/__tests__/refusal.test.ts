import { describe, it, expect, beforeEach } from 'vitest';
import { detectRefusal, getDeclinedTopics, addDeclinedTopic, clearDeclinedTopics } from '../refusal.js';

describe('detectRefusal', () => {
  // TRUST-01: 15-20 patterns per language
  describe('English refusals', () => {
    it('detects "I don\'t want to talk about X"', () => {
      const result = detectRefusal("I don't want to talk about my father");
      expect(result.isRefusal).toBe(true);
    });

    it('detects "let\'s not discuss X"', () => {
      const result = detectRefusal("let's not discuss that");
      expect(result.isRefusal).toBe(true);
    });

    it('detects "I\'d rather not get into X"', () => {
      const result = detectRefusal("I'd rather not get into that right now");
      expect(result.isRefusal).toBe(true);
    });

    it('detects "drop it"', () => {
      const result = detectRefusal("just drop it");
      expect(result.isRefusal).toBe(true);
    });

    it('detects "please don\'t bring up X"', () => {
      const result = detectRefusal("please don't bring up my ex");
      expect(result.isRefusal).toBe(true);
    });

    it('does NOT flag normal conversation', () => {
      const result = detectRefusal("I had a great day at work today");
      expect(result.isRefusal).toBe(false);
    });

    it('does NOT flag talking ABOUT not wanting (meta)', () => {
      const result = detectRefusal("I told my therapist I don't want to talk about my childhood");
      expect(result.isRefusal).toBe(false);
    });
  });

  describe('French refusals', () => {
    it('detects "je ne veux pas en parler"', () => {
      const result = detectRefusal("je ne veux pas en parler");
      expect(result.isRefusal).toBe(true);
    });

    it('detects "changeons de sujet"', () => {
      const result = detectRefusal("changeons de sujet");
      expect(result.isRefusal).toBe(true);
    });

    it('detects "laisse tomber"', () => {
      const result = detectRefusal("laisse tomber");
      expect(result.isRefusal).toBe(true);
    });
  });

  describe('Russian refusals', () => {
    it('detects "я не хочу об этом говорить"', () => {
      const result = detectRefusal("я не хочу об этом говорить");
      expect(result.isRefusal).toBe(true);
    });

    it('detects "давай сменим тему"', () => {
      const result = detectRefusal("давай сменим тему");
      expect(result.isRefusal).toBe(true);
    });

    it('detects "оставь это"', () => {
      const result = detectRefusal("оставь это");
      expect(result.isRefusal).toBe(true);
    });
  });

  describe('topic extraction', () => {
    it('extracts topic phrase from "I don\'t want to talk about my father"', () => {
      const result = detectRefusal("I don't want to talk about my father");
      expect(result.isRefusal).toBe(true);
      if (result.isRefusal) {
        expect(result.topic).toBeDefined();
        expect(result.originalSentence).toBe("I don't want to talk about my father");
      }
    });
  });
});

describe('session declined topics (TRUST-02)', () => {
  beforeEach(() => {
    clearDeclinedTopics('test-chat');
  });

  it('starts with empty declined topics', () => {
    expect(getDeclinedTopics('test-chat')).toEqual([]);
  });

  it('adds a declined topic', () => {
    addDeclinedTopic('test-chat', 'my father', "I don't want to talk about my father");
    const topics = getDeclinedTopics('test-chat');
    expect(topics).toHaveLength(1);
    expect(topics[0]!.topic).toBe('my father');
  });

  it('accumulates multiple declined topics', () => {
    addDeclinedTopic('test-chat', 'my father', "I don't want to talk about my father");
    addDeclinedTopic('test-chat', 'work', "let's not discuss work");
    expect(getDeclinedTopics('test-chat')).toHaveLength(2);
  });

  it('isolates by chatId', () => {
    addDeclinedTopic('chat-1', 'topic-a', 'sentence-a');
    addDeclinedTopic('chat-2', 'topic-b', 'sentence-b');
    expect(getDeclinedTopics('chat-1')).toHaveLength(1);
    expect(getDeclinedTopics('chat-2')).toHaveLength(1);
  });
});

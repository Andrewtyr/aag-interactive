import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLiveStore } from '../src/live-store.mjs';

test('word cloud appears on the current projector slide while answers are open', () => {
  const directory = mkdtempSync(join(tmpdir(), 'aag-cloud-'));
  const material = { title: 'Облако', slides: [{ type: 'word-cloud', title: 'Какие слова?', timeSeconds: 30 }] };
  const live = createLiveStore(join(directory, 'aag.sqlite'), material, () => 1_000, { bannedWordsPath: join(directory, 'words.txt') });
  try {
    const event = live.start(1);
    live.open(event.id, 1);
    const participant = live.join(event.code, 'Участник');
    live.respond(event.id, participant.participantToken, 'Команда', 0);
    const display = live.getProjector(event.id, 1);
    assert.equal(display.event.slideIndex, 0);
    assert.equal(display.question.closed, false);
    assert.deepEqual(display.wordCloud.map((word) => ({ text: word.text, count: word.count })), [{ text: 'команда', count: 1 }]);

    const answer = live.getHost(event.id, 1).answers[0];
    live.hideAnswer(event.id, 1, answer.id);
    assert.deepEqual(live.getProjector(event.id, 1).wordCloud, []);
  } finally {
    live.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

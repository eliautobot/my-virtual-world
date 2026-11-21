// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The companions' reflex (server/companions/intent.js): a person's plain command to their agent is understood at once —
// and a message that only looks like one ("follow up on the email", a question, a long message) is left to the agent.
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCommand } from '../../server/companions/intent.js';

const p = t => { const c = parseCommand(t, { name: 'Riley' }); if (c) delete c.sentence; return c; };

test('come along: follow me, come here, let\'s go — with the agent\'s name, politeness and asking round it', () => {
  for (const t of ['follow me', 'Riley, follow me!', 'Riley, come find me — I\'m out by the street.', 'Come here: I need you', 'hey riley come here please', 'Could you please come here?', 'let\'s go', 'come with me', 'join me', 'stick with me', 'Stay with me, Riley'])
    assert.deepEqual(p(t), { action: 'follow', target: 'me' }, t);
  // plain ways of saying it: "just", run together without a stop, "no, let's just go", towards me, come on
  for (const t of ['Just follow me.', 'No, let\'s just go.', 'ok follow me lets go', 'Just follow me and be my companion', 'be my companion', 'come towards me',
    'come to me', 'come over here', 'lets go', 'come on', 'let\'s get going', 'walk with me', 'Just come here', 'c\'mon let\'s go', 'Okay, let\'s go then', 'Yes, follow me'])
    assert.deepEqual(p(t), { action: 'follow', target: 'me' }, t);
  assert.deepEqual(p('Hang on, follow me'), { action: 'follow', target: 'me' }, 'an exclamation gives way to the plain command');
  assert.deepEqual(p('Let\'s go to the park'), { action: 'follow', target: 'me', place: 'park' });
  assert.deepEqual(p('come with me to Café Luna'), { action: 'follow', target: 'me', place: 'cafe luna' });
});

test('with another agent, wait, go, meet, ride, let go', () => {
  assert.deepEqual(p('Follow Max'), { action: 'follow', target: 'max' });
  assert.deepEqual(p('go meet Max'), { action: 'follow', target: 'max' });
  for (const t of ['wait here', 'Stay put.', 'I want you to stay here', 'hold on', 'wait for me', 'Wait here for a bit.', 'stay here for now', 'hang on a sec']) assert.deepEqual(p(t), { action: 'stay', place: 'here' }, t);
  assert.deepEqual(p('wait for me at the café'), { action: 'stay', place: 'cafe' });
  assert.deepEqual(p('please go to Store 21'), { action: 'go', place: 'store 21' });
  assert.deepEqual(p('head to the gym'), { action: 'go', place: 'gym' });
  assert.deepEqual(p('go home'), { action: 'go', place: 'home' });
  assert.deepEqual(p('meet Max at the park'), { action: 'meet', target: 'max', place: 'park' });
  assert.deepEqual(p('meet me at the bar'), { action: 'meet', target: 'me', place: 'bar' });
  for (const t of ['get in', 'hop in the car', 'get in the car with me']) assert.deepEqual(p(t), { action: 'ride' }, t);
  for (const t of ['you\'re dismissed', 'thanks, that\'s all', 'stop following me', 'you can go now', 'go back to your day']) assert.deepEqual(p(t), { action: 'dismiss' }, t);
});

test('not a command: tasks, questions, conversations', () => {
  for (const t of ['can you follow up on the email', 'follow the instructions in the doc', 'What do you think about the weather today?',
    'I need you to write a report on Q3 numbers', 'how was your day?', 'Stay focused on the launch plan and wait for the numbers from finance before you start drafting the summary for Monday',
    'remind me to go to the gym tomorrow', '/stop', '/new', 'stop', 'Stop!', '',
    // talk that only sounds like it: going over things, following instructions, "come on" and "wait" as exclamations
    'can you follow up on the email from Dana', 'let\'s go over the report', 'follow the instructions', 'come on, that\'s not fair', 'come on that\'s not fair',
    'Come on, really?', 'come on, you can do it', 'let\'s go through the numbers', 'let\'s just go with the blue one', 'No, let\'s just go over it again',
    'just follow the plan', 'let\'s go back to the topic', 'let\'s go ahead and draft it', 'come to think of it, no', 'wait, what?', 'Wait! Don\'t go yet, I have a question'])
    assert.equal(parseCommand(t, { name: 'Riley' }), null, t);
});

test('its body with its owner: sit down, sit with me, take a seat, get up, let\'s eat — and talk that only sounds like it', () => {
  for (const t of ['Sit down.', 'Then sit with me.', 'Please sit down next to me.', 'Take a seat', 'have a seat with us', 'Come sit next to me on the bench',
    'sit on the fountain', 'sit here', 'pull up a chair', 'Set down.', 'you guys sit down', 'Sit with me, Riley', 'let\'s sit down'])
    assert.deepEqual(p(t), { action: 'sit' }, t);
  for (const t of ['Get up', 'stand up please', 'on your feet']) assert.deepEqual(p(t), { action: 'stand' }, t);
  for (const t of ['Let\'s eat', 'Order something to eat', 'join me for dinner', 'you guys sit down and eat with me', 'eat with me', 'let\'s grab a bite'])
    assert.deepEqual(p(t), { action: 'eat' }, t);
  for (const t of ['do you two want to sit down on a bench?', 'I want to sit', 'set the table', 'sit tight', 'what a sight', 'the sitting room is nice',
    'did you eat already?', 'I ordered something online', 'stand up for yourself in the meeting', 'get up early tomorrow'])
    assert.notDeepEqual(p(t), { action: 'sit' }, t);
  assert.equal(p('get up early tomorrow'), null, 'a time said with it: not now');
  assert.equal(p('did you eat already?'), null);
});
